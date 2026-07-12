/**
 * Regression + safety tests for the Colombo norm single-source-of-truth and the
 * one-sided Ewing classifier. These lock in the S1-2, S1-3, S3-1 and S2-3 fixes
 * against the Jill Shah oracle values (jill_shah_expected.json).
 */

import { describe, it, expect } from "vitest";
import {
  COLOMBO_NORMS,
  classifySpectral,
  EWING_THRESHOLDS,
  classifyEwing,
  ewingNormalRangeLabel,
  sbZone,
  sbZoneLabel,
  sbIsBalanced,
} from "../../../shared/colomboNorms";

describe("COLOMBO_NORMS — single source of truth", () => {
  it("FRF normal band is 0.09–0.15 Hz (not the fabricated 0.15–0.40)", () => {
    expect(COLOMBO_NORMS.FRF.lo).toBeCloseTo(0.09, 5);
    expect(COLOMBO_NORMS.FRF.hi).toBeCloseTo(0.15, 5);
  });

  it("resting LFa/RFa band is 0.5–10 bpm² (S3-1)", () => {
    expect(COLOMBO_NORMS.LFa.lo).toBeCloseTo(0.5, 5);
    expect(COLOMBO_NORMS.LFa.hi).toBeCloseTo(10, 5);
    expect(COLOMBO_NORMS.RFa.lo).toBeCloseTo(0.5, 5);
    expect(COLOMBO_NORMS.RFa.hi).toBeCloseTo(10, 5);
  });

  it("SB band is 0.4–3.0", () => {
    expect(COLOMBO_NORMS.SB.lo).toBeCloseTo(0.4, 5);
    expect(COLOMBO_NORMS.SB.hi).toBeCloseTo(3.0, 5);
  });

  it("Jill baseline FRF 0.15 classifies as normal (upper edge inclusive)", () => {
    expect(classifySpectral(0.15, COLOMBO_NORMS.FRF)).toBe("normal");
  });

  it("Jill deep-breathing FRF 0.20 classifies as HIGH (S1-2)", () => {
    expect(classifySpectral(0.2, COLOMBO_NORMS.FRF)).toBe("high");
  });

  it("FRF 0.10 is normal (was wrongly 'low' under the 0.15 lower edge)", () => {
    expect(classifySpectral(0.1, COLOMBO_NORMS.FRF)).toBe("normal");
  });
});

describe("Ewing ratios — one-sided (greater-than) classification (S1-3)", () => {
  it("thresholds match the Colombo Time Domain norms", () => {
    expect(EWING_THRESHOLDS.eiRatio.normalAbove).toBeCloseTo(1.094, 3);
    expect(EWING_THRESHOLDS.valsalvaRatio.normalAbove).toBeCloseTo(1.2, 3);
    expect(EWING_THRESHOLDS.thirtyFifteenRatio.normalAbove).toBeCloseTo(1.092, 3);
  });

  it("Jill E/I 1.21 (>1.094) is NORMAL, never Borderline Low", () => {
    const c = classifyEwing(1.21, EWING_THRESHOLDS.eiRatio);
    expect(c.label).toBe("Normal");
    expect(c.severity).toBe("Normal");
  });

  it("Jill Valsalva 1.43 (>1.200) is NORMAL", () => {
    const c = classifyEwing(1.43, EWING_THRESHOLDS.valsalvaRatio);
    expect(c.label).toBe("Normal");
  });

  it("Jill 30:15 1.40 (>1.092) is NORMAL", () => {
    const c = classifyEwing(1.4, EWING_THRESHOLDS.thirtyFifteenRatio);
    expect(c.label).toBe("Normal");
  });

  it("a value just below threshold is Borderline Low, not Normal", () => {
    const c = classifyEwing(1.05, EWING_THRESHOLDS.eiRatio);
    expect(c.label).toBe("Borderline Low");
    expect(c.severity).toBe("Warning");
  });

  it("a frankly low value is Abnormal", () => {
    const c = classifyEwing(0.9, EWING_THRESHOLDS.eiRatio);
    expect(c.label).toBe("Low");
    expect(c.severity).toBe("Abnormal");
  });

  it("a value at exactly the threshold is Normal (inclusive)", () => {
    expect(classifyEwing(1.094, EWING_THRESHOLDS.eiRatio).label).toBe("Normal");
  });

  it("never produces a 'Borderline High' or 'High' label for one-sided norms", () => {
    for (const v of [1.5, 2.0, 5.0, 20]) {
      const c = classifyEwing(v, EWING_THRESHOLDS.eiRatio);
      expect(c.label).toBe("Normal");
    }
  });

  it("normal-range label renders as '> X'", () => {
    expect(ewingNormalRangeLabel(EWING_THRESHOLDS.eiRatio)).toBe("> 1.094");
  });
});

describe("SB zone interpretation — fixed Colombo cutoffs (S2-3)", () => {
  it("Jill baseline SB 0.18 is parasympathetic-dominant, NOT Balanced", () => {
    expect(sbZone(0.18)).toBe("parasympathetic-dominant");
    expect(sbZoneLabel(0.18)).toBe("Parasympathetic dominant");
    expect(sbIsBalanced(0.18)).toBe(false);
  });

  it("SB 0.5 is low-normal (not the truly balanced target band)", () => {
    expect(sbZone(0.5)).toBe("low-normal");
    expect(sbIsBalanced(0.5)).toBe(false);
  });

  it("SB 1.5 is the balanced target band", () => {
    expect(sbZone(1.5)).toBe("target");
    expect(sbZoneLabel(1.5)).toBe("Balanced");
    expect(sbIsBalanced(1.5)).toBe(true);
  });

  it("SB 2.6 is high-normal (sympathetic-leaning)", () => {
    expect(sbZone(2.6)).toBe("high-normal");
    expect(sbIsBalanced(2.6)).toBe(false);
  });

  it("SB 7.2 (Jill Valsalva) is sympathetic-dominant", () => {
    expect(sbZone(7.2)).toBe("sympathetic-dominant");
    expect(sbZoneLabel(7.2)).toBe("Sympathetic dominant");
  });
});
