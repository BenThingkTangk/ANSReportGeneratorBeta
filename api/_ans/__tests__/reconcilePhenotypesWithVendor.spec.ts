/**
 * Cross-source phenotype reconciliation regression.
 *
 * COLOMBO-RULE-1.11 ("there is no parasympathetic withdrawal"): a fall in RFa on
 * standing/Valsalva is normal physiology and must never be surfaced as a
 * dysfunction. reconcilePhenotypesWithVendor now neutralizes ANY
 * `parasympathetic_withdrawal` flag arriving present:true — regardless of
 * confidence or whether vendor spectral is present — so the clinician EVIDENCE
 * panel, the patient view, and Ask ATOM can never present it as a dysfunction.
 * When vendor spectral establishes normal RFa + low SB from low LFa, the
 * annotation additionally names the relative parasympathetic dominance physiology.
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
    expect(f.rationale).toMatch(/COLOMBO-RULE-1\.11/);
    expect(f.rationale).toMatch(/relative parasympathetic dominance/i);
  });

  it("invalidates a MEDIUM-confidence withdrawal hypothesis too", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Medium"), NORMAL_RFA_LOW_SB);
    expect(out.phenotypeFlags[0].present).toBe(false);
  });

  it("COLOMBO-RULE-1.11: neutralizes even a HIGH-confidence withdrawal flag (no dysfunction for RFa fall on standing)", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "High"), NORMAL_RFA_LOW_SB);
    expect(out.phenotypeFlags[0].present).toBe(false);
  });

  it("COLOMBO-RULE-1.11: neutralizes the withdrawal flag EVEN WITHOUT vendor spectral (rule is absolute)", () => {
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Low"), undefined);
    expect(out.phenotypeFlags[0].present).toBe(false);
    expect(out.phenotypeFlags[0].rationale).toMatch(/COLOMBO-RULE-1\.11/);
  });

  it("COLOMBO-RULE-1.11: neutralizes regardless of vendor RFa band (still never a dysfunction)", () => {
    // Even when the vendor shows elevated RFa, an RFa FALL on standing is not a
    // dysfunction — the flag must not be present.
    const out = reconcilePhenotypesWithVendor(summaryWithWithdrawal(true, "Low"), { LFa: 2.0, RFa: 15, SB: 0.13 });
    expect(out.phenotypeFlags[0].present).toBe(false);
  });

  it("true no-op when there is no present withdrawal flag to neutralize", () => {
    const s = summaryWithWithdrawal(false, "Low");
    expect(reconcilePhenotypesWithVendor(s, undefined)).toBe(s);
  });
});
