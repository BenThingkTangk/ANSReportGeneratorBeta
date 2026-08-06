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
  ageContinuousNorm,
  ratioBandForAge,
  ratioReferenceLabel,
  classifyRatioForAge,
  AGE_RATIO_REFERENCE,
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

describe("ageContinuousNorm — consolidated wellness curves (was upload.ts norm())", () => {
  it("interpolates linearly between anchor ages", () => {
    // HR: age 30 is halfway between the 20 (60–90) and 40 (58–92) anchors.
    const hr30 = ageContinuousNorm("HR", 30);
    expect(hr30.lo).toBeCloseTo(59, 5);
    expect(hr30.hi).toBeCloseTo(91, 5);
  });

  it("clamps below the youngest / above the oldest anchor", () => {
    expect(ageContinuousNorm("HR", 10)).toEqual({ lo: 60, hi: 90 });
    expect(ageContinuousNorm("HR", 99)).toEqual({ lo: 55, hi: 95 });
  });

  it("returns a safe default for unknown parameters", () => {
    expect(ageContinuousNorm("NOPE", 40)).toEqual({ lo: 0, hi: 1 });
  });

  it("spectral edges agree with COLOMBO_NORMS at the age anchors (no drift)", () => {
    // The age-stable Colombo bands and the age-continuous scoring curves must
    // not contradict each other. SB is age-stable in both; LFa/RFa upper edge
    // is 10 bpm² in both. This guards against the two co-located tables drifting.
    expect(ageContinuousNorm("SB", 20)).toEqual({ lo: COLOMBO_NORMS.SB.lo, hi: COLOMBO_NORMS.SB.hi });
    expect(ageContinuousNorm("LFa", 20).hi).toBeCloseTo(COLOMBO_NORMS.LFa.hi, 5);
    expect(ageContinuousNorm("RFa", 20).hi).toBeCloseTo(COLOMBO_NORMS.RFa.hi, 5);
    // Young resting LFa/RFa lower edge matches the Colombo 0.5 bpm² floor.
    expect(ageContinuousNorm("LFa", 20).lo).toBeCloseTo(COLOMBO_NORMS.LFa.lo, 5);
  });
});

describe("Ewing ratios — one-sided (greater-than) classification (S1-3)", () => {
  // CONTRACT CHANGE (documented, not a weakening): there is now ONE
  // authoritative age-specific ratio reference table (AGE_RATIO_REFERENCE).
  // `EWING_THRESHOLDS` is the age-UNKNOWN fallback derived from that table's
  // widest band, and the vendor's age-independent printed floor is retained as
  // `vendorPublishedFloor` for traceability. Three competing threshold sets can
  // no longer coexist in one report.
  it("age-unknown thresholds derive from the widest band of the authoritative table", () => {
    expect(EWING_THRESHOLDS.eiRatio.normalAbove).toBeCloseTo(
      ratioBandForAge("eiRatio", null).normalAtOrAbove, 5);
    expect(EWING_THRESHOLDS.valsalvaRatio.normalAbove).toBeCloseTo(
      ratioBandForAge("valsalvaRatio", null).normalAtOrAbove, 5);
    expect(EWING_THRESHOLDS.thirtyFifteenRatio.normalAbove).toBeCloseTo(
      ratioBandForAge("thirtyFifteenRatio", null).normalAtOrAbove, 5);
  });

  it("retains the vendor's printed age-independent floors for traceability", () => {
    expect(AGE_RATIO_REFERENCE.eiRatio.vendorPublishedFloor).toBeCloseTo(1.094, 3);
    expect(AGE_RATIO_REFERENCE.valsalvaRatio.vendorPublishedFloor).toBeCloseTo(1.2, 3);
    expect(AGE_RATIO_REFERENCE.thirtyFifteenRatio.vendorPublishedFloor).toBeCloseTo(1.092, 3);
  });

  it("is the ONLY ratio reference source: the scoring curve equals the displayed band", () => {
    for (const age of [25, 35, 45, 48, 55, 70]) {
      expect(ageContinuousNorm("EI", age).lo).toBeCloseTo(
        ratioBandForAge("eiRatio", age).normalAtOrAbove, 5);
      expect(ageContinuousNorm("Valsalva", age).lo).toBeCloseTo(
        ratioBandForAge("valsalvaRatio", age).normalAtOrAbove, 5);
      expect(ageContinuousNorm("ThirtyFifteen", age).lo).toBeCloseTo(
        ratioBandForAge("thirtyFifteenRatio", age).normalAtOrAbove, 5);
    }
  });

  it("age-48 E/I 1.22 and Valsalva 1.49 remain NORMAL under the authoritative table", () => {
    expect(classifyRatioForAge(1.22, "eiRatio", 48)?.severity).toBe("Normal");
    expect(classifyRatioForAge(1.49, "valsalvaRatio", 48)?.severity).toBe("Normal");
    expect(classifyRatioForAge(1.33, "thirtyFifteenRatio", 48)?.severity).toBe("Normal");
  });

  it("returns null (not a fabricated Normal) when the ratio is absent", () => {
    expect(classifyRatioForAge(null, "eiRatio", 48)).toBeNull();
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
    expect(
      classifyEwing(EWING_THRESHOLDS.eiRatio.normalAbove, EWING_THRESHOLDS.eiRatio).label,
    ).toBe("Normal");
  });

  it("never produces a 'Borderline High' or 'High' label for one-sided norms", () => {
    for (const v of [1.5, 2.0, 5.0, 20]) {
      const c = classifyEwing(v, EWING_THRESHOLDS.eiRatio);
      expect(c.label).toBe("Normal");
    }
  });

  it("normal-range label renders as '\u2265 X' from the authoritative table", () => {
    expect(ewingNormalRangeLabel(EWING_THRESHOLDS.eiRatio)).toBe(
      `\u2265 ${ratioBandForAge("eiRatio", null).normalAtOrAbove.toFixed(3)}`,
    );
  });

  it("ratioReferenceLabel is age-specific and states the band it used", () => {
    expect(ratioReferenceLabel("eiRatio", 48)).toBe("normal \u2265 1.12 (age 40\u201349)");
    expect(ratioReferenceLabel("eiRatio", null)).toContain("age unknown");
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
