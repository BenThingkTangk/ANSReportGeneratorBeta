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

import {
  ratioBandForAge,
  type EwingRatioKey,
} from "../../shared/colomboNorms.js";

export interface BandedThreshold {
  /** Inclusive lower age in years. */
  ageMin: number;
  /** Exclusive upper age in years. */
  ageMax: number;
  /** Threshold below which the value is considered abnormal. */
  abnormalBelow: number;
  /** Threshold below which the value is considered SEVERELY abnormal. */
  severeBelow: number;
  /** True for the age-unavailable vendor-floor fallback row. */
  ageUnknownFallback?: boolean;
  /**
   * PhysioPS page 5 reports these ratios as a binary Normal/Low result.
   * Custom threshold sets may omit this to retain mild/severe subdivision.
   */
  binaryLow?: boolean;
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
/**
 * Cardiovagal ratio bands are DERIVED from the single authoritative
 * age-specific reference table (`shared/colomboNorms.ts AGE_RATIO_REFERENCE`).
 * They are no longer duplicated here: a second copy of these numbers is exactly
 * how three mutually inconsistent normal-limit sets ended up in one report.
 */
function bandsFrom(key: EwingRatioKey): BandedThreshold[] {
  const fallback = ratioBandForAge(key, null);
  const ageBands = Array.from({ length: 120 }, (_, index) => {
    const age = index + 1;
    const band = ratioBandForAge(key, age);
    return {
      ageMin: age,
      ageMax: age + 1,
      abnormalBelow: band.normalAtOrAbove,
      // PhysioPS page 5 supplies only a Normal/Low boundary. Do not invent a
      // second "severe" cutoff from the paired verification corpus.
      severeBelow: Number.NEGATIVE_INFINITY,
      binaryLow: true,
    } satisfies BandedThreshold;
  });
  return [
    {
      ageMin: 0,
      ageMax: 0,
      abnormalBelow: fallback.normalAtOrAbove,
      severeBelow: Number.NEGATIVE_INFINITY,
      ageUnknownFallback: true,
      binaryLow: true,
    },
    ...ageBands,
  ];
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  cardiovagal: {
    eiRatio: bandsFrom("eiRatio"),
    valsalvaRatio: bandsFrom("valsalvaRatio"),
    thirtyFifteenRatio: bandsFrom("thirtyFifteenRatio"),
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
    const explicitFallback = bands.find((b) => b.ageUnknownFallback);
    if (explicitFallback) return explicitFallback;
    // Backward-compatible behavior for custom threshold sets.
    return bands.reduce((widest, b) =>
      (b.ageMax - b.ageMin) > (widest.ageMax - widest.ageMin) ? b : widest,
    bands[0]);
  }
  const ageBands = bands.filter((b) => !b.ageUnknownFallback);
  for (const b of ageBands) {
    if (age >= b.ageMin && age < b.ageMax) return b;
  }
  // Out of range — clamp to the closest band.
  return age < ageBands[0].ageMin ? ageBands[0] : ageBands[ageBands.length - 1];
}
