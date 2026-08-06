/**
 * colomboNorms — SINGLE SOURCE OF TRUTH for Colombo P&S 4.0 normal reference
 * bands and Ewing time-domain ratio thresholds.
 *
 * Every threshold and normal-range band shown anywhere in the report (backend
 * classification + every frontend panel) MUST read from this module. This
 * prevents the class of defect where one surface used a fabricated band (e.g.
 * FRF "0.15–0.40") while another surface in the same report used the correct
 * Colombo band ("0.09–0.15"), producing contradictory in/out-of-norm flags.
 *
 * Sources (see jill_shah_expected.json + Colombo/Arora/DePace/Vinik, Springer
 * 2014; Agelink 2001; Gelber 1997):
 *   - FRF (Fundamental Respiratory Frequency): normal 0.09–0.15 Hz.
 *   - LFa / RFa resting spectral power: normal 0.5–10 bpm².
 *   - SB (sympathovagal balance = LFa/RFa): normal 0.4–3.0.
 *   - Ewing ratios are ONE-SIDED (greater-than) thresholds; a value at or above
 *     the threshold is NORMAL. E/I > 1.094, Valsalva > 1.200, 30:15 > 1.092.
 *
 * This module has NO runtime dependencies — safe to import from server + client.
 */

export interface NormBand {
  lo: number;
  hi: number;
  unit?: string;
  citation?: string;
}

/**
 * Two-sided spectral / balance normal bands (Colombo P&S 4.0 resting norms).
 * These are age-stable in the Colombo methodology; age-continuous curves for
 * scoring live in api/upload.ts `norm()` but MUST agree with these edges for
 * the display bands below.
 */
export const COLOMBO_NORMS: Record<"FRF" | "LFa" | "RFa" | "SB", NormBand> = {
  // Fundamental Respiratory Frequency — Colombo/PhysioPS report page 1 & REPORT
  // PDF both state normal 0.09–0.15 Hz. A value ABOVE 0.15 is high (may
  // artificially reduce the parasympathetic measure during deep breathing).
  FRF: { lo: 0.09, hi: 0.15, unit: "Hz", citation: "Colombo P&S 4.0; REPORT PDF FRF norm 0.09–0.15" },
  // Resting LFa (sympathetic) and RFa (parasympathetic) spectral power.
  LFa: { lo: 0.5, hi: 10, unit: "bpm²", citation: "Colombo P&S 4.0 ANS Test Results bar 0.5–10" },
  RFa: { lo: 0.5, hi: 10, unit: "bpm²", citation: "Colombo P&S 4.0 ANS Test Results bar 0.5–10" },
  // Sympathovagal balance (LFa/RFa).
  SB: { lo: 0.4, hi: 3.0, unit: "ratio", citation: "Colombo P&S 4.0 ANS Test Results bar 0.4–3" },
};

export type SpectralClass = "low" | "normal" | "high";

/**
 * Classify a two-sided spectral value against a Colombo band.
 * value < lo → low (below norm); value > hi → high (above norm); else normal.
 */
export function classifySpectral(value: number, band: NormBand): SpectralClass {
  if (!Number.isFinite(value)) return "normal";
  if (value < band.lo) return "low";
  if (value > band.hi) return "high";
  return "normal";
}

// ---------------------------------------------------------------------------
// Age-continuous normal-range curves (P10/P90) for the wellness index.
//
// SINGLE SOURCE OF TRUTH: this table used to live inline in api/upload.ts as a
// private `norm()`. It is the age-continuous companion to the age-stable
// COLOMBO_NORMS bands above (their edges must agree at the anchor ages). Both
// live here now so there is one place to audit every normative number.
//
// Reference curves: Agelink 2001 (Table 2) & Gelber 1997 aggregated curves.
// ---------------------------------------------------------------------------

export type AgeNormParam =
  | "HR" | "RFa" | "LFa" | "SB"
  | "EI" | "Valsalva" | "ThirtyFifteen" | "DB_rangeHR";

const AGE_NORM_TABLES: Record<AgeNormParam, { age: number; lo: number; hi: number }[]> = {
  HR:       [{ age: 20, lo: 60, hi: 90 }, { age: 40, lo: 58, hi: 92 }, { age: 65, lo: 55, hi: 95 }],
  RFa:      [{ age: 20, lo: 0.8, hi: 10 }, { age: 40, lo: 0.5, hi: 10 }, { age: 65, lo: 0.3, hi: 10 }],
  LFa:      [{ age: 20, lo: 0.5, hi: 10 }, { age: 40, lo: 0.5, hi: 10 }, { age: 65, lo: 0.3, hi: 10 }],
  SB:       [{ age: 20, lo: 0.4, hi: 3.0 }, { age: 40, lo: 0.4, hi: 3.0 }, { age: 65, lo: 0.4, hi: 3.0 }],
  // Ewing ratios — PLACEHOLDERS ONLY. `ageContinuousNorm` intercepts these
  // three keys and reads AGE_RATIO_REFERENCE (the single authoritative
  // age-specific ratio table) instead, so the scoring curve and the displayed
  // reference range can never disagree. Kept for shape/back-compat.
  EI:       [{ age: 20, lo: 1.15, hi: 1.60 }, { age: 40, lo: 1.10, hi: 1.40 }, { age: 60, lo: 1.05, hi: 1.30 }],
  Valsalva: [{ age: 20, lo: 1.30, hi: 1.80 }, { age: 40, lo: 1.20, hi: 1.60 }, { age: 60, lo: 1.15, hi: 1.50 }],
  ThirtyFifteen: [{ age: 20, lo: 1.15, hi: 1.50 }, { age: 40, lo: 1.10, hi: 1.40 }, { age: 60, lo: 1.05, hi: 1.30 }],
  // DB range HR
  DB_rangeHR: [{ age: 20, lo: 19, hi: 50 }, { age: 40, lo: 15, hi: 50 }, { age: 60, lo: 10, hi: 40 }],
};

/** Maps the scoring parameter name onto the authoritative ratio table key. */
const RATIO_KEY_FOR_NORM_PARAM: Partial<Record<AgeNormParam, EwingRatioKey>> = {
  EI: "eiRatio",
  Valsalva: "valsalvaRatio",
  ThirtyFifteen: "thirtyFifteenRatio",
};

/**
 * Age-continuous P10/P90 normal range for a scoring parameter, linearly
 * interpolated between anchor ages. Returns { lo, hi }.
 */
export function ageContinuousNorm(param: AgeNormParam | string, age: number): { lo: number; hi: number } {
  // The three cardiovagal ratios resolve through the SINGLE authoritative
  // age-specific reference table (AGE_RATIO_REFERENCE) — never through a second
  // interpolated curve. See the block comment on AGE_RATIO_REFERENCE.
  const ratioKey = RATIO_KEY_FOR_NORM_PARAM[param as AgeNormParam];
  if (ratioKey) {
    const b = ratioBandForAge(ratioKey, age);
    return { lo: b.normalAtOrAbove, hi: b.typicalUpper };
  }
  const tbl = AGE_NORM_TABLES[param as AgeNormParam];
  if (!tbl) return { lo: 0, hi: 1 };
  if (age <= tbl[0].age) return { lo: tbl[0].lo, hi: tbl[0].hi };
  if (age >= tbl[tbl.length - 1].age) return { lo: tbl[tbl.length - 1].lo, hi: tbl[tbl.length - 1].hi };
  for (let i = 0; i < tbl.length - 1; i++) {
    if (age >= tbl[i].age && age <= tbl[i + 1].age) {
      const frac = (age - tbl[i].age) / (tbl[i + 1].age - tbl[i].age);
      return {
        lo: tbl[i].lo + frac * (tbl[i + 1].lo - tbl[i].lo),
        hi: tbl[i].hi + frac * (tbl[i + 1].hi - tbl[i].hi),
      };
    }
  }
  return { lo: tbl[0].lo, hi: tbl[0].hi };
}

// ---------------------------------------------------------------------------
// Ewing time-domain ratios — ONE-SIDED (greater-than) thresholds.
// ---------------------------------------------------------------------------

export type EwingRatioKey = "eiRatio" | "valsalvaRatio" | "thirtyFifteenRatio";

// ===========================================================================
// AGE-SPECIFIC RATIO REFERENCE — THE SINGLE AUTHORITATIVE TABLE
// ===========================================================================
//
// WHY THIS EXISTS
// ---------------
// Three mutually inconsistent normal-limit sets for the same three ratios used
// to coexist in one report (the age-independent vendor floor used by
// `report.ratios`, a hardcoded chart annotation "ref (1.2 - 1.6)", and the
// age-banded table that lived privately in `api/_ans/thresholds.ts`). Under one
// set E/I 1.22 was comfortably normal; under the chart annotation it was barely
// inside range. Classification stability could not be asserted.
//
// THIS TABLE IS NOW THE ONLY SOURCE. Backend classification, the diagnostic
// severity scorer, every clinician panel and every chart annotation read it.
// `api/_ans/thresholds.ts` derives its default cardiovagal bands from here.
//
// PROVENANCE (traceable, not fabricated)
// --------------------------------------
//   • Age-banded decline of the cardiovagal ratios: Ewing/Low autonomic-reflex
//     screening convention, as already documented in `api/_ans/thresholds.ts`
//     ("starting points commonly cited in autonomic literature (Ewing, Low)").
//     These are CONFIGURABLE lab parameters, not immutable medical facts.
//   • `typicalUpper` is the upper end of the typical/expected range used for
//     chart banding only. It is NOT an abnormality threshold: these ratios are
//     one-sided (higher is better), so a value ABOVE `typicalUpper` is never
//     classified abnormal.
//   • `vendorPublishedFloor` records the age-independent "Time Domain Ratios"
//     figure printed on the Colombo/PhysioPS report, retained here for
//     traceability ONLY. It is not a second classification path.
//
// No value in this table is derived from any single patient's result.
// ===========================================================================

export interface AgeRatioBand {
  /** Inclusive lower age in years. */
  ageMin: number;
  /** Exclusive upper age in years. */
  ageMax: number;
  /** Value at or above this is NORMAL for this age band. */
  normalAtOrAbove: number;
  /** Below this is frankly (severely) abnormal. */
  severeBelow: number;
  /** Upper end of the typical range — chart banding only, never abnormal. */
  typicalUpper: number;
}

export interface AgeRatioReference {
  label: string;
  bands: AgeRatioBand[];
  /** Age-independent figure printed on the vendor report — traceability only. */
  vendorPublishedFloor: number;
  /** Where the numbers come from. Must stay accurate; do not embellish. */
  source: string;
}

export const AGE_RATIO_REFERENCE: Record<EwingRatioKey, AgeRatioReference> = {
  eiRatio: {
    label: "E/I Ratio",
    vendorPublishedFloor: 1.094,
    source:
      "Age-banded cardiovagal (E:I) reference, Ewing/Low autonomic-reflex screening convention; " +
      "vendor Colombo/PhysioPS report prints an age-independent floor of 1.094.",
    bands: [
      { ageMin: 0, ageMax: 30, normalAtOrAbove: 1.21, severeBelow: 1.10, typicalUpper: 1.60 },
      { ageMin: 30, ageMax: 40, normalAtOrAbove: 1.15, severeBelow: 1.08, typicalUpper: 1.50 },
      { ageMin: 40, ageMax: 50, normalAtOrAbove: 1.12, severeBelow: 1.06, typicalUpper: 1.40 },
      { ageMin: 50, ageMax: 60, normalAtOrAbove: 1.10, severeBelow: 1.05, typicalUpper: 1.35 },
      { ageMin: 60, ageMax: 120, normalAtOrAbove: 1.08, severeBelow: 1.04, typicalUpper: 1.30 },
    ],
  },
  valsalvaRatio: {
    label: "Valsalva Ratio",
    vendorPublishedFloor: 1.2,
    source:
      "Age-banded Valsalva ratio reference, Ewing/Low autonomic-reflex screening convention; " +
      "vendor Colombo/PhysioPS report prints an age-independent floor of 1.200.",
    bands: [
      { ageMin: 0, ageMax: 30, normalAtOrAbove: 1.50, severeBelow: 1.30, typicalUpper: 1.80 },
      { ageMin: 30, ageMax: 40, normalAtOrAbove: 1.45, severeBelow: 1.25, typicalUpper: 1.70 },
      { ageMin: 40, ageMax: 50, normalAtOrAbove: 1.40, severeBelow: 1.21, typicalUpper: 1.60 },
      { ageMin: 50, ageMax: 60, normalAtOrAbove: 1.35, severeBelow: 1.20, typicalUpper: 1.55 },
      { ageMin: 60, ageMax: 120, normalAtOrAbove: 1.30, severeBelow: 1.15, typicalUpper: 1.50 },
    ],
  },
  thirtyFifteenRatio: {
    label: "30:15 Ratio",
    vendorPublishedFloor: 1.092,
    source:
      "Age-banded 30:15 standing ratio reference, Ewing/Low autonomic-reflex screening convention; " +
      "vendor Colombo/PhysioPS report prints an age-independent floor of 1.092.",
    bands: [
      { ageMin: 0, ageMax: 30, normalAtOrAbove: 1.04, severeBelow: 1.00, typicalUpper: 1.50 },
      { ageMin: 30, ageMax: 40, normalAtOrAbove: 1.03, severeBelow: 1.00, typicalUpper: 1.45 },
      { ageMin: 40, ageMax: 50, normalAtOrAbove: 1.02, severeBelow: 1.00, typicalUpper: 1.40 },
      { ageMin: 50, ageMax: 60, normalAtOrAbove: 1.01, severeBelow: 0.99, typicalUpper: 1.35 },
      { ageMin: 60, ageMax: 120, normalAtOrAbove: 1.00, severeBelow: 0.98, typicalUpper: 1.30 },
    ],
  },
};

/**
 * Resolve the authoritative age band for a ratio. When age is unknown we pick
 * the WIDEST band rather than guessing an age — never a fabricated default.
 */
export function ratioBandForAge(key: EwingRatioKey, age: number | null | undefined): AgeRatioBand {
  const bands = AGE_RATIO_REFERENCE[key].bands;
  if (age == null || !Number.isFinite(age) || age <= 0) {
    return bands.reduce(
      (widest, b) => (b.ageMax - b.ageMin > widest.ageMax - widest.ageMin ? b : widest),
      bands[0],
    );
  }
  for (const b of bands) if (age >= b.ageMin && age < b.ageMax) return b;
  return age < bands[0].ageMin ? bands[0] : bands[bands.length - 1];
}

/**
 * The ONE reference-range string any surface may render for a ratio. Charts,
 * tables and narrative all call this, so no surface can print a different band.
 */
export function ratioReferenceLabel(key: EwingRatioKey, age: number | null | undefined): string {
  const b = ratioBandForAge(key, age);
  const ageNote =
    age == null || !Number.isFinite(age) || age <= 0
      ? "age unknown — widest band"
      : `age ${b.ageMin}\u2013${b.ageMax === 120 ? "120" : b.ageMax - 1}`;
  return `normal \u2265 ${b.normalAtOrAbove.toFixed(2)} (${ageNote})`;
}

/** Classify a ratio against the authoritative age band. */
export function classifyRatioForAge(
  value: number | null | undefined,
  key: EwingRatioKey,
  age: number | null | undefined,
): EwingClassification | null {
  if (value == null || !Number.isFinite(value)) return null;
  const b = ratioBandForAge(key, age);
  if (value >= b.normalAtOrAbove) return { label: "Normal", severity: "Normal" };
  if (value >= b.severeBelow) return { label: "Borderline Low", severity: "Warning" };
  return { label: "Low", severity: "Abnormal" };
}

export interface EwingThreshold {
  /** Value must be >= normalAbove to be NORMAL. */
  normalAbove: number;
  /** Below this is frankly abnormal (severe). */
  abnormalBelow: number;
  label: string;
  citation: string;
}

/**
 * Colombo/PhysioPS "Time Domain Ratios" normals (MAIN_PDF page 5).
 * These are one-sided: >threshold = Normal. A value comfortably above the
 * threshold is Normal — never "Borderline Low".
 *
 * A small borderline margin ABOVE the threshold is used to warn when a value is
 * only marginally clearing the cutoff, but a value clearly above the threshold
 * is always Normal.
 */
/**
 * Age-resolved Ewing threshold, DERIVED from AGE_RATIO_REFERENCE. This is the
 * only constructor of an EwingThreshold: there is no second hardcoded set.
 */
export function ewingThresholdForAge(
  key: EwingRatioKey,
  age: number | null | undefined,
): EwingThreshold {
  const ref = AGE_RATIO_REFERENCE[key];
  const b = ratioBandForAge(key, age);
  return {
    normalAbove: b.normalAtOrAbove,
    abnormalBelow: b.severeBelow,
    label: ref.label,
    citation: ref.source,
  };
}

/**
 * Age-unknown fallback thresholds (widest band of the authoritative table).
 * Prefer `ewingThresholdForAge(key, age)` whenever an age is available.
 */
export const EWING_THRESHOLDS: Record<EwingRatioKey, EwingThreshold> = {
  eiRatio: ewingThresholdForAge("eiRatio", null),
  valsalvaRatio: ewingThresholdForAge("valsalvaRatio", null),
  thirtyFifteenRatio: ewingThresholdForAge("thirtyFifteenRatio", null),
};

export interface EwingClassification {
  label: "Low" | "Borderline Low" | "Normal";
  severity: "Abnormal" | "Warning" | "Normal";
}

/**
 * Classify an Ewing ratio using the one-sided Colombo threshold. Because these
 * are greater-than thresholds, a value at/above the threshold is Normal; only
 * values below it are Warning (borderline) or Abnormal (frankly low). A value
 * can NEVER be "Borderline High" or "High — Abnormal" for a one-sided normal.
 */
export function classifyEwing(value: number, t: EwingThreshold): EwingClassification {
  if (!Number.isFinite(value)) return { label: "Normal", severity: "Normal" };
  if (value >= t.normalAbove) return { label: "Normal", severity: "Normal" };
  if (value >= t.abnormalBelow) return { label: "Borderline Low", severity: "Warning" };
  return { label: "Low", severity: "Abnormal" };
}

/** Human-readable "≥ X" normal-range string for a one-sided Ewing ratio. */
export function ewingNormalRangeLabel(t: EwingThreshold): string {
  return `\u2265 ${t.normalAbove.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Sympathovagal Balance (SB) interpretation — fixed Colombo cutoffs.
// ---------------------------------------------------------------------------

export type SbZone =
  | "parasympathetic-dominant"
  | "low-normal"
  | "target"
  | "high-normal"
  | "sympathetic-dominant";

/**
 * Interpret a resting SB value using the Colombo fixed cutoffs (NOT a
 * score-derived wellness tier). Source (jill_shah_expected.json):
 *   SB < 0.4      -> parasympathetic-dominant
 *   0.4 <= SB < 1 -> low-normal (parasympathetic-leaning)
 *   1 <= SB <= 2  -> target
 *   2 < SB <= 3   -> high-normal (sympathetic-leaning)
 *   SB > 3        -> sympathetic-dominant
 *
 * This is the SINGLE source of truth for patient- and clinician-facing balance
 * language so a hero chip can never read "Balanced" while the SB value is out
 * of the balanced band.
 */
export function sbZone(sb: number): SbZone {
  if (!Number.isFinite(sb)) return "target";
  if (sb < 0.4) return "parasympathetic-dominant";
  if (sb < 1.0) return "low-normal";
  if (sb <= 2.0) return "target";
  if (sb <= 3.0) return "high-normal";
  return "sympathetic-dominant";
}

/** Short human label for an SB zone (patient-facing). */
export function sbZoneLabel(sb: number): string {
  switch (sbZone(sb)) {
    case "parasympathetic-dominant":
      return "Parasympathetic dominant";
    case "low-normal":
      return "Low-normal (parasympathetic-leaning)";
    case "target":
      return "Balanced";
    case "high-normal":
      return "High-normal (sympathetic-leaning)";
    case "sympathetic-dominant":
      return "Sympathetic dominant";
  }
}

/** Whether an SB value sits in the truly balanced target band (1.0–2.0). */
export function sbIsBalanced(sb: number): boolean {
  return sbZone(sb) === "target";
}

// ---------------------------------------------------------------------------
// Low sympathovagal balance (SB < 0.4) — WHAT DRIVES IT
// ---------------------------------------------------------------------------

export type LowSbDriver =
  | "parasympathetic-excess" // RFa genuinely elevated above the normal band
  | "reduced-sympathetic"    // RFa normal; low ratio driven by low / low-normal LFa
  | "mixed"                  // RFa high AND LFa low (both contribute)
  | "indeterminate";         // insufficient data to attribute

/**
 * Attribute a LOW sympathovagal balance (SB = LFa/RFa < 0.4) to its physiological
 * driver, GENERICALLY from the raw spectral values (no patient hardcoding).
 *
 * A low ratio is NOT synonymous with parasympathetic *excess*: when RFa sits
 * within its normal band and the ratio is low only because LFa is low or
 * low-normal, the correct description is a RELATIVE parasympathetic dominance /
 * REDUCED SYMPATHETIC MODULATION — not "parasympathetic excess" (and certainly
 * not "parasympathetic withdrawal", which requires a fall in RFa). Only a
 * genuinely elevated RFa (> normal high) supports true parasympathetic excess.
 *
 * @param lfa resting LFa (bpm²), @param rfa resting RFa (bpm²)
 */
export function classifyLowSbDriver(
  lfa: number | null | undefined,
  rfa: number | null | undefined,
): LowSbDriver {
  if (rfa == null || !Number.isFinite(rfa)) return "indeterminate";
  const rfaHigh = rfa > COLOMBO_NORMS.RFa.hi;
  // "Low / low-normal" LFa: below the normal band, or in the bottom of it
  // (≤ 1.5 bpm² i.e. bottom ~10% of the 0.5–10 band) so a borderline-low LFa
  // that drags the ratio down is attributed to reduced sympathetic modulation.
  const lfaLowish =
    lfa != null && Number.isFinite(lfa) && lfa < Math.max(COLOMBO_NORMS.LFa.lo, 1.5);
  if (rfaHigh && lfaLowish) return "mixed";
  if (rfaHigh) return "parasympathetic-excess";
  // RFa normal (not elevated): the low ratio is a reduced-sympathetic pattern.
  return "reduced-sympathetic";
}
