/**
 * api/_buildExplanations.ts
 *
 * Converts a deterministic DiagnosticSummary into an ExplainedReport.
 * Each ExplanationItem carries the rule that fired, the AnsStudy source
 * fields it consumed, the confidence, and (optionally) approved
 * Knowledge Library citations.
 *
 * Pure-ish module: dependency injection lets tests run without Supabase.
 */

import type { DiagnosticSummary, Confidence } from "../shared/diagnosticSummary.js";
import {
  SCORING_VERSION,
  DIAGNOSTIC_DISCLAIMER,
} from "../shared/diagnosticSummary.js";
import type {
  EvidenceLink,
  ExplainedReport,
  ExplanationItem,
  RuleRef,
} from "../shared/evidenceTypes.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  PATIENT_DISCLAIMER,
  RULE_BASED_LABEL,
} from "../shared/evidenceTypes.js";
import {
  getEvidenceForRules,
  isEvidenceEnabled,
} from "./_evidenceRetrieval.js";

// ───────────────────────────────────────────────────────────
// Patient-friendly phrasing (clear, non-alarming)
// ───────────────────────────────────────────────────────────

function domainPatientLabel(d: "cardiovagal" | "adrenergic" | "sudomotor"): string {
  switch (d) {
    case "cardiovagal":
      return "your body's rest-and-recover signal (parasympathetic)";
    case "adrenergic":
      return "your blood-pressure regulation (sympathetic)";
    case "sudomotor":
      return "your sweat-gland nerve signal";
  }
}

function severityToPatient(severity: string): string {
  switch (severity) {
    case "normal":
      return "looks within the normal range";
    case "mild":
      return "shows a small departure from typical";
    case "moderate":
      return "shows a noticeable departure from typical";
    case "severe":
      return "shows a clear departure from typical — worth discussing with your physician";
    case "not_assessed":
      return "could not be assessed from this test";
    default:
      return "needs clinician review";
  }
}

// ───────────────────────────────────────────────────────────
// Rule extraction
// ───────────────────────────────────────────────────────────

interface ProtoItem {
  rule: RuleRef;
  text: string;
  patientText: string;
  sourceFields: string[];
  confidence: Confidence;
  mode: "rule-based" | "blocked";
  missingFields?: string[];
}

function extractProtoItems(summary: DiagnosticSummary): ProtoItem[] {
  const items: ProtoItem[] = [];

  // 1. Per-domain bullets
  for (const ds of [
    summary.cardiovagalScore,
    summary.adrenergicScore,
    summary.sudomotorScore,
  ]) {
    if (ds.assessable) {
      items.push({
        rule: { type: "domain", key: ds.domain, label: `${ds.domain} domain` },
        text: `${ds.domain.charAt(0).toUpperCase()}${ds.domain.slice(1)}: ${ds.severity} (score ${ds.value}/3, ${ds.confidence} confidence). ${ds.rationale}`,
        patientText: `${domainPatientLabel(ds.domain).charAt(0).toUpperCase()}${domainPatientLabel(ds.domain).slice(1)} ${severityToPatient(ds.severity)}.`,
        sourceFields: ds.sourceFields,
        confidence: ds.confidence,
        mode: "rule-based",
      });
    } else {
      items.push({
        rule: { type: "domain", key: ds.domain, label: `${ds.domain} domain` },
        text: `${ds.domain.charAt(0).toUpperCase()}${ds.domain.slice(1)}: not assessed — ${ds.notAssessedReason ?? "required inputs missing"}.`,
        patientText: `${domainPatientLabel(ds.domain).charAt(0).toUpperCase()}${domainPatientLabel(ds.domain).slice(1)} could not be evaluated from this test because some readings were missing.`,
        sourceFields: ds.sourceFields,
        confidence: "Low",
        mode: "blocked",
        missingFields: ds.sourceFields,
      });
    }
  }

  // 2. Abnormal findings
  for (const f of summary.abnormalFindings) {
    items.push({
      rule: { type: "finding", key: f.code, label: f.message },
      text: `${f.message} (${f.severity}, ${f.confidence} confidence${f.thresholdRef ? `, threshold: ${f.thresholdRef}` : ""}).`,
      patientText: patientPhraseForFinding(f.code, f.severity),
      sourceFields: f.sourceFields,
      confidence: f.confidence,
      mode: "rule-based",
    });
  }

  // 3. Phenotype patterns (only PRESENT ones become bullets — absent ones are noise)
  for (const ph of summary.phenotypeFlags) {
    if (!ph.present) continue;
    items.push({
      rule: { type: "phenotype", key: ph.id, label: ph.label },
      text: `${ph.label}. ${ph.rationale}`,
      patientText: patientPhraseForPhenotype(ph.id),
      sourceFields: ph.sourceFields,
      confidence: ph.confidence,
      mode: "rule-based",
    });
  }

  // 4. Blocked claims (transparency)
  for (const b of summary.unsafeOrUnsupportedClaimsBlocked) {
    items.push({
      rule: { type: "phenotype", key: b.claim, label: b.claim },
      text: `Not evaluated: ${b.claim} — ${b.explanation}`,
      patientText: `One pattern check (${friendlyClaim(b.claim)}) was skipped because the test did not include all the needed readings.`,
      sourceFields: b.missingFields,
      confidence: "Low",
      mode: "blocked",
      missingFields: b.missingFields,
    });
  }

  return items;
}

function patientPhraseForFinding(code: string, severity: string): string {
  if (code.startsWith("ORTHO_SBP_DROP")) {
    return `When you stood up, the top blood-pressure number dropped more than expected (${severity}). This can make people feel light-headed.`;
  }
  if (code.startsWith("ORTHO_DBP_DROP")) {
    return `When you stood up, the bottom blood-pressure number dropped (${severity}). Worth mentioning to your physician.`;
  }
  if (code.includes("EI_RATIO") || code.includes("VALSALVA") || code.includes("30_15")) {
    return `One of the heart-rate response checks was below the typical range (${severity}). This is a measurement, not a diagnosis.`;
  }
  if (code.includes("HR")) {
    return `Your heart-rate response showed a small change worth a clinician's review.`;
  }
  return `A specific reading was outside the typical range (${severity}). Your clinician will know what this means in context.`;
}

function patientPhraseForPhenotype(id: string): string {
  switch (id) {
    case "orthostatic_hypotension":
      return "Your readings match a pattern called orthostatic hypotension — blood pressure drops when standing. Please discuss with your physician.";
    case "pots_like":
      return "Your readings show a heart-rate-on-standing pattern that some clinicians call POTS-like. Your physician can tell you what it means for you.";
    case "cardiovagal_impairment":
      return "Your rest-and-recover signal looks weaker than typical. This pattern is worth discussing with your physician.";
    case "adrenergic_impairment":
      return "Your blood-pressure regulation looks softer than typical when standing.";
    case "parasympathetic_withdrawal":
      return "Your rest-and-recover signal is reduced compared to typical.";
    case "sympathetic_excess":
      return "Your activity-mode signal is running higher than typical.";
    case "possible_can_risk":
      return "Multiple readings combined match a pattern your physician should review carefully.";
    case "insufficient_data":
      return "The test did not include enough data to evaluate every pattern.";
    default:
      return "Your readings match a pattern your physician will review.";
  }
}

function friendlyClaim(claim: string): string {
  return claim
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

// ───────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────

export interface BuildExplanationsOptions {
  /** Override the global toggle (used for previews / tests). */
  evidenceEnabledOverride?: boolean;
  /** Inject a custom evidence resolver (used in tests). */
  evidenceResolver?: (refs: RuleRef[]) => Promise<Map<string, EvidenceLink[]>>;
}

export async function buildExplainedReport(
  summary: DiagnosticSummary,
  options: BuildExplanationsOptions = {}
): Promise<ExplainedReport> {
  const protoItems = extractProtoItems(summary);

  const evidenceEnabled =
    options.evidenceEnabledOverride ?? (await isEvidenceEnabled());

  // Only fetch evidence when toggle is ON. Blocked items never get citations.
  const fetchableRules: RuleRef[] = evidenceEnabled
    ? protoItems.filter((p) => p.mode === "rule-based").map((p) => p.rule)
    : [];

  const evidenceMap = evidenceEnabled
    ? options.evidenceResolver
      ? await options.evidenceResolver(fetchableRules)
      : await getEvidenceForRules(fetchableRules)
    : new Map<string, EvidenceLink[]>();

  const items: ExplanationItem[] = protoItems.map((proto) => {
    if (proto.mode === "blocked") {
      return {
        text: proto.text,
        patientText: proto.patientText,
        rule: proto.rule,
        sourceFields: proto.sourceFields,
        confidence: proto.confidence,
        mode: "blocked",
        evidence: [],
        missingFields: proto.missingFields,
      };
    }

    const cacheKey = `${proto.rule.type}::${proto.rule.key}`;
    const links = evidenceMap.get(cacheKey) ?? [];

    if (links.length === 0) {
      return {
        text: `${proto.text} (${RULE_BASED_LABEL})`,
        patientText: proto.patientText,
        rule: proto.rule,
        sourceFields: proto.sourceFields,
        confidence: proto.confidence,
        mode: "rule-based",
        evidence: [],
      };
    }

    return {
      text: proto.text,
      patientText: proto.patientText,
      rule: proto.rule,
      sourceFields: proto.sourceFields,
      confidence: proto.confidence,
      mode: "evidence-backed",
      evidence: links,
    };
  });

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    scoringVersion: summary.scoringVersion ?? SCORING_VERSION,
    summary,
    evidenceEnabled,
    items,
    disclaimer: DIAGNOSTIC_DISCLAIMER,
    patientDisclaimer: PATIENT_DISCLAIMER,
  };
}

// Re-export utilities for tests
export const _internal = {
  extractProtoItems,
  patientPhraseForFinding,
  patientPhraseForPhenotype,
  domainPatientLabel,
  severityToPatient,
};
