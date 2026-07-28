-- ============================================================
-- 0005 — RAG chunk citation metadata columns (page, section)
--
-- Context: migrations 0001–0004 create ans_knowledge_chunks with columns
--   id, source_id, chunk_index, content, tokens, created_at, embedding
-- but NO page/section columns. Selecting them (for source/page citations) on
-- that legacy schema makes PostgREST return 42703 ("column ... does not exist").
-- The application already tolerates their absence at runtime
-- (api/_ans/knowledgeSchema.ts probes and falls back), so this migration is an
-- OPTIONAL enhancement that unlocks page/section-accurate citations.
--
-- This migration is PURE, IDEMPOTENT, ADDITIVE DDL:
--   * adds two nullable columns if they are not already present;
--   * changes NO existing rows and NO existing columns (incl. `embedding`);
--   * ingests NO content (chunks are created on demand by the admin reindex/
--     upload endpoints, which honestly mark metadata-only chunks as
--     non-functional — see api/admin/knowledge/reindex.ts and
--     docs/RAG_ACTIVATION.md). It does NOT invent or seed source content.
--
-- SAFETY: `ADD COLUMN IF NOT EXISTS` for a nullable column with no default is a
-- catalog-only change (no table rewrite, brief ACCESS EXCLUSIVE lock), safe to
-- run repeatedly. No patient data is touched; no source rows are modified.
-- ============================================================

ALTER TABLE public.ans_knowledge_chunks
  ADD COLUMN IF NOT EXISTS page    int,
  ADD COLUMN IF NOT EXISTS section text;
