/**
 * Unit coverage for the Ask ATOM evidence gates (FIFTH FINAL-QA).
 * Pure logic — no rendering.
 */
import { describe, it, expect } from "vitest";
import {
  isWellnessAssessable,
  isTherapyGateOpen,
  suggestedPrompts,
} from "../lib/askAtomEvidence";

function baseReport(over: any = {}): any {
  return {
    wellnessScore: 61,
    wellnessTier: "Stressed",
    spectralAvailable: false,
    bpAvailable: false,
    autonomicBalance: { sympathetic: 0, parasympathetic: 0, available: false },
    indications: [],
    therapyRecommendations: [
      { intervention: "Insufficient data for treatment recommendations — clinician review required" },
    ],
    ratios: {
      eiRatio: { value: 1.21, classification: { severity: "Normal" } },
      valsalvaRatio: { value: 1.43, classification: { severity: "Normal" } },
      thirtyFifteenRatio: { value: 1.4, classification: { severity: "Normal" } },
    },
    phaseEvents: [{ LFa: null, RFa: null }],
    ...over,
  };
}

describe("isWellnessAssessable", () => {
  it("is false when spectral unavailable / balance zero", () => {
    expect(isWellnessAssessable(baseReport())).toBe(false);
  });
  it("is true when spectral available and balance non-zero", () => {
    const r = baseReport({
      spectralAvailable: true,
      autonomicBalance: { sympathetic: 40, parasympathetic: 55, available: true },
    });
    expect(isWellnessAssessable(r)).toBe(true);
  });
});

describe("isTherapyGateOpen", () => {
  it("is closed with no indication and placeholder therapy", () => {
    expect(isTherapyGateOpen(baseReport())).toBe(false);
  });
  it("is closed even with an indication if therapy is only a placeholder", () => {
    const r = baseReport({ indications: [{ name: "CAN", code: "CAN" }] });
    expect(isTherapyGateOpen(r)).toBe(false);
  });
  it("is open with a real indication + real therapy", () => {
    const r = baseReport({
      indications: [{ name: "Sympathetic Withdrawal", code: "SW" }],
      therapyRecommendations: [{ intervention: "Midodrine 5mg TID" }],
    });
    expect(isTherapyGateOpen(r)).toBe(true);
  });
});

describe("suggestedPrompts (gate closed)", () => {
  for (const mode of ["patient", "clinician"] as const) {
    it(`[${mode}] offers only safe, evidence-aware prompts`, () => {
      const prompts = suggestedPrompts(baseReport(), mode);
      expect(prompts.length).toBeGreaterThan(0);
      const joined = prompts.join(" | ").toLowerCase();
      expect(joined).not.toContain("differential");
      expect(joined).not.toContain("dosing");
      expect(joined).not.toContain("titrat");
      expect(joined).not.toMatch(/\bpe\b/);
      expect(joined).toContain("what was measured");
    });
  }
  it("uses the 'three normal Ewing ratios' prompt when all three are normal", () => {
    const prompts = suggestedPrompts(baseReport(), "patient");
    expect(prompts.join(" | ")).toContain("Explain the three normal Ewing ratios");
  });
});

describe("suggestedPrompts (gate open)", () => {
  it("clinician may see Colombo interpretation + management prompts", () => {
    const r = baseReport({
      spectralAvailable: true,
      autonomicBalance: { sympathetic: 40, parasympathetic: 55, available: true },
      indications: [{ name: "Sympathetic Withdrawal", code: "SW" }],
      therapyRecommendations: [{ intervention: "Midodrine 5mg TID" }],
    });
    const prompts = suggestedPrompts(r, "clinician");
    expect(prompts.join(" | ")).toMatch(/Colombo interpretation|Management approach/);
  });
});
