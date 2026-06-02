-- ============================================================
-- PhysioPS × HumanOS ANS Accuracy Lab
-- Migration: 0003_ans_accuracy_lab
-- Eval cases, runs, failures, and clinician corrections.
--
-- This migration is OPTIONAL. The eval runner is local-first and
-- reads JSON fixtures under /eval/fixtures regardless of whether
-- Supabase is configured. These tables exist for teams that want
-- to centralize gold cases, run history, and clinician feedback.
-- ============================================================

-- ============================================================
-- 1. ans_eval_cases — one row per gold-standard fixture
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_eval_cases (
  id              text PRIMARY KEY,             -- stable kebab-case id (matches fixture filename)
  description     text NOT NULL,
  scenario        text NOT NULL CHECK (scenario IN
                    ('normal','abnormal','missing','conflicting','low_quality','edge_case')),
  source          text NOT NULL CHECK (source IN
                    ('synthetic','anonymized_real','clinician_correction','regression')),
  clinician_notes text,
  provenance      text,
  ans_base64      text NOT NULL,
  file_name       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ans_eval_cases_scenario_idx
  ON public.ans_eval_cases(scenario);

-- ============================================================
-- 2. ans_eval_expected_fields — patient/numeric/missing expectations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_eval_expected_fields (
  case_id          text PRIMARY KEY REFERENCES public.ans_eval_cases(id) ON DELETE CASCADE,
  expected_fields  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- shape matches shared/evalTypes.ts:ExpectedFields
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. ans_eval_expected_scores — per-domain + total expectations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_eval_expected_scores (
  case_id          text PRIMARY KEY REFERENCES public.ans_eval_cases(id) ON DELETE CASCADE,
  expected_scores  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- shape matches shared/evalTypes.ts:ExpectedScores
  expected_flags   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- shape matches shared/evalTypes.ts:ExpectedFlags
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. ans_eval_runs — one row per CI / manual eval invocation
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_eval_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           text UNIQUE NOT NULL,         -- friendlier id used in logs/UI
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz NOT NULL,
  parser_version   text NOT NULL,
  scoring_version  text NOT NULL,
  git_sha          text,
  total_cases      int NOT NULL,
  passed_cases     int NOT NULL,
  failed_cases     int NOT NULL,
  metrics          jsonb NOT NULL,               -- aggregated EvalMetrics
  gate             jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_passed      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ans_eval_runs_started_at_idx
  ON public.ans_eval_runs(started_at DESC);

-- ============================================================
-- 5. ans_eval_failures — granular failure rows for diffing
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_eval_failures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       text NOT NULL REFERENCES public.ans_eval_runs(run_id) ON DELETE CASCADE,
  case_id      text NOT NULL,
  category     text NOT NULL CHECK (category IN (
    'demographics','numeric','missing_detection','domain_score','phenotype_flag',
    'blocked_claim','finding_code','report_confidence','unsafe_overclaim','parser_error'
  )),
  code         text NOT NULL,
  message      text NOT NULL,
  expected     jsonb,
  actual       jsonb,
  path         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ans_eval_failures_run_id_idx
  ON public.ans_eval_failures(run_id);
CREATE INDEX IF NOT EXISTS ans_eval_failures_case_id_idx
  ON public.ans_eval_failures(case_id);

-- ============================================================
-- 6. ans_clinician_corrections — feedback loop
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ans_clinician_corrections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              text REFERENCES public.ans_eval_cases(id) ON DELETE SET NULL,
  report_ref           text,
  clinician_email      text NOT NULL,
  engine_output        jsonb,
  corrected_fields     jsonb,
  corrected_scores     jsonb,
  corrected_flags      jsonb,
  notes                text,
  promoted_to_fixture  boolean NOT NULL DEFAULT false,
  promoted_case_id     text REFERENCES public.ans_eval_cases(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ans_clinician_corrections_case_id_idx
  ON public.ans_clinician_corrections(case_id);
CREATE INDEX IF NOT EXISTS ans_clinician_corrections_promoted_idx
  ON public.ans_clinician_corrections(promoted_to_fixture);

-- ============================================================
-- RLS — admins read/write; everyone else denied
-- ============================================================
ALTER TABLE public.ans_eval_cases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ans_eval_expected_fields   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ans_eval_expected_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ans_eval_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ans_eval_failures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ans_clinician_corrections  ENABLE ROW LEVEL SECURITY;

-- Helper: admin check (matches the convention from migration 0001).
CREATE OR REPLACE FUNCTION public.is_ans_admin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role IN ('super_admin','clinical_admin','reviewer')
  );
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ans_eval_cases',
    'ans_eval_expected_fields',
    'ans_eval_expected_scores',
    'ans_eval_runs',
    'ans_eval_failures',
    'ans_clinician_corrections'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_all ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_admin_all ON public.%I
         FOR ALL TO authenticated
         USING (public.is_ans_admin(auth.uid()))
         WITH CHECK (public.is_ans_admin(auth.uid()));',
      t, t
    );
  END LOOP;
END $$;
