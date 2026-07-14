/**
 * Cross-source phenotype reconciliation regression.
 *
 * Live QA (build 5570860): the clinician EVIDENCE panel still showed "Pattern
 * consistent with parasympathetic withdrawal" (withdrawal=true) while the patient
 * finding was Relative Parasympathetic Dominance — a contradiction for the same
 * metrics (normal RFa, low SB from low LFa). The deterministic withdrawal
 * hypothesis is estimate-based; when the paired vendor report establishes normal
 * RFa + low SB driven by low LFa, that hypothesis must be invalidated.
 */
import { describe, it, expect } from "vitest";
import { reconcilePhenotypesWithVendor } from "../reconcilePhenotypesWithVendor.js";
import type { DiagnosticSummary, PhenotypeFlag, Confidence } from "../../../shared/diagnosticSummary.js";

function summaryWithWithdrawal(present: boolean, confidence: Confidence): DiagnosticSummary {
  const flag: PhenotypeFlag = {
    id: "parasympathetic_withdrawal",
    label: "Pattern consistent with parasympathetic withdrawal",
    present,
    criteria: [{ description: "Standing RFa decreased ≥ 20% from resting", met: present }],
    rationale: "Standing RFa fell 25% from resting (estimated).",
    sourceFields: ["sympatheticParasympathetic.restingRfa", "sympatheticParasympathetic.standingRfa"],
    confidence,
  };
  return { phenotypeFlags: [flag] } as unknown as DiagnosticSummary;
}

// Jill-like generic vendor spectral: normal RFa, low SB driven by low LFa.
const NORMAL_RFA_LOW_SB = { LFa: 0.91, RFa: 5.13, SB: 0.18 };

describe("reconcilePhenotypesWithVendor", () => {
  it("invalidates a LOW-confidence withdrawal hypothesis when vendor shows normal RFa + low SB from low LFa", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Low"), NORMAL_RFA_LOW_SB);
    const f = out.phenotypeFlags.find((p) => p.id === "parasympathetic_withdrawal")!;
    expect(f.present).toBe(false);
    expect(f.criteria.every((c) => !c.met)).toBe(true);
    expect(f.rationale).toMatch(/invalidated by the paired vendor report/i);
    expect(f.rationale).toMatch(/relative parasympathetic dominance/i);
  });

  it("invalidates a MEDIUM-confidence withdrawal hypothesis too", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Medium"), NORMAL_RFA_LOW_SB);
    expect(out.phenotypeFlags[0].present).toBe(false);
  });

  it("does NOT override a HIGH-confidence (genuinely measured) withdrawal finding", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "High"), NORMAL_RFA_LOW_SB);
    expect(out.phenotypeFlags[0].present).toBe(true);
  });

  it("does NOT invalidate when the vendor shows GENUINE parasympathetic excess (RFa elevated)", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Low"), { LFa: 2.0, RFa: 15, SB: 0.13 });
    expect(out.phenotypeFlags[0].present).toBe(true);
  });

  it("no-op when vendor spectral is absent", () => {
    const s = summaryWithWithdrawal(true, "Low");
    expect(reconcilePhenotypesWithVendor(s, undefined)).toBe(s);
  });

  it("no-op when RFa is not within the normal band (cannot establish the pattern)", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Low"), { LFa: 0.2, RFa: 0.05, SB: 4 });
    expect(out.phenotypeFlags[0].present).toBe(true);
  });
});
