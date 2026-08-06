/**
 * REGRESSION: "RMSSD > SDNN is physiologically impossible" was WRONG.
 *
 * The removed gate rejected any phase whose beat-to-beat variability exceeded
 * its overall variability. For a stationary series
 *
 *     RMSSD/SDNN = sqrt(2 * (1 - r1))
 *
 * so the ratio exceeds 1 for every series with lag-1 autocorrelation r1 < 0.5 —
 * ordinary in respiratory-dominant rhythms, paced deep breathing, young or
 * athletic subjects, and short detrended segments. The mathematical ceiling is 2.
 *
 * This spec pins:
 *   1. a clean synthetic series with ratio > 1 (r1 < 0.5) stays RELIABLE;
 *   2. the identity RMSSD/SDNN = sqrt(2(1-r1)) is reproduced by the reported
 *      metrics, so the implied lag-1 autocorrelation is a real measurement;
 *   3. real signal defects — non-physiologic intervals, ectopy above the
 *      conventional 5 % limit, clipped fiducial samples, near-ceiling
 *      alternation — DO reject;
 *   4. no rejection reason ever claims the ratio itself is impossible.
 */
import { describe, it, expect } from "vitest";
import {
  assessRrQuality,
  highRatioIsPhysiologic,
  MAX_ECTOPIC_FRACTION,
  MIN_INTERVALS_FOR_VARIABILITY,
  NEAR_LIMIT_RATIO,
} from "../signalQuality.js";

/** Deterministic pseudo-random source so these tests never flake. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Respiratory-dominant series: a fast sinusoid (≈0.25 Hz breathing) on a steady
 * mean. Successive differences are large relative to the spread about the mean,
 * so r1 < 0.5 and RMSSD > SDNN — legitimate physiology, not an artifact.
 */
function respiratoryDominantSeries(n = 240, meanRr = 900, amp = 40): number[] {
  const r = rng(7);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // 4 beats per breath (≈0.25 Hz at 60 bpm) → lag-1 autocorrelation ≈ 0, so
    // RMSSD/SDNN ≈ sqrt(2) ≈ 1.41: comfortably above 1 and far from the ceiling.
    out.push(meanRr + amp * Math.sin((2 * Math.PI * i) / 4) + (r() - 0.5) * 4);
  }
  return out;
}

function steadySeries(n = 240, meanRr = 900, jitter = 6): number[] {
  const r = rng(11);
  return Array.from({ length: n }, (_, i) => meanRr + Math.sin(i / 30) * 25 + (r() - 0.5) * jitter);
}

describe("signal quality — RMSSD > SDNN is allowed", () => {
  it("keeps a clean respiratory-dominant series reliable even at ratio > 1", () => {
    const rr = respiratoryDominantSeries();
    const q = assessRrQuality(rr);
    expect(q.metrics.rmssdSdnnRatio).not.toBeNull();
    expect(q.metrics.rmssdSdnnRatio!).toBeGreaterThan(1);
    expect(q.metrics.rmssdSdnnRatio!).toBeCloseTo(Math.SQRT2, 1);
    expect(q.metrics.lag1Autocorr!).toBeLessThan(0.5);
    expect(q.metrics.ectopicFraction).toBeLessThanOrEqual(MAX_ECTOPIC_FRACTION);
    expect(q.reliable).toBe(true);
    expect(q.reasons).toEqual([]);
    expect(highRatioIsPhysiologic(q.metrics)).toBe(true);
  });

  it("reproduces RMSSD/SDNN = sqrt(2(1 - r1)) from the reported metrics", () => {
    for (const rr of [respiratoryDominantSeries(), steadySeries()]) {
      const { metrics } = assessRrQuality(rr);
      const ratio = metrics.rmssdSdnnRatio!;
      const r1 = metrics.lag1Autocorr!;
      expect(ratio).toBeCloseTo(Math.sqrt(2 * (1 - r1)), 2);
      // Ratio must stay inside the mathematical range for a real series.
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(2.05);
    }
  });

  it("never rejects on the ratio alone and never calls it impossible", () => {
    const results = [respiratoryDominantSeries(), steadySeries(), respiratoryDominantSeries(120, 700, 60), Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 620 : 1180))]
      .map((rr) => assessRrQuality(rr));
    for (const q of results) {
      for (const reason of q.reasons) {
        expect(reason).not.toMatch(/impossible/i);
        expect(reason).not.toMatch(/RMSSD\s*>\s*SDNN/i);
        expect(reason).not.toMatch(/exceeds (overall|SDNN)/i);
      }
    }
  });
});

describe("signal quality — real defects still reject", () => {
  it("rejects non-physiologic intervals", () => {
    const rr = steadySeries();
    // 5 % of intervals impossible for consecutive sinus beats.
    for (let i = 0; i < 12; i++) rr[i * 20] = 120;
    const q = assessRrQuality(rr);
    expect(q.reliable).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/physiologic range/i);
    expect(q.metrics.nonPhysiologicFraction).toBeGreaterThan(0.02);
  });

  it("rejects ectopy above the conventional 5 % time-domain limit", () => {
    const rr = steadySeries();
    // Compensatory pause pattern: short beat followed by a long one.
    for (let i = 0; i < 20; i++) {
      const k = 5 + i * 11;
      rr[k] = rr[k] * 0.55;
      rr[k + 1] = rr[k + 1] * 1.45;
    }
    const q = assessRrQuality(rr);
    expect(q.metrics.ectopicFraction).toBeGreaterThan(MAX_ECTOPIC_FRACTION);
    expect(q.reliable).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/local median/i);
  });

  it("accepts ectopy below the limit", () => {
    const rr = steadySeries();
    rr[40] = rr[40] * 0.55;
    rr[41] = rr[41] * 1.45;
    const q = assessRrQuality(rr);
    expect(q.metrics.ectopicFraction).toBeLessThanOrEqual(MAX_ECTOPIC_FRACTION);
    expect(q.reliable).toBe(true);
  });

  it("rejects clipped fiducial samples and artifact-spanning intervals", () => {
    const rr = steadySeries();
    const q = assessRrQuality(rr, {
      clippedFiducialBeats: 9,
      artifactSpanningIntervals: 4,
      detectedBeats: rr.length + 9,
    });
    expect(q.reliable).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/saturated recorder samples/i);
    expect(q.metrics.clippedFiducialFraction).toBeGreaterThan(0.01);
  });

  it("rejects near-ceiling alternation with measured evidence, not an impossibility claim", () => {
    // Alternating missed/extra beats: ratio pushed toward the bound of 2 with a
    // high alternation rate and large swings.
    const rr = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 620 : 1180));
    const q = assessRrQuality(rr);
    expect(q.metrics.rmssdSdnnRatio!).toBeGreaterThan(NEAR_LIMIT_RATIO);
    expect(q.metrics.alternationFraction).toBeGreaterThan(0.5);
    expect(q.reliable).toBe(false);
    const joined = q.reasons.join(" ");
    expect(joined).not.toMatch(/impossible/i);
    // The reason must cite the measured alternation evidence.
    expect(joined).toMatch(/alternat/i);
  });

  it("reports too-few-intervals rather than a fabricated ratio", () => {
    const q = assessRrQuality([900, 910, 890]);
    expect(q.metrics.intervals).toBeLessThan(MIN_INTERVALS_FOR_VARIABILITY);
    expect(q.metrics.rmssdSdnnRatio).toBeNull();
    expect(q.reliable).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/at least/i);
  });

  it("is generic: identical series give identical verdicts regardless of context labels", () => {
    const rr = respiratoryDominantSeries();
    const a = assessRrQuality(rr);
    const b = assessRrQuality([...rr]);
    expect(b).toEqual(a);
  });
});
