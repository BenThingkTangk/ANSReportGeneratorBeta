-- ============================================================
-- PhysioPS × HumanOS ANS Reporting AI
-- Migration: 0002_evidence_and_settings  (Akamai Managed PostgreSQL — humanos-ans-rag-pg)
--
-- Completes the migration of the AUTHORITATIVE knowledge / RAG read path off
-- Supabase and onto the dedicated Akamai PostgreSQL instance, so that admin
-- writes and live AI/report grounding read the SAME store (no split-brain):
--   ans_rule_evidence_links  — rule (finding|phenotype|domain) -> approved source
--   app_settings             — feature-flag key/value store (evidence toggle)
--   ans_report_explanations  — append-only, NON-PHI log of explanation runs
--   ans_knowledge_files      — private source binaries stored as bytea in PG
--                              (replaces the Supabase Storage 'knowledge-files'
--                              bucket) with strict size limits + an admin-only
--                              streaming download endpoint
--
-- Like 0001 this is a STANDALONE Postgres schema: it does NOT depend on
-- Supabase auth.users / auth.uid() / RLS. Authorization is enforced in the
-- application layer (the admin perimeter gateway) over a trusted service
-- connection, so ownership columns are plain nullable uuids (no FK to auth).
--
-- Fully IDEMPOTENT: safe to run repeatedly (CREATE ... IF NOT EXISTS, guarded
-- DO blocks, DROP TRIGGER IF EXISTS before CREATE). Runs after 0001 in the same
-- advisory-locked transaction (scripts/migrate-rag.mjs), so handle_updated_at()
-- and ans_knowledge_sources already exist.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ans_rule_evidence_links
--    Many-to-many bridge between a deterministic rule (finding code, phenotype
--    id, or domain key) and an approved knowledge source. The retrieval layer
--    additionally re-checks active_in_ai_analysis + review_status at read time
--    so archiving a source instantly stops it being cited.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_rule_evidence_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type       text NOT NULL CHECK (rule_type IN ('finding','phenotype','domain')),
  rule_key        text NOT NULL,
  source_id       uuid NOT NULL REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  evidence_quote  text,
  page_ref        text,
  notes           text,
  added_by        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ans_rule_evidence_links UNIQUE (rule_type, rule_key, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ans_rule_evidence_lookup ON public.ans_rule_evidence_links (rule_type, rule_key);
CREATE INDEX IF NOT EXISTS idx_ans_rule_evidence_source ON public.ans_rule_evidence_links (source_id);

DROP TRIGGER IF EXISTS ans_rule_evidence_links_updated_at ON public.ans_rule_evidence_links;
CREATE TRIGGER ans_rule_evidence_links_updated_at
  BEFORE UPDATE ON public.ans_rule_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------
-- 2. app_settings
--    Singleton-style key/value feature-flag store. `value` is jsonb so a flag
--    can be a boolean, number, string, or object. Seeds the evidence toggle
--    OFF (fail-safe: no citations until clinicians review the mappings).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'evidence_linked_explanations_enabled',
  'false'::jsonb,
  'Master toggle for citing Knowledge Library sources alongside report explanations. When false, explanations still include the deterministic rule trace but no source citations.'
)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 3. ans_report_explanations
--    Append-only log of explanation generations. Stores the rule trace and the
--    source IDs cited — NEVER raw .ans content and NEVER patient PII.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_report_explanations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_ref         text,
  scoring_version    text NOT NULL,
  evidence_enabled   boolean NOT NULL,
  num_bullets        int NOT NULL,
  num_with_evidence  int NOT NULL,
  num_rule_based     int NOT NULL,
  source_ids         uuid[] NOT NULL DEFAULT '{}',
  rule_keys          text[] NOT NULL DEFAULT '{}',
  generated_by       uuid,
  generated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_report_explanations_generated ON public.ans_report_explanations (generated_at DESC);

-- ------------------------------------------------------------
-- 4. ans_knowledge_files (private source binaries — replaces Supabase Storage)
--    One row per source (source_id PK gives natural upsert semantics). The
--    binary lives in the SAME authoritative store as the metadata + chunks, so
--    there is no external bucket and no signed-URL dependency. A DB-level size
--    CHECK (25 MB) backstops the handler's limit; the MIME allowlist is enforced
--    in the application layer. Downloads are served only through the admin-gated
--    streaming endpoint (api/admin/source-file) — the bytes never leave the
--    server except to an authorized admin/reviewer session.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ans_knowledge_files (
  source_id       uuid PRIMARY KEY REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_mime       text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0 AND file_size_bytes <= 26214400),
  content         bytea NOT NULL,
  sha256          text,
  uploaded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ans_knowledge_files_updated_at ON public.ans_knowledge_files;
CREATE TRIGGER ans_knowledge_files_updated_at
  BEFORE UPDATE ON public.ans_knowledge_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
