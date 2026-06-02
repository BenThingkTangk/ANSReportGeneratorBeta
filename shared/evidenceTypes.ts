/**
 * Evidence-linked explanation types.
 *
 * The evidence layer adds source citations to deterministic rule output
 * WITHOUT letting the AI invent unsupported claims. Every ExplanationItem
 * has a deterministic rule trace; the `evidence` array is OPTIONAL and only
 * populated when an admin has linked the rule to an active+approved
 * Knowledge Library source.
 */

import type {
  Confidence,
  DiagnosticSummary,
} from "./diagnosticSummary";

// ───────────────────────────────────────────────────────────
// Rule identification — three discriminated kinds
// ───────────────────────────────────────────────────────────

export type RuleType = "finding" | "phenotype" | "domain";

export interface RuleRef {
  /** Which kind of rule fired. */
  type: RuleType;
  /**
   * Stable key. For `finding` this is AbnormalFinding.code,
   * for `phenotype` it's PhenotypeFlag.id,
   * for `domain` it's the domain key (cardiovagal/adrenergic/sudomotor).
   */
  key: string;
  /** Optional human-readable label of the rule (for UI). */
  label?: string;
}

// ───────────────────────────────────────────────────────────
// EvidenceLink — a single citation
// ───────────────────────────────────────────────────────────

export interface EvidenceLink {
  /** ans_rule_evidence_links.id */
  linkId: string;
  /** ans_knowledge_sources.id */
  sourceId: string;
  title: string;
  authors: string | null;
  year: number | null;
  publicationType: string | null;
  /** Public URL if the source has one. NEVER a raw private bucket path. */
  url: string | null;
  /** Whether the source file lives in a private bucket. If true, callers
   *  must request a signed URL via the dedicated endpoint. */
  hasPrivateFile: boolean;
  /** Optional admin-curated quote / page reference. */
  evidenceQuote: string | null;
  pageRef: string | null;
}

// ───────────────────────────────────────────────────────────
// ExplanationItem — one bullet in the report's explanation list
// ───────────────────────────────────────────────────────────

export type EvidenceMode =
  /** At least one approved source is linked to this rule. */
  | "evidence-backed"
  /** Rule fired but no linked source — must be labelled accordingly. */
  | "rule-based"
  /** A required input was missing; this bullet records what was NOT said. */
  | "blocked";

export interface ExplanationItem {
  /** Display string (clinician-safe phrasing). */
  text: string;
  /** Companion plain-English string for patient-facing UI. */
  patientText: string;
  /** The deterministic rule that produced this bullet. */
  rule: RuleRef;
  /** Dotted AnsStudy paths used by the rule. */
  sourceFields: string[];
  /** Per-bullet confidence inherited from the rule. */
  confidence: Confidence;
  /** Whether evidence backs this bullet. */
  mode: EvidenceMode;
  /** Linked sources (empty when mode !== 'evidence-backed'). */
  evidence: EvidenceLink[];
  /** For blocked items: which fields were missing. */
  missingFields?: string[];
}

// ───────────────────────────────────────────────────────────
// ExplainedReport — full output of the explanation layer
// ───────────────────────────────────────────────────────────

export interface ExplainedReport {
  schemaVersion: "1.0";
  generatedAt: string;
  scoringVersion: string;
  /** Mirror of the source DiagnosticSummary for downstream renderers. */
  summary: DiagnosticSummary;
  /** Whether the evidence-linked toggle was ON at generation time. */
  evidenceEnabled: boolean;
  items: ExplanationItem[];
  /** Stable disclaimer for clinical decision support. */
  disclaimer: string;
  /** Patient-facing disclaimer (warmer language). */
  patientDisclaimer: string;
}

// ───────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────

export const EVIDENCE_SCHEMA_VERSION = "1.0" as const;

export const PATIENT_DISCLAIMER =
  "These notes explain what your test data shows in plain language. They are not a diagnosis. Please review them with your physician, who can put them in the context of your full health picture.";

export const RULE_BASED_LABEL =
  "Rule-based interpretation — no peer-reviewed source has been linked to this finding yet.";
