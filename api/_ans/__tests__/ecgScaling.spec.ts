/**
 * Robust ECG centering/scaling tests: a single large outlier must NOT flatten
 * the normal beats (the failure mode of naive min/max normalization).
 */

import { describe, it, expect } from "vitest";
import { computeEcgScale, ecgSampleToY } from "../../../shared/ecgScaling";

describe("computeEcgScale", () => {
  it("centers on the median and is robust to a lone spike", () => {
    // Baseline near 0 with small QRS ~±1, plus one huge ectopic spike at 100.
    const base = Array.from({ length: 500 }, (_, i) => Math.sin(i) * 1);
    const slice = [...base, 100];
    const scale = computeEcgScale(slice);
    expect(Math.abs(scale.center)).toBeLessThan(0.5); // median ~0, not dragged up
    // Robust half-range reflects the normal signal, not the spike.
    expect(scale.robustHalfRange).toBeLessThan(5);
    expect(scale.clampedFraction).toBeGreaterThan(0); // the spike is clamped
    expect(scale.rawMax).toBe(100);
  });

  it("handles a flat signal without dividing by zero", () => {
    const scale = computeEcgScale([2, 2, 2, 2]);
    expect(scale.robustHalfRange).toBeGreaterThan(0);
    expect(Number.isFinite(scale.robustHalfRange)).toBe(true);
  });

  it("returns safe defaults for empty input", () => {
    const scale = computeEcgScale([]);
    expect(scale.robustHalfRange).toBe(1);
  });
});

describe("ecgSampleToY", () => {
  const H = 200;
  it("maps median to vertical center and clamps outliers into the box", () => {
    const scale = computeEcgScale([-1, 0, 1]); // center ~0
    const yMedian = ecgSampleToY(0, scale, H);
    expect(yMedian).toBeGreaterThan(80);
    expect(yMedian).toBeLessThan(120);
    // A huge value is clamped to the top pad, never off-canvas.
    const yHuge = ecgSampleToY(1e6, scale, H, 8);
    expect(yHuge).toBeGreaterThanOrEqual(8);
    expect(yHuge).toBeLessThanOrEqual(H - 8);
    const yTiny = ecgSampleToY(-1e6, scale, H, 8);
    expect(yTiny).toBeLessThanOrEqual(H - 8);
    expect(yTiny).toBeGreaterThanOrEqual(8);
  });
});
