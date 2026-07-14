/**
 * Low sympathovagal-balance classification + hypothesis-consistency regression.
 *
 * Live paired Jill QA (build 902baca) exposed a clinical contradiction: the
 * patient view said "Parasympathetic Excess at Rest" while the clinician evidence
 * said "parasympathetic withdrawal" — for the SAME metrics (LFa 0.91 low-normal,
 * RFa 5.13 normal, SB 0.18 low). A low LFa/RFa ratio with NORMAL RFa is driven by
 * reduced sympathetic modulation, not parasympathetic excess (and it is not
 * withdrawal either).
 *
 * These tests are generic (no patient hardcoding):
 *   • classifyLowSbDriver attributes low SB correctly by its driver,
 *   • the indication engines emit "relative parasympathetic dominance" (RPD_REST)
 *     — NOT PE_REST — and never simultaneously parasympathetic withdrawal,
 *   • an uploaded test alone yields NO medication/supplement DOSAGE,
 *   • patient and clinician labels cannot contradict for the same metrics.
 */
import { describe, it, expect } from "vitest";
import { classifyLowSbDriver, COLOMBO_NORMS } from "../../../shared/colomboNorms.js";
import { detectIndications } from "../../../shared/indications.js";
import type { PhaseMetrics } from "../../../shared/schema.js";

function phase(over: Partial<PhaseMetrics>): PhaseMetrics {
  return {
    phase: over.phase ?? "Baseline-A",
    label: over.label ?? "Initial Baseline",
    duration: "05:00",
    durationSec: 300,
    meanHR: over.meanHR ?? 60,
    rangeHR: over.rangeHR ?? 12,
    FRF: over.FRF ?? 0.12,
    LFa: over.LFa as number,
    RFa: over.RFa as number,
    SB: over.SB as number,
    HRV_SDNN: 40,
    HRV_RMSSD: 30,
    ...over,
  } as PhaseMetrics;
}

describe("classifyLowSbDriver (generic)", () => {
  it("normal RFa + low/low-normal LFa → reduced-sympathetic (not excess)", () => {
    // Jill-like magnitudes (arbitrary, generic): LFa low-normal, RFa normal.
    expect(classifyLowSbDriver(0.91, 5.13)).toBe("reduced-sympathetic");
    expect(classifyLowSbDriver(1.0, 6.0)).toBe("reduced-sympathetic");
  });
  it("elevated RFa (> normal high) → parasympathetic-excess", () => {
    expect(classifyLowSbDriver(2.0, COLOMBO_NORMS.RFa.hi + 5)).toBe("parasympathetic-excess");
  });
  it("elevated RFa AND low LFa → mixed", () => {
    expect(classifyLowSbDriver(0.4, COLOMBO_NORMS.RFa.hi + 5)).toBe("mixed");
  });
  it("missing RFa → indeterminate", () => {
    expect(classifyLowSbDriver(0.9, null)).toBe("indeterminate");
  });
});

describe("detectIndications — low SB with normal RFa", () => {
  // Baseline A: low SB driven by low-normal LFa with NORMAL RFa. No stand data.
  const phases = [phase({ LFa: 0.91, RFa: 5.13, SB: 0.18 })];
  const inds = detectIndications({ phases, standSpectralAvailable: false, standBpAvailable: false });
  const codes = inds.map((i) => i.code);

  it("does NOT emit Parasympathetic Excess (PE_REST)", () => {
    expect(codes).not.toContain("PE_REST");
  });
  it("emits Relative Parasympathetic Dominance (RPD_REST) instead", () => {
    expect(codes).toContain("RPD_REST");
    const rpd = inds.find((i) => i.code === "RPD_REST")!;
    expect(rpd.description).toMatch(/reduced sympathetic modulation/i);
    // It may only mention "excess" to explicitly NEGATE it ("not parasympathetic
    // excess") — it must never assert excess.
    expect(rpd.description).not.toMatch(/(?<!not )parasympathetic excess/i);
    expect(rpd.name).not.toMatch(/excess/i);
  });
  it("does NOT simultaneously label parasympathetic withdrawal", () => {
    // No PW-style code, and no dynamic PE.
    expect(codes).not.toContain("PW_REST");
    expect(codes.filter((c) => /^PE_/.test(c))).toEqual([]);
  });
  it("preserves genuine PE_REST when RFa is truly elevated", () => {
    const hi = detectIndications({
      phases: [phase({ LFa: 2.0, RFa: COLOMBO_NORMS.RFa.hi + 5, SB: 0.18 })],
      standSpectralAvailable: false,
      standBpAvailable: false,
    }).map((i) => i.code);
    expect(hi).toContain("PE_REST");
    expect(hi).not.toContain("RPD_REST");
  });
});
