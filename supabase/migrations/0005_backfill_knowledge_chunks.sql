-- ============================================================
-- 0005 — Make RAG functional: chunk citation columns + backfill
--         chunks from seeded source metadata.
--
-- Context: 0002 seeds 13 ans_knowledge_sources rows (rich abstract +
-- key_claims) but 0 ans_knowledge_chunks, so retrieval returned nothing
-- ("13 sources / 0 chunks"). The chunk writer only ran on file uploads, which
-- the seeded rows never had. This migration:
--   1. adds `page` and `section` columns for source/page citations,
--   2. backfills one chunk per approved+active source from its metadata text
--      (title + abstract + key_claims), so the corpus is immediately
--      searchable without a file re-upload.
--
-- The application-level reindex endpoint (api/admin/knowledge/reindex.ts) can
-- re-run this idempotently and split long sources into multiple chunks; this
-- migration guarantees a functional floor in a fresh database.
--
-- SAFETY: operates ONLY on curated ans_knowledge_sources rows. No patient data.
-- ============================================================

ALTER TABLE public.ans_knowledge_chunks
  ADD COLUMN IF NOT EXISTS page    int,
  ADD COLUMN IF NOT EXISTS section text;

-- Backfill: one metadata chunk per active+approved source that has no chunks.
-- key_claims (jsonb array of strings) is flattened into newline-joined text.
INSERT INTO public.ans_knowledge_chunks (source_id, chunk_index, content, tokens, section)
SELECT
  s.id,
  0 AS chunk_index,
  concat_ws(
    E'\n\n',
    s.title,
    s.abstract,
    (
      SELECT string_agg(claim.value, E'\n')
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(s.key_claims) = 'array' THEN s.key_claims ELSE '[]'::jsonb END
      ) AS claim(value)
    )
  ) AS content,
  ceil(length(concat_ws(' ', s.title, s.abstract)) / 4.0)::int AS tokens,
  'metadata' AS section
FROM public.ans_knowledge_sources s
WHERE s.active_in_ai_analysis = true
  AND s.review_status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.ans_knowledge_chunks c WHERE c.source_id = s.id
  )
  AND coalesce(nullif(trim(concat_ws(' ', s.title, s.abstract)), ''), '') <> '';
