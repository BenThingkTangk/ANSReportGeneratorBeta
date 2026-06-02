-- ============================================================
-- PhysioPS × HumanOS ANS — Migration 0004
-- Evidence-linked explanations
--   - ans_rule_evidence_links: maps deterministic rule codes -> knowledge sources
--   - ans_report_explanations: audit trail of generated explanations (no PHI)
--   - app_settings: feature flags (e.g. enable evidence-linked explanations)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ans_rule_evidence_links
--    A many-to-many bridge between a deterministic rule (finding code,
--    phenotype id, or domain key) and an approved knowledge source.
--    Only ACTIVE+APPROVED sources should be linked here; the retrieval
--    layer also re-checks at read time so a source being archived
--    instantly stops being cited.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ans_rule_evidence_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- rule_type discriminator:
  --   'finding'   = AbnormalFinding.code  (e.g. 'ORTHO_SBP_DROP_SEVERE')
  --   'phenotype' = PhenotypeFlag.id      (e.g. 'orthostatic_hypotension')
  --   'domain'    = DomainScore.domain    (e.g. 'cardiovagal')
  rule_type       text NOT NULL CHECK (rule_type IN ('finding','phenotype','domain')),
  rule_key        text NOT NULL,
  source_id       uuid NOT NULL REFERENCES public.ans_knowledge_sources(id) ON DELETE CASCADE,
  -- Optional pointer to a specific page / section / quote in the source.
  evidence_quote  text,
  page_ref        text,
  notes           text,
  added_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_type, rule_key, source_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_evidence_lookup
  ON public.ans_rule_evidence_links (rule_type, rule_key);
CREATE INDEX IF NOT EXISTS idx_rule_evidence_source
  ON public.ans_rule_evidence_links (source_id);

CREATE TRIGGER ans_rule_evidence_links_updated_at
  BEFORE UPDATE ON public.ans_rule_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. ans_report_explanations
--    Append-only log of explanation generations. Stores the rule trace
--    and source IDs cited — NOT raw .ans content and NOT patient PII.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ans_report_explanations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_ref         text,                 -- free-form, NO PHI (e.g. eval case id)
  scoring_version    text NOT NULL,
  evidence_enabled   boolean NOT NULL,
  num_bullets        int NOT NULL,
  num_with_evidence  int NOT NULL,
  num_rule_based     int NOT NULL,
  source_ids         uuid[] NOT NULL DEFAULT '{}',
  rule_keys          text[] NOT NULL DEFAULT '{}',
  generated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ans_report_explanations_generated
  ON public.ans_report_explanations (generated_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. app_settings
--    Singleton-style key/value store for feature flags.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key             text PRIMARY KEY,
  value           jsonb NOT NULL,
  description     text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed default: evidence-linked explanations OFF until clinicians review the mappings
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'evidence_linked_explanations_enabled',
  'false'::jsonb,
  'Master toggle for citing Knowledge Library sources alongside report explanations. When false, explanations still include the deterministic rule trace but no source citations.'
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.ans_rule_evidence_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rule_evidence_select" ON public.ans_rule_evidence_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin','reviewer')
    )
  );

CREATE POLICY "rule_evidence_insert" ON public.ans_rule_evidence_links
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin')
    )
  );

CREATE POLICY "rule_evidence_update" ON public.ans_rule_evidence_links
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin')
    )
  );

CREATE POLICY "rule_evidence_delete" ON public.ans_rule_evidence_links
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

ALTER TABLE public.ans_report_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_explanations_insert" ON public.ans_report_explanations
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- service role / authenticated report generation

CREATE POLICY "report_explanations_select" ON public.ans_report_explanations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','clinical_admin')
    )
  );

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can READ feature flags (so the client can render the
-- right UI) but only super_admins can change them.
CREATE POLICY "app_settings_select" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "app_settings_insert_super_admin" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

CREATE POLICY "app_settings_update_super_admin" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );
