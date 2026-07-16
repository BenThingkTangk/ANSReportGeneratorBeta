-- ============================================================
-- PhysioPS × HumanOS ANS Reporting AI
-- Migration: 0001_knowledge_rag  (Akamai Managed PostgreSQL — humanos-ans-rag-pg)
--
-- Authoritative store for the admin-managed Knowledge / RAG library:
--   ans_knowledge_sources   — bibliographic + activation metadata
--   ans_knowledge_chunks    — chunked source text (+ optional pgvector embedding)
--   ans_knowledge_versions  — immutable change snapshots (create/update/delete)
--   ans_knowledge_audit     — who/what/when/ip audit trail
--
-- This is a STANDALONE Postgres schema — it deliberately does NOT depend on
-- Supabase's `auth.users` / `auth.uid()` / RLS. Authorization is enforced in the
-- application layer (the admin perimeter gateway) over a trusted service
-- connection, so ownership columns are plain nullable uuids (no FK to auth).
--
-- Fully IDEMPOTENT: safe to run repeatedly (CREATE ... IF NOT EXISTS, guarded
-- DO blocks, DROP TRIGGER IF EXISTS before CREATE). Intended to be executed by
-- scripts/migrate-rag.mjs inside a single transaction holding an advisory lock.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Optional pgvector extension (degrades safely if unavailable)
--    Wrapped in a sub-transaction (BEGIN/EXCEPTION = savepoint) so a managed
--    instance WITHOUT the `vector` extension does not abort the whole migration.
-- ------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
    RAISE NOTICE 'pgvector extension available — embeddings enabled.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension unavailable, continuing WITHOUT vector column: %', SQLERRM;
  END;
END $$;

-- ------------------------------------------------------------
-- 1. updated_at trigger function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 2. ans_knowledge_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_knowledge_sources (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                      text NOT NULL,
  authors                    text,
  year                       int,
  publication_type           text CHECK (publication_type IN ('book','journal_article','paper','internal_protocol','algorithm_rule','note','pdf','other')),
  journal                    text,
  publisher                  text,
  doi                        text,
  pubmed_id                  text,
  url                        text,
  abstract                   text,
  key_claims                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostic_relevance       text,
  ans_metrics                text[] NOT NULL DEFAULT '{}',
  tags                       text[] NOT NULL DEFAULT '{}',
  file_path                  text,
  file_mime                  text,
  file_size_bytes            bigint,
  used_in                    text[] NOT NULL DEFAULT '{}',
  active_in_ai_analysis      boolean NOT NULL DEFAULT false,
  active_in_report_citations boolean NOT NULL DEFAULT false,
  active_in_admin_review     boolean NOT NULL DEFAULT true,
  review_status              text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','pending_review','approved','archived','needs_review')),
  added_by                   uuid,
  last_updated_by            uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_status    ON public.ans_knowledge_sources(review_status);
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_active_ai ON public.ans_knowledge_sources(active_in_ai_analysis) WHERE active_in_ai_analysis = true;
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_type      ON public.ans_knowledge_sources(publication_type);
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_year      ON public.ans_knowledge_sources(year DESC);
-- Case-insensitive title uniqueness makes the curated seed re-runnable without
-- duplicating rows and gives create/import a natural idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ans_knowledge_sources_title_ci ON public.ans_knowledge_sources(lower(title));

DROP TRIGGER IF EXISTS ans_knowledge_sources_updated_at ON public.ans_knowledge_sources;
CREATE TRIGGER ans_knowledge_sources_updated_at
  BEFORE UPDATE ON public.ans_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------
-- 3. ans_knowledge_chunks (RAG passages)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  chunk_index  int NOT NULL,
  content      text NOT NULL,
  tokens       int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ans_knowledge_chunks_source_idx UNIQUE (source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_source ON public.ans_knowledge_chunks(source_id, chunk_index);

-- Optional embedding column + ANN index — added ONLY when pgvector is installed.
-- Content is always stored as text above, so retrieval never loses data when the
-- extension is absent; embeddings are a pure enhancement layered on top.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ans_knowledge_chunks' AND column_name = 'embedding'
    ) THEN
      ALTER TABLE public.ans_knowledge_chunks ADD COLUMN embedding vector(1536);
      RAISE NOTICE 'Added ans_knowledge_chunks.embedding vector(1536).';
    END IF;
    -- HNSW cosine index (pgvector >= 0.5). Tolerate older builds without HNSW.
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_embedding
        ON public.ans_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped HNSW embedding index (unsupported pgvector build): %', SQLERRM;
    END;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. ans_knowledge_versions (immutable change snapshots)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_knowledge_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid NOT NULL REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  version          int NOT NULL,
  change_action    text NOT NULL CHECK (change_action IN ('create','update','delete','activate','archive','import')),
  snapshot         jsonb NOT NULL,
  changed_by       uuid,
  changed_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ans_knowledge_versions_source_ver UNIQUE (source_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_versions_source ON public.ans_knowledge_versions(source_id, version DESC);

-- ------------------------------------------------------------
-- 5. ans_knowledge_audit (who/what/when trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_knowledge_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid,
  actor_email  text,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_audit_entity  ON public.ans_knowledge_audit(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_audit_created ON public.ans_knowledge_audit(created_at DESC);
