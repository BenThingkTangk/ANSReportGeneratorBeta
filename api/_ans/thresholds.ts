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
  AGE_RATIO_REFERENCE,
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
  return AGE_RATIO_REFERENCE[key].bands.map((b) => ({
    ageMin: b.ageMin,
    ageMax: b.ageMax,
    abnormalBelow: b.normalAtOrAbove,
    severeBelow: b.severeBelow,
  }));
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
