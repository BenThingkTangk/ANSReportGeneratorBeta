-- ============================================================
-- PhysioPS × HumanOS ANS Reporting AI
-- Migration: 0001_knowledge_and_change_requests
-- Supabase Postgres — Knowledge Library + Change Requests admin
-- ============================================================

-- ============================================================
-- 1. user_roles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('super_admin','clinical_admin','reviewer','viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. ans_knowledge_sources
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_knowledge_sources (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                     text NOT NULL,
  authors                   text,
  year                      int,
  publication_type          text CHECK (publication_type IN ('book','journal_article','paper','internal_protocol','algorithm_rule','note','pdf','other')),
  journal                   text,
  publisher                 text,
  doi                       text,
  pubmed_id                 text,
  url                       text,
  abstract                  text,
  key_claims                jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostic_relevance      text,
  ans_metrics               text[] NOT NULL DEFAULT '{}',
  tags                      text[] NOT NULL DEFAULT '{}',
  file_path                 text,
  file_mime                 text,
  file_size_bytes           bigint,
  used_in                   text[] NOT NULL DEFAULT '{}',
  -- used_in values: 'AI prompt', 'algorithm', 'report generator', 'evidence panel', 'recommendations', 'briefing'
  active_in_ai_analysis     boolean NOT NULL DEFAULT false,
  active_in_report_citations boolean NOT NULL DEFAULT false,
  active_in_admin_review    boolean NOT NULL DEFAULT true,
  review_status             text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','pending_review','approved','archived','needs_review')),
  added_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_updated_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_status ON public.ans_knowledge_sources(review_status);
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_active_ai ON public.ans_knowledge_sources(active_in_ai_analysis) WHERE active_in_ai_analysis = true;
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_type ON public.ans_knowledge_sources(publication_type);
CREATE INDEX IF NOT EXISTS idx_ans_knowledge_sources_year ON public.ans_knowledge_sources(year DESC);

-- ============================================================
-- 3. ans_knowledge_chunks (future RAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  chunk_index  int NOT NULL,
  content      text NOT NULL,
  tokens       int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_knowledge_chunks_source ON public.ans_knowledge_chunks(source_id, chunk_index);

-- ============================================================
-- 4. app_change_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_change_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  category           text CHECK (category IN ('clinical_logic','algorithm_rule','report_language','ui_ux','citation_evidence','data_parsing','admin','bug','feature_request')),
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  description        text,
  suggested_fix      text,
  screenshot_path    text,
  related_report_id  text, -- free-form, NO PHI
  status             text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','accepted','in_progress','completed','rejected')),
  submitted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_notes        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_change_requests_status ON public.app_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_app_change_requests_priority ON public.app_change_requests(priority);
CREATE INDEX IF NOT EXISTS idx_app_change_requests_submitted_by ON public.app_change_requests(submitted_by);

-- ============================================================
-- 5. admin_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity ON public.admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log(created_at DESC);

-- ============================================================
-- 6. updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER ans_knowledge_sources_updated_at
  BEFORE UPDATE ON public.ans_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER app_change_requests_updated_at
  BEFORE UPDATE ON public.app_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 7. Auto-assign role on new user signup (allowlist trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role text;
BEGIN
  v_role := CASE NEW.email
    WHEN 'ben.oleary@thingktangk.com' THEN 'super_admin'
    WHEN 'jcolombo@physiops.com'       THEN 'clinical_admin'
    WHEN 'soleary@physiops.com'        THEN 'clinical_admin'
    ELSE NULL
  END;

  IF v_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, v_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- ============================================================
-- 8. Row-Level Security
-- ============================================================

-- user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "user_roles_insert_super_admin" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

CREATE POLICY "user_roles_update_super_admin" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

CREATE POLICY "user_roles_delete_super_admin" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- ans_knowledge_sources
ALTER TABLE public.ans_knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_select" ON public.ans_knowledge_sources
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "knowledge_insert" ON public.ans_knowledge_sources
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin')
    )
  );

CREATE POLICY "knowledge_update" ON public.ans_knowledge_sources
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "knowledge_delete" ON public.ans_knowledge_sources
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- ans_knowledge_chunks (follows source access)
ALTER TABLE public.ans_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chunks_select" ON public.ans_knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "chunks_insert" ON public.ans_knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin')
    )
  );

CREATE POLICY "chunks_delete" ON public.ans_knowledge_chunks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- app_change_requests
ALTER TABLE public.app_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_select" ON public.app_change_requests
  FOR SELECT TO authenticated
  USING (
    submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "cr_insert" ON public.app_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "cr_update" ON public.app_change_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "cr_delete" ON public.app_change_requests
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- audit_log
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert_authenticated" ON public.admin_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "audit_select_super_admin" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- ============================================================
-- 9. Storage bucket policies (applied via Supabase Dashboard/CLI)
-- SQL equivalent for reference — run after creating bucket 'knowledge-files'
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge-files', 'knowledge-files', false)
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "knowledge_files_upload" ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'knowledge-files'
--     AND EXISTS (
--       SELECT 1 FROM public.user_roles ur
--       WHERE ur.user_id = auth.uid()
--         AND ur.role IN ('super_admin','clinical_admin')
--     )
--   );
--
-- CREATE POLICY "knowledge_files_select" ON storage.objects
--   FOR SELECT TO authenticated
--   USING (
--     bucket_id = 'knowledge-files'
--     AND EXISTS (
--       SELECT 1 FROM public.user_roles ur
--       WHERE ur.user_id = auth.uid()
--         AND ur.role IN ('super_admin','clinical_admin','reviewer')
--     )
--   );
--
-- INSERT INTO storage.buckets (id, name, public) VALUES ('change-request-screenshots', 'change-request-screenshots', false)
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "cr_screenshots_upload" ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'change-request-screenshots'
--     AND EXISTS (
--       SELECT 1 FROM public.user_roles ur
--       WHERE ur.user_id = auth.uid()
--         AND ur.role IN ('super_admin','clinical_admin','reviewer')
--     )
--   );
