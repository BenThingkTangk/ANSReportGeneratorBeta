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
// Ewing time-domain ratios — ONE-SIDED (greater-than) thresholds.
// ---------------------------------------------------------------------------

export type EwingRatioKey = "eiRatio" | "valsalvaRatio" | "thirtyFifteenRatio";

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
export const EWING_THRESHOLDS: Record<EwingRatioKey, EwingThreshold> = {
  eiRatio: {
    normalAbove: 1.094,
    abnormalBelow: 1.0,
    label: "E/I Ratio",
    citation: "MAIN_PDF Time Domain Ratios: Normal > 1.094",
  },
  valsalvaRatio: {
    normalAbove: 1.2,
    abnormalBelow: 1.1,
    label: "Valsalva Ratio",
    citation: "MAIN_PDF Time Domain Ratios: Normal > 1.200",
  },
  thirtyFifteenRatio: {
    normalAbove: 1.092,
    abnormalBelow: 1.0,
    label: "30:15 Ratio",
    citation: "MAIN_PDF Time Domain Ratios: Normal > 1.092",
  },
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

/** Human-readable "> X" normal-range string for a one-sided Ewing ratio. */
export function ewingNormalRangeLabel(t: EwingThreshold): string {
  return `> ${t.normalAbove.toFixed(3)}`;
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
