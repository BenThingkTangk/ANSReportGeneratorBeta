/**
 * api/_ans/reconcilePhenotypesWithVendor.ts
 *
 * Cross-source reconciliation of the deterministic .ans phenotype hypotheses with
 * the paired VENDOR-reported baseline spectral values, so the clinician EVIDENCE
 * panel and the patient view cannot contradict for the same metrics.
 *
 * THE PROBLEM (live QA): the deterministic engine derives the
 * `parasympathetic_withdrawal` hypothesis from the .ans's ESTIMATED resting→standing
 * RFa. When a signed vendor report establishes a NORMAL baseline RFa with a LOW
 * sympathovagal balance driven by LOW / low-normal LFa, that estimate-based
 * "withdrawal" hypothesis is incompatible with the vendor source of truth (which
 * shows a *relative parasympathetic dominance* / reduced sympathetic modulation,
 * not a fall in parasympathetic activity). The patient finding correctly reads
 * "Relative Parasympathetic Dominance" while the clinician evidence still read
 * "parasympathetic withdrawal" — a contradiction.
 *
 * THE FIX (generic, no patient hardcoding): when vendor metrics establish
 * normal-RFa + low-SB-from-low-LFa, INVALIDATE the low/medium-confidence
 * deterministic withdrawal hypothesis (present → false) and annotate WHY, citing
 * the vendor source. Provenance separation is preserved: we do not silently
 * rewrite deterministic numbers — we mark the hypothesis not-supported by the
 * higher-authority paired source and record that in its rationale/criteria.
 *
 * A HIGH-confidence deterministic withdrawal finding (genuinely measured, not an
 * estimate) is left untouched — we only override estimate-driven low/medium
 * hypotheses that the vendor source directly contradicts.
 */
import { COLOMBO_NORMS, classifyLowSbDriver } from "../../shared/colomboNorms.js";
import type { DiagnosticSummary, PhenotypeFlag } from "../../shared/diagnosticSummary.js";

export interface VendorBaselineSpectral {
  LFa?: number;
  RFa?: number;
  SB?: number;
}

/**
 * Reconcile a diagnostic summary's phenotype flags against vendor baseline
 * spectral values. Returns a NEW summary (inputs untouched) with the
 * parasympathetic-withdrawal hypothesis invalidated when the vendor source shows
 * normal RFa + a low SB driven by low/low-normal LFa. No-op when vendor spectral
 * is absent, when RFa is not normal, or when the driver is genuine excess/mixed.
 */
export function reconcilePhenotypesWithVendor(
  summary: DiagnosticSummary,
  vendor: VendorBaselineSpectral | undefined,
): DiagnosticSummary {
  if (!vendor) return summary;
  const lfa = typeof vendor.LFa === "number" ? vendor.LFa : null;
  const rfa = typeof vendor.RFa === "number" ? vendor.RFa : null;
  const sb =
    typeof vendor.SB === "number"
      ? vendor.SB
      : lfa != null && rfa != null && rfa !== 0
        ? lfa / rfa
        : null;
  if (rfa == null || sb == null) return summary;

  // Only act when the vendor establishes: RFa within normal band, SB low, and the
  // low ratio is driven by reduced sympathetic modulation (not genuine PE).
  const rfaNormal = rfa >= COLOMBO_NORMS.RFa.lo && rfa <= COLOMBO_NORMS.RFa.hi;
  const sbLow = sb < COLOMBO_NORMS.SB.lo;
  const driver = classifyLowSbDriver(lfa, rfa);
  const shouldInvalidateWithdrawal =
    rfaNormal && sbLow && driver === "reduced-sympathetic";
  if (!shouldInvalidateWithdrawal) return summary;

  let changed = false;
  const flags: PhenotypeFlag[] = summary.phenotypeFlags.map((f) => {
    if (f.id !== "parasympathetic_withdrawal" || !f.present) return f;
    // Never override a HIGH-confidence (genuinely measured) withdrawal finding.
    if (f.confidence === "High") return f;
    changed = true;
    const note =
      `Invalidated by the paired vendor report: baseline RFa ${rfa.toFixed(2)} bpm² is within ` +
      `normal limits (${COLOMBO_NORMS.RFa.lo}–${COLOMBO_NORMS.RFa.hi}) and the low sympathovagal ` +
      `balance (SB ${sb.toFixed(2)}) is driven by low/low-normal LFa` +
      (lfa != null ? ` (${lfa.toFixed(2)} bpm²)` : "") +
      `. This is a relative parasympathetic dominance (reduced sympathetic modulation), ` +
      `not a fall in parasympathetic activity — so the estimate-based withdrawal hypothesis is not supported.`;
    return {
      ...f,
      present: false,
      criteria: f.criteria.map((c) => ({ ...c, met: false })),
      rationale: `${f.rationale} — ${note}`,
    };
  });

  if (!changed) return summary;
  return { ...summary, phenotypeFlags: flags };
}
