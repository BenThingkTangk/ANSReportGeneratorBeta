/**
 * ANS Accuracy Lab — eval schema (shared types).
 *
 * All eval data is local-first: each gold case lives as a JSON file under
 * `eval/fixtures/<case-id>.json`. The runner reads those files, parses each
 * `.ans` blob, scores it, and compares output against expectations.
 *
 * When Supabase is configured (admin runs the bundled migration), the same
 * shapes are persisted to the `ans_eval_*` tables. The local JSON files
 * remain the source of truth so the eval suite is reproducible in CI without
 * any cloud dependency.
 *
 * NO PHI in fixtures. Use synthetic names (Test Patient One, etc.).
 */

import type { Confidence, PhenotypeFlagId, Severity } from "./diagnosticSummary";

// ============================================================================
// Eval case (one row in `ans_eval_cases`)
// ============================================================================

export type EvalCaseScenario =
  | "normal"
  | "abnormal"
  | "missing"
  | "conflicting"
  | "low_quality"
  | "edge_case";

export interface EvalCase {
  /** Stable kebab-case id — used as filename and DB key. */
  id: string;
  /** Short human description. */
  description: string;
  scenario: EvalCaseScenario;
  /** Where this case came from (synthetic builder, anonymized real export, etc). */
  source: "synthetic" | "anonymized_real" | "clinician_correction" | "regression";
  /** Optional clinician notes — clinical context, why this case matters. */
  clinicianNotes?: string;
  /** Optional source/provenance reference (paper, protocol, ticket). */
  provenance?: string;
  /**
   * Base64-encoded .ans buffer. We use base64 so the case is a single JSON
   * file (no binary side-car) and so corrections written from the browser
   * round-trip cleanly.
   */
  ansBase64: string;
  /** Original filename to use during parse (filename-fallback extractor reads it). */
  fileName: string;

  expectedFields: ExpectedFields;
  expectedScores: ExpectedScores;
  expectedFlags: ExpectedFlags;

  /** ISO timestamp the fixture was written. */
  createdAt: string;
  /** Optional ISO timestamp of last edit. */
  updatedAt?: string;
}

// ============================================================================
// Expected fields (one row in `ans_eval_expected_fields`)
// ============================================================================

/**
 * Expected scalar field values. Use `null` to assert "must be missing".
 * Numeric fields support a `tolerance` for floating-point comparisons.
 */
export interface ExpectedScalar<T> {
  value: T | null;
  /** Allowed numeric drift (only meaningful for number fields). */
  tolerance?: number;
}

export interface ExpectedFields {
  /** Patient demographics. */
  lastName?: ExpectedScalar<string>;
  firstName?: ExpectedScalar<string>;
  ageAtStudy?: ExpectedScalar<number>;
  sex?: ExpectedScalar<string>;
  physician?: ExpectedScalar<string>;
  dob?: ExpectedScalar<string>;
  /** Numeric study metrics. */
  samplingRateHz?: ExpectedScalar<number>;
  baselineHr?: ExpectedScalar<number>;
  baselineSbp?: ExpectedScalar<number>;
  baselineDbp?: ExpectedScalar<number>;
  standHr?: ExpectedScalar<number>;
  standSbp?: ExpectedScalar<number>;
  standDbp?: ExpectedScalar<number>;
  eiRatio?: ExpectedScalar<number>;
  valsalvaRatio?: ExpectedScalar<number>;
  thirtyFifteenRatio?: ExpectedScalar<number>;
  /**
   * Dotted AnsStudy paths that MUST come back missing (null). The runner uses
   * this to score missing-detection accuracy.
   */
  expectedMissing?: string[];
}

// ============================================================================
// Expected scores (one row in `ans_eval_expected_scores`)
// ============================================================================

export interface ExpectedDomainScore {
  assessable: boolean;
  severity?: Severity;
  /** Numeric value tolerance — defaults to exact match. */
  valueTolerance?: number;
  expectedValue?: number | null;
  /** Minimum acceptable confidence (e.g. won't allow High to drop to Low). */
  minConfidence?: Confidence;
}

export interface ExpectedScores {
  cardiovagal?: ExpectedDomainScore;
  adrenergic?: ExpectedDomainScore;
  sudomotor?: ExpectedDomainScore;
  /** Allowed drift for totalAutonomicSeverityScore. */
  totalSeverityTolerance?: number;
  expectedTotalSeverity?: number;
  /** Allowed drift on reportConfidenceScore (0..1). */
  reportConfidenceTolerance?: number;
  expectedReportConfidence?: Confidence;
}

// ============================================================================
// Expected phenotype flags
// ============================================================================

export interface ExpectedPhenotypeFlag {
  id: PhenotypeFlagId;
  /**
   * Must this flag be PRESENT (`true`), absent (`false`), or simply not
   * present at all (`"absent"` — distinguishes from a flag emitted with
   * present=false vs. one not emitted)?
   */
  present: boolean | "absent";
}

export interface ExpectedFlags {
  phenotypes: ExpectedPhenotypeFlag[];
  /**
   * Phenotype claim names that the engine MUST refuse to assert (because
   * required inputs are missing). Validates the unsafeOrUnsupportedClaimsBlocked
   * channel actually blocks the right things.
   */
  expectedBlockedClaims?: string[];
  /**
   * Stable abnormal-finding codes that MUST appear.
   */
  expectedFindingCodes?: string[];
  /** Finding codes that MUST NOT appear (false-positive guard). */
  forbiddenFindingCodes?: string[];
}

// ============================================================================
// Eval run + failures (rows in `ans_eval_runs` and `ans_eval_failures`)
// ============================================================================

export interface EvalRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  parserVersion: string;
  scoringVersion: string;
  gitSha?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  metrics: EvalMetrics;
  caseResults: EvalCaseResult[];
}

export interface EvalCaseResult {
  caseId: string;
  scenario: EvalCaseScenario;
  passed: boolean;
  /** Individual sub-assertion failures (empty when passed). */
  failures: EvalFailure[];
  /** Per-case metric snapshot. */
  metrics: EvalMetrics;
  durationMs: number;
}

export interface EvalFailure {
  /** Which assertion family failed. */
  category:
    | "demographics"
    | "numeric"
    | "missing_detection"
    | "domain_score"
    | "phenotype_flag"
    | "blocked_claim"
    | "finding_code"
    | "report_confidence"
    | "unsafe_overclaim"
    | "parser_error";
  /** Short stable code (e.g. "EI_RATIO_MISMATCH"). */
  code: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  /** Dotted path into AnsStudy / DiagnosticSummary. */
  path?: string;
}

// ============================================================================
// Eval metrics (computed per case and aggregated per run)
// ============================================================================

export interface EvalMetrics {
  /** Demographics: # correct / # expected. */
  demographicsAccuracy: { correct: number; total: number; ratio: number };
  /** Numeric metrics within tolerance: # correct / # expected. */
  numericAccuracy: { correct: number; total: number; ratio: number };
  /** Missing-data detection: were expectedMissing fields actually null? */
  missingDetection: { correct: number; total: number; ratio: number };
  /** Abnormality flag precision/recall. */
  abnormalityFlags: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
  };
  /** Mean absolute difference between expected and actual domain scores. */
  scoreAgreement: {
    cardiovagalMad: number | null;
    adrenergicMad: number | null;
    totalSeverityMad: number | null;
  };
  /**
   * Count of disease assertions the engine emitted that lacked supporting
   * data (should always be 0). A nonzero value is a hard regression.
   */
  unsafeOverclaimCount: number;
}

// ============================================================================
// Clinician correction (row in `ans_clinician_corrections`)
// ============================================================================

export interface ClinicianCorrection {
  id: string;
  /** Either a case_id (regression) or a freeform report_id (live report). */
  caseId?: string;
  reportRef?: string;
  /** Who submitted the correction. */
  clinicianEmail: string;
  /** What the engine produced (DiagnosticSummary JSON, trimmed). */
  engineOutput: unknown;
  /** What the clinician says is correct. */
  correctedFields?: Partial<ExpectedFields>;
  correctedScores?: Partial<ExpectedScores>;
  correctedFlags?: Partial<ExpectedFlags>;
  /** Free-form rationale. */
  notes?: string;
  /** ISO timestamp of submission. */
  createdAt: string;
  /** True when this correction has been promoted to a gold-case fixture. */
  promotedToFixture: boolean;
  /** Fixture id if promoted. */
  promotedCaseId?: string;
}

// ============================================================================
// CI regression gate config
// ============================================================================

/**
 * The eval runner exits non-zero when these thresholds are violated.
 * Tunable per-repo via `eval/regression-gate.json`.
 */
export interface RegressionGate {
  /** Hard floor on overall pass rate (0..1). */
  minPassRate: number;
  /** Hard floor on demographics accuracy. */
  minDemographicsAccuracy: number;
  /** Hard floor on numeric accuracy. */
  minNumericAccuracy: number;
  /** Hard floor on missing-data detection accuracy. */
  minMissingDetection: number;
  /** Hard floor on abnormality flag F1. */
  minFlagF1: number;
  /** Max allowed unsafe overclaims. ALWAYS 0 — safety invariant. */
  maxUnsafeOverclaims: number;
}

export const DEFAULT_REGRESSION_GATE: RegressionGate = {
  minPassRate: 1.0,                // every gold case must pass
  minDemographicsAccuracy: 0.95,
  minNumericAccuracy: 0.90,
  minMissingDetection: 1.0,        // missing detection is safety-critical
  minFlagF1: 0.85,
  maxUnsafeOverclaims: 0,          // hard zero — phenotypes must never assert without data
};
