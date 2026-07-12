/**
 * ecgScaling — robust centering & scaling for ECG rhythm-strip rendering.
 *
 * The naive approach (normalize by raw min/max) is fragile: a single motion
 * spike or ectopic R-peak sets the range and squashes every other beat flat.
 * Instead we center on the MEDIAN and scale by a robust spread (a high
 * percentile of absolute deviation from the median), then CLAMP outliers into
 * the view box. This keeps normal QRS complexes legible while still showing
 * (clamped) ectopic beats. Pure + deterministic so it is unit-testable.
 */

export interface EcgScaleResult {
  /** Median-centered baseline (the raw amplitude mapped to vertical center). */
  center: number;
  /** Robust half-range used for scaling (never 0). */
  robustHalfRange: number;
  /** Fraction of samples that were clamped (outliers beyond the robust range). */
  clampedFraction: number;
  /** Raw min/max (for the readout only). */
  rawMin: number;
  rawMax: number;
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Compute robust scaling parameters for a slice of ECG samples.
 * @param spreadQuantile percentile of |x - median| used as the half-range
 *        (default 0.98 keeps ~2% of extreme samples clamped).
 */
export function computeEcgScale(slice: number[], spreadQuantile = 0.98): EcgScaleResult {
  if (slice.length === 0) {
    return { center: 0, robustHalfRange: 1, clampedFraction: 0, rawMin: 0, rawMax: 0 };
  }
  const sorted = [...slice].sort((a, b) => a - b);
  const median = quantileSorted(sorted, 0.5);
  const absDev = slice.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  let half = quantileSorted(absDev, spreadQuantile);
  if (!Number.isFinite(half) || half <= 0) {
    // Degenerate/flat signal — fall back to raw half-range or 1.
    half = Math.max((sorted[sorted.length - 1] - sorted[0]) / 2, 1);
  }
  const clamped = slice.reduce((n, v) => (Math.abs(v - median) > half ? n + 1 : n), 0);
  return {
    center: median,
    robustHalfRange: half,
    clampedFraction: clamped / slice.length,
    rawMin: sorted[0],
    rawMax: sorted[sorted.length - 1],
  };
}

/**
 * Map a raw sample to a Y pixel using robust scale, clamping to [pad, H-pad].
 * Higher amplitude → smaller Y (SVG origin top-left).
 */
export function ecgSampleToY(
  v: number,
  scale: EcgScaleResult,
  H: number,
  pad = 8,
): number {
  // Normalize to [-1, 1] around the median, clamp, then map to the box.
  let n = (v - scale.center) / scale.robustHalfRange;
  if (n > 1) n = 1;
  if (n < -1) n = -1;
  // n = +1 (peak) → top (small y); n = -1 → bottom.
  const usable = H - 2 * pad;
  return pad + ((1 - n) / 2) * usable;
}
