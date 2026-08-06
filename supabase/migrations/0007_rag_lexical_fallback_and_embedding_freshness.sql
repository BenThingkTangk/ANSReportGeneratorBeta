-- ============================================================
-- 0007 — RAG hardening: Postgres full-text fallback, embedding freshness,
--        and an operator health view.
--
-- WHY THIS EXISTS
-- 0006 repaired `public.match_ans_knowledge_chunks` (it had referenced
-- s.status / s.is_active / s.citation, which do not exist — the real columns are
-- review_status and active_in_ai_analysis, and a citation must be COMPOSED from
-- title/authors/year) and added the pgvector `embedding` column. But every chunk
-- still has embedding IS NULL until a backfill runs, and vector search is
-- therefore unavailable on a cold database — and unavailable forever on a
-- database where pgvector or the embedding provider is not present.
--
-- This migration gives retrieval a GROUNDED PATH THAT NEEDS NO AI PROVIDER:
--   1. a generated tsvector + GIN index over chunk content, and
--   2. `public.match_ans_knowledge_chunks_lexical(query_text, match_count)` —
--      Postgres full-text ranking with the SAME source gating and the SAME
--      provenance columns as the vector function, so the app can swap tiers
--      without changing a single downstream code path.
-- It also stops silently-stale vectors: changing a chunk's content NULLs its
-- embedding so the backfill re-embeds it, instead of leaving a vector that
-- describes text that no longer exists.
--
-- SAFETY / SCOPE
--   * ADDITIVE + FUNCTION CREATION only. No column is dropped or retyped.
--   * Modifies NO existing row's content, review_status, or active_in_ai_analysis.
--     Seeds nothing. Invents nothing. Generates no embeddings (SQL has no
--     provider access — that is POST /api/admin/knowledge/embed-backfill).
--   * Touches NO patient data, NOTHING in the deterministic .ans parser, and no
--     clinical calculation, threshold, score, or reference range.
--   * Every statement is guarded, so the migration is idempotent and is safe on a
--     database WITHOUT pgvector (it then simply skips the embedding-freshness
--     trigger and the app stays on the full-text/lexical tiers).
--
-- HOW TO APPLY (NOT executed by this repo)
--   supabase db push                     # or:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/0007_rag_lexical_fallback_and_embedding_freshness.sql
-- Apply 0001 … 0006 first, in order.
-- ============================================================

-- 1. Generated tsvector column over chunk content. --------------------------------
--    `to_tsvector('english', ...)` with a literal config is IMMUTABLE, so it is
--    legal in a generated column. COALESCE keeps NULL content from nulling the row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ans_knowledge_chunks'
      AND column_name  = 'content_tsv'
  ) THEN
    EXECUTE $ddl$
      ALTER TABLE public.ans_knowledge_chunks
        ADD COLUMN content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED
    $ddl$;
    RAISE NOTICE '0007: added ans_knowledge_chunks.content_tsv (generated)';
  ELSE
    RAISE NOTICE '0007: ans_knowledge_chunks.content_tsv already present';
  END IF;
END$$;

-- 2. GIN index for the full-text tier. -------------------------------------------
CREATE INDEX IF NOT EXISTS ans_knowledge_chunks_content_tsv_gin
  ON public.ans_knowledge_chunks USING gin (content_tsv);

-- 3. Trigram index for short/typo'd queries that websearch_to_tsquery misses. ----
--    Best-effort: pg_trgm is available on Supabase, but skip cleanly if not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXECUTE 'CREATE INDEX IF NOT EXISTS ans_knowledge_chunks_content_trgm '
         || 'ON public.ans_knowledge_chunks USING gin (content gin_trgm_ops)';
  ELSE
    RAISE NOTICE '0007: pg_trgm unavailable — skipping trigram index (full-text tier still works).';
  END IF;
END$$;

-- 4. Supporting index for the gated join used by BOTH retrieval functions. -------
CREATE INDEX IF NOT EXISTS ans_knowledge_sources_approved_active
  ON public.ans_knowledge_sources (review_status, active_in_ai_analysis);

CREATE INDEX IF NOT EXISTS ans_knowledge_chunks_source_id
  ON public.ans_knowledge_chunks (source_id);

-- 5. FULL-TEXT retrieval function — the provider-free fallback. -------------------
--    Contract is deliberately identical to match_ans_knowledge_chunks (0006):
--      same output columns, same gating, citation COMPOSED from real metadata.
--    `similarity` carries the ts_rank_cd score so the caller has one field name.
--    DISTINCT ON collapses byte-identical text within a source so a re-ingested
--    duplicate cannot be weighted twice in the prompt.
CREATE OR REPLACE FUNCTION public.match_ans_knowledge_chunks_lexical(
  query_text  text,
  match_count int DEFAULT 12
)
RETURNS TABLE (
  id               uuid,
  source_id        uuid,
  chunk_index      int,
  content          text,
  citation         text,
  title            text,
  authors          text,
  year             int,
  publication_type text,
  url              text,
  similarity       double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english', coalesce(query_text, '')) AS tsq
  ),
  ranked AS (
    SELECT DISTINCT ON (c.source_id, md5(lower(regexp_replace(coalesce(c.content, ''), '\s+', ' ', 'g'))))
           c.id,
           c.source_id,
           c.chunk_index,
           c.content,
           -- Citation COMPOSED from real source columns. There is no
           -- s.citation column; never invent one.
           concat_ws(', ',
             nullif(s.title, ''),
             nullif(s.authors, ''),
             nullif(s.year::text, ''),
             nullif(s.publication_type, '')
           ) AS citation,
           s.title,
           s.authors,
           s.year,
           s.publication_type,
           s.url,
           ts_rank_cd(c.content_tsv, q.tsq)::double precision AS similarity
      FROM public.ans_knowledge_chunks c
      JOIN public.ans_knowledge_sources s ON s.id = c.source_id
      CROSS JOIN q
     WHERE q.tsq IS NOT NULL
       AND numnode(q.tsq) > 0
       -- CLINICAL SAFEGUARD: approved AND AI-active sources only.
       AND s.review_status = 'approved'
       AND s.active_in_ai_analysis = true
       AND c.content IS NOT NULL
       AND length(btrim(c.content)) > 0
       AND c.content_tsv @@ q.tsq
     ORDER BY c.source_id,
              md5(lower(regexp_replace(coalesce(c.content, ''), '\s+', ' ', 'g'))),
              ts_rank_cd(c.content_tsv, q.tsq) DESC
  )
  SELECT id, source_id, chunk_index, content, citation,
         title, authors, year, publication_type, url, similarity
    FROM ranked
   ORDER BY similarity DESC, source_id, chunk_index
   LIMIT greatest(1, least(coalesce(match_count, 12), 100));
$$;

COMMENT ON FUNCTION public.match_ans_knowledge_chunks_lexical(text, int) IS
  'Provider-free full-text retrieval fallback for ATOM. Same output contract and '
  'same gating (review_status = ''approved'' AND active_in_ai_analysis = true) as '
  'match_ans_knowledge_chunks. Citation is composed from title/authors/year/type.';

-- 6. Embedding freshness: content change ⇒ embedding must be regenerated. --------
--    Guarded on the embedding column existing (i.e. pgvector present + 0006 run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ans_knowledge_chunks'
      AND column_name  = 'embedding'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.ans_knowledge_chunks_invalidate_embedding()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_catalog
      AS $body$
      BEGIN
        -- Only when the TEXT actually changed. A stale vector describing text
        -- that no longer exists is worse than no vector: NULL it so the
        -- admin backfill re-embeds this row. Never fabricates a vector.
        IF NEW.content IS DISTINCT FROM OLD.content THEN
          NEW.embedding := NULL;
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    DROP TRIGGER IF EXISTS trg_ans_knowledge_chunks_invalidate_embedding
      ON public.ans_knowledge_chunks;
    EXECUTE $tg$
      CREATE TRIGGER trg_ans_knowledge_chunks_invalidate_embedding
        BEFORE UPDATE OF content ON public.ans_knowledge_chunks
        FOR EACH ROW
        EXECUTE FUNCTION public.ans_knowledge_chunks_invalidate_embedding()
    $tg$;
    RAISE NOTICE '0007: embedding-freshness trigger installed';
  ELSE
    RAISE NOTICE '0007: ans_knowledge_chunks.embedding absent (no pgvector) — skipping freshness trigger.';
  END IF;
END$$;

-- 7. Operator health view — is RAG actually able to answer? ----------------------
--    Read-only aggregate. Exposes counts only; no chunk text, no patient data.
DO $$
DECLARE
  has_embedding boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ans_knowledge_chunks'
      AND column_name  = 'embedding'
  ) INTO has_embedding;

  EXECUTE format($v$
    CREATE OR REPLACE VIEW public.ans_rag_health AS
    SELECT
      (SELECT count(*) FROM public.ans_knowledge_sources)                     AS sources_total,
      (SELECT count(*) FROM public.ans_knowledge_sources
        WHERE review_status = 'approved' AND active_in_ai_analysis = true)    AS sources_approved_active,
      (SELECT count(*) FROM public.ans_knowledge_chunks)                      AS chunks_total,
      (SELECT count(*) FROM public.ans_knowledge_chunks c
         JOIN public.ans_knowledge_sources s ON s.id = c.source_id
        WHERE s.review_status = 'approved' AND s.active_in_ai_analysis = true) AS chunks_retrievable,
      (SELECT count(*) FROM public.ans_knowledge_chunks
        WHERE content_tsv IS NOT NULL AND content_tsv <> ''::tsvector)        AS chunks_fulltext_indexed,
      %s AS chunks_embedded,
      %s AS chunks_missing_embedding
  $v$,
    CASE WHEN has_embedding
      THEN '(SELECT count(*) FROM public.ans_knowledge_chunks WHERE embedding IS NOT NULL)'
      ELSE 'NULL::bigint' END,
    CASE WHEN has_embedding
      THEN '(SELECT count(*) FROM public.ans_knowledge_chunks c JOIN public.ans_knowledge_sources s ON s.id = c.source_id WHERE c.embedding IS NULL AND s.review_status = ''approved'' AND s.active_in_ai_analysis = true)'
      ELSE 'NULL::bigint' END
  );
  RAISE NOTICE '0007: ans_rag_health view created/refreshed';
END$$;

COMMENT ON VIEW public.ans_rag_health IS
  'Operator diagnostics for the ANS knowledge RAG pipeline. chunks_missing_embedding > 0 '
  'means POST /api/admin/knowledge/embed-backfill still has work; chunks_embedded IS NULL '
  'means pgvector/the embedding column is absent and retrieval is on the full-text tier.';

-- 8. Grants — service-role executes both retrieval functions. ---------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.match_ans_knowledge_chunks_lexical(text, int) TO service_role;
    GRANT SELECT ON public.ans_rag_health TO service_role;
  END IF;
END$$;

-- ============================================================
-- POST-APPLY VERIFICATION (run manually; read-only)
--
--   SELECT * FROM public.ans_rag_health;
--
--   -- full-text tier must return gated rows with composed citations:
--   SELECT chunk_index, left(content, 80) AS snippet, citation, similarity
--     FROM public.match_ans_knowledge_chunks_lexical('sympathetic withdrawal on standing', 5);
--
--   -- vector tier (only after the backfill has populated embeddings):
--   SELECT count(*) FROM public.ans_knowledge_chunks WHERE embedding IS NOT NULL;
-- ============================================================
