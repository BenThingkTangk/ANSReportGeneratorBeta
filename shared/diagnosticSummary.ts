/**
 * DiagnosticSummary — deterministic, rules-first ANS scoring output.
 *
 * Computed by api/_ans/scoring/* from a normalized AnsStudy. The AI narrative
 * layer may EXPLAIN these results, but it must never override them.
 *
 * Safety invariants enforced by the scoring layer:
 *   - Missing inputs ≠ normal. Domains lacking required fields come back with
 *     `assessable: false` and feed `missingDomains`, never a zero score.
 *   - Phenotype flags use language like "pattern consistent with X" — never
 *     "patient has X". A blocked phenotype is recorded in
 *     `unsafeOrUnsupportedClaimsBlocked` with the missing field path.
 *   - Severity scoring is SEPARATE from phenotype suggestions.
 *   - Total severity = sum of ASSESSED domain scores only.
 *
 * This module has NO runtime dependencies — safe to import from server + client.
 */

// ============================================================================
// Confidence primitives
// ============================================================================

export type Confidence = "High" | "Medium" | "Low";

/**
 * Per-domain severity grade. The numeric value is on a 0..3 ASS-style scale
 * (0 normal, 1 mild, 2 moderate, 3 severe). Higher = more abnormal.
 */
export type Severity = "normal" | "mild" | "moderate" | "severe" | "not_assessed";

export interface DomainScore {
  /** Domain key — stable identifier. */
  domain: "cardiovagal" | "adrenergic" | "sudomotor";
  /**
   * Numeric severity on a 0..3 scale. `null` when the domain could not be
   * assessed (do NOT substitute 0 — that would imply normal).
   */
  value: number | null;
  severity: Severity;
  /** Human-readable explanation of how this score was derived. */
  rationale: string;
  /** Dotted AnsStudy paths that contributed to this score. */
  sourceFields: string[];
  /** Aggregate confidence in this domain score. */
  confidence: Confidence;
  /** False ⇒ this domain was not measurable in the input study. */
  assessable: boolean;
  /** Reason this domain was not assessable (only set when assessable=false). */
  notAssessedReason?: string;
  /**
   * Method limitation that caps the strength of an ASSESSABLE domain. E.g. the
   * adrenergic axis scored from cuff orthostatic deltas is an
   * orthostatic-hypotension SCREEN only — a full adrenergic/baroreflex grade
   * requires beat-to-beat BP (Valsalva late phase II / phase IV), which the
   * .ans format does not carry. When set, consumers must NOT present the domain
   * as a definitive/complete adrenergic assessment.
   */
  methodLimitation?: string;
  /**
   * When true, this domain is a partial screen (not a full grade) and no
   * definitive dysautonomia/CAN/adrenergic-failure claim may be derived from it.
   */
  screenOnly?: boolean;
}

// ============================================================================
// Phenotype flags (pattern suggestions — NEVER disease assertions)
// ============================================================================

export type PhenotypeFlagId =
  | "orthostatic_hypotension"
  | "pots_like"
  | "cardiovagal_impairment"
  | "adrenergic_impairment"
  | "parasympathetic_withdrawal"
  | "sympathetic_excess"
  | "possible_can_risk"
  | "insufficient_data";

export interface PhenotypeFlag {
  id: PhenotypeFlagId;
  /** Human-readable phrasing — must be "pattern consistent with…" style. */
  label: string;
  /** True when the rule's required inputs are present AND criteria are met. */
  present: boolean;
  /** Bullet list of the specific criteria evaluated (met or not). */
  criteria: Array<{
    description: string;
    met: boolean;
    sourceField?: string;
  }>;
  rationale: string;
  sourceFields: string[];
  confidence: Confidence;
}

// ============================================================================
// Abnormal finding (granular, citable)
// ============================================================================

export interface AbnormalFinding {
  /** Stable code, e.g. "EI_RATIO_LOW", "ORTHO_BP_DROP". */
  code: string;
  /** Human-readable summary of the abnormality. */
  message: string;
  /** Which domain it belongs to. */
  domain: "cardiovagal" | "adrenergic" | "sudomotor" | "general";
  /** Severity bucket for this individual finding. */
  severity: Severity;
  /** Dotted AnsStudy paths that produced this finding. */
  sourceFields: string[];
  /** Threshold(s) that were crossed, for transparency. */
  thresholdRef?: string;
  confidence: Confidence;
}

// ============================================================================
// Blocked claim (transparency: what we did NOT say and why)
// ============================================================================

export interface BlockedClaim {
  /** Which phenotype/finding we wanted to evaluate. */
  claim: string;
  /** Why we couldn't — list the missing AnsStudy field paths. */
  missingFields: string[];
  /** Friendly explanation for the UI. */
  explanation: string;
}

// ============================================================================
// Top-level DiagnosticSummary
// ============================================================================

export interface DiagnosticSummary {
  schemaVersion: "1.0";
  /** ISO timestamp when this summary was computed. */
  computedAt: string;
  /** Scoring engine version — bump when rules change. */
  scoringVersion: string;

  // Per-domain scores
  cardiovagalScore: DomainScore;
  adrenergicScore: DomainScore;
  sudomotorScore: DomainScore;

  /**
   * Sum of assessable domain values. Missing domains are NOT defaulted to 0.
   * Range: 0..(numAssessedDomains * 3).
   */
  totalAutonomicSeverityScore: number;
  /** numAssessedDomains * 3 — the ceiling for the current assessment. */
  maxPossibleScore: number;

  domainsAssessed: Array<"cardiovagal" | "adrenergic" | "sudomotor">;
  missingDomains: Array<"cardiovagal" | "adrenergic" | "sudomotor">;

  abnormalFindings: AbnormalFinding[];
  phenotypeFlags: PhenotypeFlag[];

  /** Overall confidence in the report (rolls up parser + per-domain). */
  reportConfidence: Confidence;
  /** Numeric overall confidence on 0..1 scale for fine-grained UI rings. */
  reportConfidenceScore: number;

  /**
   * Phenotype claims (or findings) that the scoring layer WANTED to assert but
   * blocked because required inputs were missing. Shown in the Data Quality
   * panel so clinicians know what was NOT evaluated.
   */
  unsafeOrUnsupportedClaimsBlocked: BlockedClaim[];

  /** Short bulleted explanation strings rendered in the report. */
  explanationBullets: string[];

  /**
   * Fixed disclaimer text — always render this verbatim under any clinical
   * interpretation derived from the summary.
   */
  disclaimer: string;
}

// ============================================================================
// Constants
// ============================================================================

export const SCORING_VERSION = "ans-scoring/1.0.0";

export const DIAGNOSTIC_DISCLAIMER =
  "This is clinical decision support, not a diagnosis. Confirm with clinical correlation.";
