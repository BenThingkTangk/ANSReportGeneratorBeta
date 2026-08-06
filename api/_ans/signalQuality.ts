/**
 * R-R signal-quality assessment for time-domain variability.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The previous gate rejected a phase whenever beat-to-beat variability (RMSSD)
 * exceeded overall variability (SDNN), on the stated ground that this is "not
 * physiologically possible". That assertion is WRONG and has been removed.
 *
 * For a stationary R-R series the two indices are related through the lag-1
 * autocorrelation r1:
 *
 *     RMSSD^2 = 2 * SDNN^2 * (1 - r1)          =>   RMSSD/SDNN = sqrt(2*(1-r1))
 *
 * so RMSSD > SDNN holds for ANY series with r1 < 0.5, which is extremely
 * common: respiratory-dominant (high-frequency) rhythms, young or athletic
 * subjects, paced deep breathing, and short segments where the slow trend has
 * been removed all sit well below r1 = 0.5. The ratio is mathematically bounded
 * by 2 (attained only at r1 = -1, i.e. perfect beat-to-beat alternation), so
 * the only value that is genuinely out of range is a ratio ABOVE ~2 — and even
 * that only because of the finite-sample difference between the SDNN and RMSSD
 * denominators.
 *
 * Rejecting r1 < 0.5 threw away legitimate physiology and mislabelled it as an
 * artifact. This module replaces that heuristic with checks that actually
 * measure signal quality:
 *
 *   1. NON-PHYSIOLOGIC INTERVALS — intervals outside 240-3000 ms cannot be
 *      consecutive sinus beats at any human heart rate.
 *   2. ECTOPIC / MIS-DETECTED BEATS — an interval that deviates by more than
 *      20 % from the local median of its neighbours is the standard marker for
 *      a missed beat, an extra (double-counted) beat, or an ectopic beat.
 *   3. CLIPPED FIDUCIAL POINTS — a detected peak sitting on a saturated
 *      (sentinel/rail) sample has no trustworthy timing, so intervals built
 *      from it are not measurements.
 *   4. NEAR-LIMIT ALTERNATION — a ratio near the mathematical maximum of 2
 *      combined with a high sign-alternation rate and large swings is the
 *      signature of alternating missed/extra beats, NOT of a physiologic rhythm.
 *      Reported as a quality finding with its measured evidence, never as
 *      "impossible".
 *   5. TOO FEW INTERVALS — variability indices are not estimable.
 *
 * All thresholds are generic literature-style limits applied identically to
 * every recording. Nothing here reads a patient name, filename, demographic,
 * vendor value or fixture fingerprint.
 */

/** Physiologic bounds for a consecutive-sinus-beat interval (250 bpm - 20 bpm). */
export const MIN_PHYSIOLOGIC_RR_MS = 240;
export const MAX_PHYSIOLOGIC_RR_MS = 3000;

/** Deviation from the local median above which an interval is called ectopic/mis-detected. */
export const ECTOPIC_DEVIATION_FRACTION = 0.2;

/** Window (in intervals) used for the local median comparison. */
export const ECTOPIC_WINDOW = 5;

/**
 * Fraction of ectopic/mis-detected intervals a phase may carry and still be
 * reported. 5 % is the conventional exclusion limit for time-domain HRV: above
 * it the successive-difference statistics are dominated by detection errors
 * rather than by sinus rhythm. Applied identically to every recording.
 */
export const MAX_ECTOPIC_FRACTION = 0.05;

/** Any non-physiologic interval fraction above this invalidates the phase. */
export const MAX_NONPHYSIOLOGIC_FRACTION = 0.02;

/** Fraction of clipped (rail/sentinel) fiducial points a phase may carry. */
export const MAX_CLIPPED_FIDUCIAL_FRACTION = 0.01;

/**
 * RMSSD/SDNN is bounded by 2. Above this we are within a few percent of the
 * bound, which requires near-perfect alternation — investigated together with
 * the measured alternation rate and swing size before it invalidates anything.
 */
export const NEAR_LIMIT_RATIO = 1.9;

/** Minimum intervals for SDNN/RMSSD to be estimable at all. */
export const MIN_INTERVALS_FOR_VARIABILITY = 4;

export interface RrQualityMetrics {
  intervals: number;
  meanRrMs: number | null;
  sdnnMs: number | null;
  rmssdMs: number | null;
  /**
   * RMSSD / SDNN. Values above 1 are ordinary (they mean lag-1 autocorrelation
   * below 0.5) and are NOT an error condition. The mathematical ceiling is 2.
   */
  rmssdSdnnRatio: number | null;
  /** Lag-1 autocorrelation implied by the ratio: r1 = 1 - ratio^2 / 2. */
  lag1Autocorr: number | null;
  /** Fraction of intervals >20% from their local median (ectopy / mis-detection). */
  ectopicFraction: number;
  /** Fraction of intervals outside 240-3000 ms. */
  nonPhysiologicFraction: number;
  /** Fraction of successive-difference sign changes with a >20% swing. */
  alternationFraction: number;
  /** Fraction of detected beats whose fiducial sample was clipped at the rail. */
  clippedFiducialFraction: number;
}

export interface RrQualityAssessment {
  reliable: boolean;
  reasons: string[];
  metrics: RrQualityMetrics;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Assess whether a phase's R-R series supports published variability numbers.
 *
 * @param rrIntervalsMs consecutive R-R intervals, in milliseconds
 * @param context beat-level artifact counts from the detector
 */
export function assessRrQuality(
  rrIntervalsMs: number[],
  context: {
    /** Detected peaks rejected because the fiducial sample was clipped at the rail. */
    clippedFiducialBeats?: number;
    /** Intervals discarded because they spanned a clipped/sentinel sample. */
    artifactSpanningIntervals?: number;
    /** Total peaks the detector proposed before artifact rejection. */
    detectedBeats?: number;
  } = {},
): RrQualityAssessment {
  const clipped = context.clippedFiducialBeats ?? 0;
  const spanning = context.artifactSpanningIntervals ?? 0;
  const detected = context.detectedBeats ?? rrIntervalsMs.length + clipped;
  const clippedFiducialFraction = detected > 0 ? clipped / detected : 0;

  const finite = rrIntervalsMs.filter((rr) => Number.isFinite(rr));
  const n = finite.length;

  const emptyMetrics: RrQualityMetrics = {
    intervals: n,
    meanRrMs: null,
    sdnnMs: null,
    rmssdMs: null,
    rmssdSdnnRatio: null,
    lag1Autocorr: null,
    ectopicFraction: 0,
    nonPhysiologicFraction: 0,
    alternationFraction: 0,
    clippedFiducialFraction,
  };

  if (n < MIN_INTERVALS_FOR_VARIABILITY) {
    return {
      reliable: false,
      reasons: [
        `Only ${n} usable R-R interval(s) in this phase; overall and beat-to-beat ` +
          `variability need at least ${MIN_INTERVALS_FOR_VARIABILITY}.`,
      ],
      metrics: emptyMetrics,
    };
  }

  const meanRr = finite.reduce((a, b) => a + b, 0) / n;
  const sdnn = Math.sqrt(finite.reduce((s, rr) => s + (rr - meanRr) ** 2, 0) / (n - 1));
  let ssd = 0;
  for (let i = 1; i < n; i++) ssd += (finite[i] - finite[i - 1]) ** 2;
  const rmssd = Math.sqrt(ssd / (n - 1));
  const ratio = sdnn > 0 ? rmssd / sdnn : null;
  const lag1 = ratio != null ? 1 - (ratio * ratio) / 2 : null;

  // --- 1. non-physiologic intervals ----------------------------------------
  const nonPhysiologic = finite.filter(
    (rr) => rr < MIN_PHYSIOLOGIC_RR_MS || rr > MAX_PHYSIOLOGIC_RR_MS,
  ).length;
  const nonPhysiologicFraction = nonPhysiologic / n;

  // --- 2. ectopic / mis-detected intervals ---------------------------------
  let ectopic = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - Math.floor(ECTOPIC_WINDOW / 2));
    const hi = Math.min(n, lo + ECTOPIC_WINDOW);
    const neighbours = finite.slice(lo, hi).filter((_, j) => lo + j !== i);
    if (neighbours.length === 0) continue;
    const m = median(neighbours);
    if (m > 0 && Math.abs(finite[i] - m) / m > ECTOPIC_DEVIATION_FRACTION) ectopic++;
  }
  const ectopicFraction = ectopic / n;

  // --- 3. alternation rate (evidence for the near-limit check) -------------
  let alternating = 0;
  let pairs = 0;
  for (let i = 2; i < n; i++) {
    const d1 = finite[i - 1] - finite[i - 2];
    const d2 = finite[i] - finite[i - 1];
    pairs++;
    const swing = Math.min(Math.abs(d1), Math.abs(d2)) / meanRr;
    if (d1 * d2 < 0 && swing > ECTOPIC_DEVIATION_FRACTION) alternating++;
  }
  const alternationFraction = pairs > 0 ? alternating / pairs : 0;

  const metrics: RrQualityMetrics = {
    intervals: n,
    meanRrMs: Math.round(meanRr * 10) / 10,
    sdnnMs: Math.round(sdnn * 10) / 10,
    rmssdMs: Math.round(rmssd * 10) / 10,
    rmssdSdnnRatio: ratio != null ? Math.round(ratio * 1000) / 1000 : null,
    lag1Autocorr: lag1 != null ? Math.round(lag1 * 1000) / 1000 : null,
    ectopicFraction: Math.round(ectopicFraction * 1000) / 1000,
    nonPhysiologicFraction: Math.round(nonPhysiologicFraction * 1000) / 1000,
    alternationFraction: Math.round(alternationFraction * 1000) / 1000,
    clippedFiducialFraction: Math.round(clippedFiducialFraction * 1000) / 1000,
  };

  const reasons: string[] = [];

  if (nonPhysiologicFraction > MAX_NONPHYSIOLOGIC_FRACTION) {
    reasons.push(
      `${(nonPhysiologicFraction * 100).toFixed(1)}% of beat intervals fall outside the ` +
        `physiologic range ${MIN_PHYSIOLOGIC_RR_MS}-${MAX_PHYSIOLOGIC_RR_MS} ms, so they are ` +
        "not consecutive sinus beats.",
    );
  }

  if (ectopicFraction > MAX_ECTOPIC_FRACTION) {
    reasons.push(
      `${(ectopicFraction * 100).toFixed(1)}% of beat intervals deviate more than ` +
        `${ECTOPIC_DEVIATION_FRACTION * 100}% from their local median, indicating ectopic or ` +
        "mis-detected beats above the tolerated limit for time-domain variability.",
    );
  }

  if (clippedFiducialFraction > MAX_CLIPPED_FIDUCIAL_FRACTION || spanning > 0) {
    reasons.push(
      `${clipped} detected beat(s) (${(clippedFiducialFraction * 100).toFixed(1)}% of ` +
        `${detected}) sat on saturated recorder samples and ${spanning} interval(s) spanned ` +
        "one, so their beat timing is not a measurement.",
    );
  }

  if (
    ratio != null &&
    ratio > NEAR_LIMIT_RATIO &&
    alternationFraction > 0.5
  ) {
    reasons.push(
      `Beat-to-beat variability is ${(ratio).toFixed(2)}x overall variability — within a few ` +
        "percent of the mathematical maximum of 2 — and " +
        `${(alternationFraction * 100).toFixed(0)}% of successive interval changes alternate in ` +
        "sign with a large swing. That combination is the signature of alternating missed/extra " +
        "beat detections rather than a physiologic rhythm.",
    );
  }

  return { reliable: reasons.length === 0, reasons, metrics };
}

/**
 * Explanatory note attached to a phase whose ratio exceeds 1 without any
 * quality problem — the case the removed gate used to reject.
 */
export function highRatioIsPhysiologic(metrics: RrQualityMetrics): boolean {
  return (
    metrics.rmssdSdnnRatio != null &&
    metrics.rmssdSdnnRatio > 1 &&
    metrics.rmssdSdnnRatio <= NEAR_LIMIT_RATIO
  );
}
