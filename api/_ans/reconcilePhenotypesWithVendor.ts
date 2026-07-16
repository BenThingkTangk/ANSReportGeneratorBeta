/**
 * api/_ans/reconcilePhenotypesWithVendor.ts
 *
 * Cross-source reconciliation of the deterministic .ans phenotype hypotheses with
 * the paired VENDOR-reported baseline spectral values, so the clinician EVIDENCE
 * panel and the patient view cannot contradict for the same metrics.
 *
 * COLOMBO-RULE-1.11 ("there is no parasympathetic withdrawal"): a fall in RFa on
 * standing/Valsalva is always normal physiology and must never be surfaced as a
 * dysfunction. The primary scoring detector (detectParasympatheticWithdrawal) now
 * enforces this and never emits `present:true`. This reconciliation step is a
 * defense-in-depth backstop: whatever the source, any `parasympathetic_withdrawal`
 * flag that arrives here `present:true` is neutralized (present → false) and
 * annotated with the rule, so the clinician EVIDENCE panel, the patient view, and
 * Ask ATOM can never present it as a dysfunction.
 *
 * When paired vendor metrics are available and establish normal-RFa + low-SB from
 * low/low-normal LFa, the annotation additionally names the *relative
 * parasympathetic dominance* physiology so the clinician sees the correct read.
 * Provenance separation is preserved: deterministic numbers are never rewritten —
 * only the pattern's present/criteria/rationale are corrected.
 */
import { COLOMBO_NORMS, classifyLowSbDriver } from "../../shared/colomboNorms.js";
import type { DiagnosticSummary, PhenotypeFlag } from "../../shared/diagnosticSummary.js";

export interface VendorBaselineSpectral {
  LFa?: number;
  RFa?: number;
  SB?: number;
}

/**
 * Reconcile a diagnostic summary's phenotype flags. Returns a NEW summary
 * (inputs untouched). Per COLOMBO-RULE-1.11 any `parasympathetic_withdrawal`
 * flag arriving `present:true` is neutralized (present → false) regardless of
 * confidence or source — an RFa fall on standing is normal physiology, never a
 * dysfunction. When paired vendor metrics establish normal RFa + low SB from
 * low/low-normal LFa, the annotation additionally names the relative
 * parasympathetic dominance physiology.
 */
export function reconcilePhenotypesWithVendor(
  summary: DiagnosticSummary,
  vendor: VendorBaselineSpectral | undefined,
): DiagnosticSummary {
  const lfa = vendor && typeof vendor.LFa === "number" ? vendor.LFa : null;
  const rfa = vendor && typeof vendor.RFa === "number" ? vendor.RFa : null;
  const sb =
    vendor && typeof vendor.SB === "number"
      ? vendor.SB
      : lfa != null && rfa != null && rfa !== 0
        ? lfa / rfa
        : null;

  // Optional richer annotation when the vendor pair establishes relative
  // parasympathetic dominance (normal RFa + low SB driven by low/low-normal LFa).
  const vendorShowsDominance =
    rfa != null &&
    sb != null &&
    rfa >= COLOMBO_NORMS.RFa.lo &&
    rfa <= COLOMBO_NORMS.RFa.hi &&
    sb < COLOMBO_NORMS.SB.lo &&
    classifyLowSbDriver(lfa, rfa) === "reduced-sympathetic";

  let changed = false;
  const flags: PhenotypeFlag[] = summary.phenotypeFlags.map((f) => {
    if (f.id !== "parasympathetic_withdrawal" || !f.present) return f;
    changed = true;
    // COLOMBO-RULE-1.11: never present an RFa fall on standing as a dysfunction.
    const base =
      `Per COLOMBO-RULE-1.11, a fall in parasympathetic (RFa) activity on standing/Valsalva ` +
      `is normal physiology and is never reported as "parasympathetic withdrawal" or a dysfunction.`;
    const dominanceNote = vendorShowsDominance
      ? ` The paired vendor report shows baseline RFa ${rfa!.toFixed(2)} bpm² within normal limits ` +
        `(${COLOMBO_NORMS.RFa.lo}–${COLOMBO_NORMS.RFa.hi}) and a low sympathovagal balance (SB ${sb!.toFixed(2)}) ` +
        `driven by low/low-normal LFa` +
        (lfa != null ? ` (${lfa.toFixed(2)} bpm²)` : "") +
        ` — a relative parasympathetic dominance (reduced sympathetic modulation), not a fall in parasympathetic activity.`
      : "";
    return {
      ...f,
      present: false,
      label: "Parasympathetic response on standing (expected physiology)",
      criteria: f.criteria.map((c) => ({ ...c, met: false })),
      rationale: `${f.rationale} — ${base}${dominanceNote}`,
    };
  });

  if (!changed) return summary;
  return { ...summary, phenotypeFlags: flags };
}
