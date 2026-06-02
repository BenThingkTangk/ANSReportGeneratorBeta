/**
 * ============================================================================
 *  CONFIGURABLE CLINICAL THRESHOLDS — NOT IMMUTABLE MEDICAL FACTS.
 * ============================================================================
 *
 * These tables are used by the deterministic ANS scoring layer to bucket
 * extracted values into normal / mild / moderate / severe categories. They
 * MUST be treated as adjustable parameters, NOT as medical truth:
 *
 *   • Adjust per clinical protocol, lab calibration, and population.
 *   • Age- and sex-adjusted thresholds are starting points commonly cited in
 *     autonomic literature (Ewing, Low, etc.) but every lab should validate
 *     against its own reference cohort.
 *   • The current .ans file format does not carry sudomotor data — sudomotor
 *     thresholds are stubbed so a future QSART-capable input can plug in.
 *
 * Override by passing a Thresholds object into the scoring entry point.
 * ============================================================================
 */

export interface BandedThreshold {
  /** Inclusive lower age in years. */
  ageMin: number;
  /** Exclusive upper age in years. */
  ageMax: number;
  /** Threshold below which the value is considered abnormal. */
  abnormalBelow: number;
  /** Threshold below which the value is considered SEVERELY abnormal. */
  severeBelow: number;
}

export interface CardiovagalThresholds {
  /** Expiratory:Inspiratory ratio thresholds (deep breathing). */
  eiRatio: BandedThreshold[];
  /** Valsalva ratio thresholds. */
  valsalvaRatio: BandedThreshold[];
  /** 30:15 standing ratio thresholds. */
  thirtyFifteenRatio: BandedThreshold[];
}

export interface AdrenergicThresholds {
  /** Orthostatic SBP drop (baseline → stand). Positive = drop in mmHg. */
  sbpDropMild: number;
  sbpDropModerate: number;
  sbpDropSevere: number;
  /** Orthostatic DBP drop in mmHg. */
  dbpDropMild: number;
  dbpDropModerate: number;
  /** POTS-like HR increase (baseline → stand) in bpm. */
  potsHrIncrease: number;
}

export interface SudomotorThresholds {
  /** Placeholder — current .ans format carries no sudomotor data. */
  enabled: boolean;
}

export interface EcgQualityThresholds {
  /** SNR (dB) below which we downgrade confidence. */
  minSnrDb: number;
  /** Motion fraction (0..1) above which we downgrade confidence. */
  maxMotionFraction: number;
}

export interface Thresholds {
  cardiovagal: CardiovagalThresholds;
  adrenergic: AdrenergicThresholds;
  sudomotor: SudomotorThresholds;
  ecgQuality: EcgQualityThresholds;
}

/**
 * Default thresholds. Starting values pulled from commonly cited references
 * (Ewing et al.; Low et al.). Adjust as needed for your clinical population.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  cardiovagal: {
    // E:I ratio — declines with age.
    eiRatio: [
      { ageMin: 0,  ageMax: 30, abnormalBelow: 1.21, severeBelow: 1.10 },
      { ageMin: 30, ageMax: 40, abnormalBelow: 1.15, severeBelow: 1.08 },
      { ageMin: 40, ageMax: 50, abnormalBelow: 1.12, severeBelow: 1.06 },
      { ageMin: 50, ageMax: 60, abnormalBelow: 1.10, severeBelow: 1.05 },
      { ageMin: 60, ageMax: 120, abnormalBelow: 1.08, severeBelow: 1.04 },
    ],
    // Valsalva ratio — declines with age.
    valsalvaRatio: [
      { ageMin: 0,  ageMax: 30, abnormalBelow: 1.50, severeBelow: 1.30 },
      { ageMin: 30, ageMax: 40, abnormalBelow: 1.45, severeBelow: 1.25 },
      { ageMin: 40, ageMax: 50, abnormalBelow: 1.40, severeBelow: 1.21 },
      { ageMin: 50, ageMax: 60, abnormalBelow: 1.35, severeBelow: 1.20 },
      { ageMin: 60, ageMax: 120, abnormalBelow: 1.30, severeBelow: 1.15 },
    ],
    // 30:15 ratio — declines with age.
    thirtyFifteenRatio: [
      { ageMin: 0,  ageMax: 30, abnormalBelow: 1.04, severeBelow: 1.00 },
      { ageMin: 30, ageMax: 40, abnormalBelow: 1.03, severeBelow: 1.00 },
      { ageMin: 40, ageMax: 50, abnormalBelow: 1.02, severeBelow: 1.00 },
      { ageMin: 50, ageMax: 60, abnormalBelow: 1.01, severeBelow: 0.99 },
      { ageMin: 60, ageMax: 120, abnormalBelow: 1.00, severeBelow: 0.98 },
    ],
  },
  adrenergic: {
    // Orthostatic SBP drop thresholds (mmHg, baseline → stand).
    // Consensus criterion for orthostatic hypotension: ≥20/10.
    sbpDropMild: 10,
    sbpDropModerate: 20,
    sbpDropSevere: 30,
    dbpDropMild: 5,
    dbpDropModerate: 10,
    // POTS criterion: sustained HR increase ≥30 bpm on standing.
    potsHrIncrease: 30,
  },
  sudomotor: {
    enabled: false,
  },
  ecgQuality: {
    minSnrDb: 10,
    maxMotionFraction: 0.20,
  },
};

/**
 * Resolve the threshold band that applies to a given age. Falls back to the
 * widest band when age is missing.
 */
export function bandForAge(
  bands: BandedThreshold[],
  age: number | null,
): BandedThreshold {
  if (age == null || !isFinite(age)) {
    // Pick the broadest band (largest age window) as a safe fallback.
    return bands.reduce((widest, b) =>
      (b.ageMax - b.ageMin) > (widest.ageMax - widest.ageMin) ? b : widest,
    bands[0]);
  }
  for (const b of bands) {
    if (age >= b.ageMin && age < b.ageMax) return b;
  }
  // Out of range — clamp to the closest band.
  return age < bands[0].ageMin ? bands[0] : bands[bands.length - 1];
}
