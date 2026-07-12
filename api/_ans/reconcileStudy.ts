/**
 * reconcileStudy — single-evaluation-engine reconciliation (audit rec #1).
 *
 * The report has TWO computation paths that historically disagreed:
 *   - Path A: the deterministic scoring engine (api/_ans/scoring/*) reads the
 *     normalized `AnsStudy`.
 *   - Path B: `generateColomboReport()` computes phase spectral metrics (LFa,
 *     RFa, SB per phase) directly from the ECG.
 *
 * When a binary .ans file stores raw beat series rather than clean scalar
 * summary fields, the text-based parser leaves
 * `AnsStudy.sympatheticParasympathetic.*` (and the Ewing ratios) MISSING, so
 * the scoring engine blocks phenotype claims and reports "0 findings" while the
 * ECG-derived report shows the same findings. That is the S2-1 / S2-2 defect.
 *
 * This module backfills MISSING AnsStudy fields from the already-computed report
 * so BOTH engines observe the same numbers. It is generic:
 *   - It never overwrites a value the parser actually extracted (only fills
 *     nulls), so genuine file-extracted values always win.
 *   - Backfilled fields are tagged provenance source "computed" with a reduced
 *     confidence so the Data Quality panel can still show they were derived.
 *   - It works for ANY report/study pair — no patient-specific logic.
 */

import type { AnsStudy } from "../../shared/ansStudy.js";
import type { ProvField } from "../../shared/ansStudy.js";

/** Minimal shape of the phase metrics we read off the computed report. */
interface PhaseLike {
  phase: string;
  // number | null: spectral aggregates are null when not clinically available.
  LFa?: number | null;
  RFa?: number | null;
  SB?: number | null;
}

interface ReportLike {
  phaseEvents?: PhaseLike[];
  ratios?: {
    eiRatio?: { value?: number };
    valsalvaRatio?: { value?: number };
    thirtyFifteenRatio?: { value?: number };
  };
}

function isMissing<T>(f: ProvField<T> | undefined): boolean {
  return !f || f.value == null || f.provenance.source === "missing";
}

/** Build a ProvField for a value derived from the computed report. */
function computedField(value: number, note: string): ProvField<number> {
  return {
    value,
    provenance: {
      source: "computed",
      confidence: 0.6,
      warnings: [note],
    },
  };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Returns a NEW AnsStudy with any missing sympatheticParasympathetic fields and
 * Ewing ratios backfilled from the computed report. The input study is not
 * mutated. Resting = the first Baseline phase (Baseline-A); standing =
 * the Stand phase (Stand-F). If those phases are absent, nothing is backfilled.
 */
export function reconcileStudyWithReport(
  study: AnsStudy,
  report: ReportLike,
): AnsStudy {
  const phases = report.phaseEvents ?? [];
  const resting =
    phases.find(p => p.phase === "Baseline-A") ??
    phases.find(p => p.phase?.startsWith("Baseline")) ??
    phases[0];
  const standing = phases.find(p => p.phase === "Stand-F");

  const sp = study.sympatheticParasympathetic;
  const nextSp = { ...sp };
  const note = "derived from ECG-computed phase metrics (report reconciliation)";

  if (resting) {
    const lfa = num(resting.LFa);
    const rfa = num(resting.RFa);
    const sb = num(resting.SB);
    if (isMissing(sp.restingLfa) && lfa != null) nextSp.restingLfa = computedField(lfa, note);
    if (isMissing(sp.restingRfa) && rfa != null) nextSp.restingRfa = computedField(rfa, note);
    if (isMissing(sp.restingSb) && sb != null) nextSp.restingSb = computedField(sb, note);
  }
  if (standing) {
    const lfa = num(standing.LFa);
    const rfa = num(standing.RFa);
    const sb = num(standing.SB);
    if (isMissing(sp.standingLfa) && lfa != null) nextSp.standingLfa = computedField(lfa, note);
    if (isMissing(sp.standingRfa) && rfa != null) nextSp.standingRfa = computedField(rfa, note);
    if (isMissing(sp.standingSb) && sb != null) nextSp.standingSb = computedField(sb, note);
  }

  const nextRatios = { ...study.ratios };
  const rr = report.ratios;
  if (rr) {
    const ei = num(rr.eiRatio?.value);
    const val = num(rr.valsalvaRatio?.value);
    const tf = num(rr.thirtyFifteenRatio?.value);
    if (isMissing(study.ratios.eiRatio) && ei != null) nextRatios.eiRatio = computedField(ei, note);
    if (isMissing(study.ratios.valsalvaRatio) && val != null) nextRatios.valsalvaRatio = computedField(val, note);
    if (isMissing(study.ratios.thirtyFifteenRatio) && tf != null) nextRatios.thirtyFifteenRatio = computedField(tf, note);
  }

  return {
    ...study,
    sympatheticParasympathetic: nextSp,
    ratios: nextRatios,
  };
}
