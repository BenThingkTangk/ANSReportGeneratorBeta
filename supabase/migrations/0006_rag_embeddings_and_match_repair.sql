-- ============================================================
-- 0006 — RAG repair: embedding column + FIXED match_ans_knowledge_chunks
--
-- WHY THIS EXISTS
-- The live project (xsjwubnmcivsskumvgyy) has a
-- `public.match_ans_knowledge_chunks` function that was created out-of-band and
-- references columns that DO NOT EXIST on public.ans_knowledge_sources:
--     s.status      → the real column is  s.review_status
--     s.is_active   → the real column is  s.active_in_ai_analysis
--     s.citation    → no such column; a citation must be COMPOSED from
--                     title / authors / year / publication_type
-- Any call therefore fails with 42703 (undefined column). This migration
-- replaces that function with one that matches the real schema (see 0001) and
-- filters exactly on review_status = 'approved' AND active_in_ai_analysis = true.
--
-- It also makes the vector plumbing explicit and idempotent:
--   * enables the `vector` extension if available,
--   * adds ans_knowledge_chunks.embedding vector(1024) IF NOT EXISTS,
--   * adds a cosine ANN index when the extension + column are present.
-- 1024 dims matches pplx-embed-v1-0.6b (see api/_ans/embeddings.ts) and stays
-- under pgvector's 2000-dim index ceiling.
--
-- SAFETY / SCOPE
--   * PURE ADDITIVE + FUNCTION REPLACEMENT. No existing row is modified, no
--     column is dropped or retyped, no content is seeded or invented.
--   * Embeddings are NOT generated here (SQL has no provider access). They are
--     backfilled by the admin-only route POST /api/admin/knowledge/embed-backfill,
--     which uses the server-side provider credential. Rows keep embedding = NULL
--     until then, and retrieval degrades to the deterministic lexical ranker.
--   * Touches NO patient data and NOTHING in the deterministic .ans parser or any
--     clinical calculation.
--   * Every statement is guarded so the migration is safe to re-run and safe on a
--     database where pgvector is unavailable (it then skips vector-only objects
--     and the app simply stays on lexical retrieval).
-- ============================================================

-- 1. pgvector (best-effort: skip silently when the extension is unavailable). ----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  ELSE
    RAISE NOTICE '0006: pgvector unavailable — skipping vector column/index; lexical retrieval remains active.';
  END IF;
END$$;

-- 2. embedding column (only when the vector type exists). -----------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'ans_knowledge_chunks'
        AND column_name  = 'embedding'
    ) THEN
      EXECUTE 'ALTER TABLE public.ans_knowledge_chunks ADD COLUMN embedding vector(1024)';
      RAISE NOTICE '0006: added ans_knowledge_chunks.embedding vector(1024)';
    END IF;
  END IF;
END$$;

-- 3. Partial ANN index over rows that actually have a vector. -------------------
--    Cosine ops match the L2-normalised vectors the app stores.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ans_knowledge_chunks' AND column_name='embedding'
     ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_embedding_cos '
           || 'ON public.ans_knowledge_chunks USING hnsw (embedding vector_cosine_ops)';
    EXCEPTION WHEN undefined_object OR feature_not_supported THEN
      -- Older pgvector without HNSW: fall back to IVFFlat, else no index at all
      -- (sequential scan is fine for a small curated corpus).
      BEGIN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_embedding_cos '
             || 'ON public.ans_knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '0006: no ANN index created (pgvector too old); exact search will be used.';
      END;
    END;
  END IF;
END$$;

-- 4. Helper index for the backfill job (find NULL-embedding rows fast). ---------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ans_knowledge_chunks' AND column_name='embedding'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_embedding_null '
         || 'ON public.ans_knowledge_chunks (id) WHERE embedding IS NULL';
  END IF;
END$$;

-- 5. THE FIX: replace match_ans_knowledge_chunks with a schema-correct version. -
--    Only created when pgvector is present (the signature needs `vector`).
--    Contract:
--      match_ans_knowledge_chunks(query_embedding vector(1024),
--                                 match_threshold float default 0.0,
--                                 match_count int default 8)
--    Returns chunk id/source_id/chunk_index/content, a COMPOSED citation, and a
--    cosine similarity in [0,1]. Filters to approved + AI-active sources ONLY, so
--    unapproved or deactivated knowledge can never reach a clinical answer.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    RAISE NOTICE '0006: pgvector absent — skipping match_ans_knowledge_chunks (app uses lexical retrieval).';
    RETURN;
  END IF;

  -- Drop every prior overload so the broken definition cannot linger.
  PERFORM 1;
  EXECUTE (
    SELECT COALESCE(string_agg(
             format('DROP FUNCTION IF EXISTS public.%I(%s);', p.proname,
                    pg_get_function_identity_arguments(p.oid)), ' '),
           '')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_ans_knowledge_chunks'
  );

  EXECUTE $fn$
    CREATE FUNCTION public.match_ans_knowledge_chunks(
      query_embedding vector(1024),
      match_threshold float DEFAULT 0.0,
      match_count     int   DEFAULT 8
    )
    RETURNS TABLE (
      id          uuid,
      source_id   uuid,
      chunk_index int,
      content     text,
      citation    text,
      title       text,
      authors     text,
      year        int,
      publication_type text,
      url         text,
      similarity  float
    )
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = public
    AS $body$
      SELECT
        c.id,
        c.source_id,
        c.chunk_index,
        c.content,
        -- Citation COMPOSED from real metadata (there is no s.citation column):
        --   "Title (Year) — Authors"  with graceful omission of missing parts.
        (
          s.title
          || COALESCE(' (' || s.year::text || ')', '')
          || COALESCE(' — ' || NULLIF(btrim(s.authors), ''), '')
        )::text AS citation,
        s.title,
        s.authors,
        s.year,
        s.publication_type,
        s.url,
        -- pgvector cosine DISTANCE (<=>) is 0 (identical) … 2 (opposite).
        (1 - (c.embedding <=> query_embedding))::float AS similarity
      FROM public.ans_knowledge_chunks c
      JOIN public.ans_knowledge_sources s ON s.id = c.source_id
      WHERE c.embedding IS NOT NULL
        -- REAL columns (previously s.status / s.is_active → 42703):
        AND s.review_status = 'approved'
        AND s.active_in_ai_analysis = true
        AND (1 - (c.embedding <=> query_embedding)) >= match_threshold
      ORDER BY c.embedding <=> query_embedding
      LIMIT GREATEST(match_count, 1);
    $body$;
  $fn$;

  RAISE NOTICE '0006: match_ans_knowledge_chunks recreated against the real schema.';
END$$;

-- 6. Least-privilege grants (service role already bypasses RLS). ----------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='match_ans_knowledge_chunks'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.match_ans_knowledge_chunks(vector, float, int) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_ans_knowledge_chunks(vector, float, int) TO service_role';
    -- `authenticated` may execute; the function is SECURITY INVOKER, so RLS on
    -- the underlying tables still applies to end-user callers.
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_ans_knowledge_chunks(vector, float, int) TO authenticated';
  END IF;
END$$;
