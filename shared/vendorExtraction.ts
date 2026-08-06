/**
 * shared/vendorExtraction.ts — the typed shape of a structured vendor-report
 * extraction, shared by the server OCR parser (api/_ans/vendorOcrParse.ts) and
 * the client Vendor-Familiar view (client/src/components/clinician/vendor/*).
 *
 * Every field carries its own OCR/text provenance (page + pixel region +
 * confidence + verbatim source substring) so the UI can show exactly where each
 * vendor number came from, and a null value means the field was NOT read — never
 * a fabricated zero.
 */

export interface VendorFieldProvenance {
  /** 1-based source page. */
  page: number;
  /** Pixel bounding box of the value token in the rasterized page (if known). */
  region?: { x0: number; y0: number; x1: number; y1: number };
  /** 0..1 confidence for THIS field (OCR word confidence, or 1 for text-layer). */
  confidence: number;
  /** Verbatim source substring the value was read from. */
  sourceText: string;
  /** Originating PDF filename (set when multiple vendor documents are merged). */
  sourceFile?: string;
}

export interface VendorField<T> {
  value: T | null;
  unit?: string | null;
  provenance: VendorFieldProvenance | null;
}

/**
 * Normalize a US-style m/d/y date string to canonical `M/D/YYYY`, or null if it
 * doesn't parse. Two-digit years map to 2000–2099. Pure/UI-safe (no Date()).
 */
export function normalizeUsDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})$/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let yr = parseInt(m[3], 10);
  if (m[3].length <= 2) yr = 2000 + yr;
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || yr < 1900 || yr > 2100) return null;
  return `${mo}/${day}/${yr}`;
}

/**
 * Cross-check an OCR-read test date against a trusted date (from the paired .ans
 * demographics / filename). Returns which date to DISPLAY in the patient/clinician
 * header (never a silent overwrite — the raw OCR value is preserved on the field),
 * whether they conflict, and a human note. When the trusted date is present it is
 * preferred for display; the OCR value is always surfaced for audit.
 */
export interface TestDateCrossCheck {
  /** Canonical date to show in the header (trusted if available, else OCR). */
  display: string | null;
  /** Canonical OCR-read date (normalized), preserved for provenance. */
  ocr: string | null;
  /** Canonical trusted date (from .ans / filename), if supplied. */
  trusted: string | null;
  /** True when both are present and disagree. */
  conflict: boolean;
  /** "trusted" | "ocr" | "none" — which source `display` came from. */
  source: "trusted" | "ocr" | "none";
  note: string | null;
}

export function crossCheckTestDate(
  ocrRaw: string | null | undefined,
  trustedRaw: string | null | undefined,
): TestDateCrossCheck {
  const ocr = normalizeUsDate(ocrRaw);
  const trusted = normalizeUsDate(trustedRaw);
  if (trusted && ocr) {
    const conflict = trusted !== ocr;
    return {
      display: trusted,
      ocr,
      trusted,
      conflict,
      source: "trusted",
      note: conflict
        ? `OCR read the test date as ${ocr}, which conflicts with the recording's date ${trusted}. Showing the recording's date; the scanned value is kept for audit.`
        : null,
    };
  }
  if (trusted) return { display: trusted, ocr, trusted, conflict: false, source: "trusted", note: null };
  if (ocr) return { display: ocr, ocr, trusted: null, conflict: false, source: "ocr", note: null };
  return { display: null, ocr: null, trusted: null, conflict: false, source: "none", note: null };
}

export interface VendorIdentity {
  patientName: VendorField<string>;
  testDate: VendorField<string>;
  physician: VendorField<string>;
  dob: VendorField<string>;
  age: VendorField<number>;
  sex: VendorField<string>;
  heightText: VendorField<string>;
  weightText: VendorField<string>;
  bmi: VendorField<number>;
  ectopicBeats: VendorField<number>;
}

export interface VendorBaseline {
  meanHR: VendorField<number>;
  rangeHR: VendorField<number>;
  LFa: VendorField<number>;
  RFa: VendorField<number>;
  SB: VendorField<number>; // LFa/RFa
  FRF: VendorField<number>;
  SBP: VendorField<number>;
  DBP: VendorField<number>;
}

export interface VendorRatios {
  eiRatio: VendorField<number>;
  valsalvaRatio: VendorField<number>;
  thirtyFifteenRatio: VendorField<number>;
}

/**
 * One row of the vendor's page-2 "Numerical Summary" table (A–F phases). Every
 * cell is a VendorField so an unread cell is null (never fabricated) and each
 * carries its own provenance/confidence.
 */
export interface VendorPhaseRow {
  /** Phase letter A–F. */
  key: "A" | "B" | "C" | "D" | "E" | "F";
  /** Vendor event label (e.g. "Baseline", "Deep Breathing", "Valsalva", "Stand"). */
  label: string;
  /** mm:ss as read (string), plus parsed seconds when available. */
  duration: VendorField<string>;
  meanHR: VendorField<number>;
  rangeHR: VendorField<number>;
  FRF: VendorField<number>;
  LFa: VendorField<number>;
  RFa: VendorField<number>;
  SB: VendorField<number>; // LFa/RFa
  SBP: VendorField<number>;
  DBP: VendorField<number>;
  PP: VendorField<number>;
  MAP: VendorField<number>;
}

/** The full A–F phase table (may be empty when no summary table was read). */
export interface VendorPhaseTable {
  rows: VendorPhaseRow[];
  /** Count of individual cells successfully read across all rows. */
  cellCount: number;
}

/**
 * A CATEGORICAL vendor finding lifted verbatim from a narrative report/letter
 * (e.g. "Borderline low parasympathetic modulation (RFa)"). Categorical only —
 * never converted into an invented number. Present on narrative-style vendor
 * PDFs (Diagnostic Implication Summary, Colombo letter) that carry no numeric
 * A–F grid.
 */
export interface VendorNarrativeFinding {
  key: string;
  phase: "deep_breathing_valsalva" | "baseline" | "stand" | "overall";
  label: string;
  classification:
    | "normal" | "borderline-low" | "borderline-high"
    | "low" | "high" | "high-normal" | "abnormal" | "present";
  sourceText: string;
  /** Originating PDF filename (set when multiple vendor documents are merged). */
  sourceFile?: string;
}

/**
 * A conflict detected while merging multiple vendor documents: the same field
 * carried different values across documents. Surfaced to the UI — NEVER silently
 * resolved by overwrite.
 */
export interface VendorMergeConflict {
  field: string;
  values: Array<{ value: string; sourceFile?: string }>;
}

/**
 * Vendor-reported orthostatic (baseline → stand) BP observation, derived ONLY
 * from vendor-printed values (Phase A baseline BP vs Phase F stand BP) when BOTH
 * are present. This is a VENDOR OBSERVATION for clinician context — explicitly
 * NOT a deterministic .ans scoring input. It lets the UI resolve the "missing
 * orthostatic BP data" contradiction honestly: when the paired PDF shows both
 * arms, we can state whether the vendor's numbers show an orthostatic drop, with
 * provenance, while the deterministic .ans adrenergic domain stays "not assessed"
 * (the .ans has no standing BP).
 */
export interface VendorOrthostaticObservation {
  baselineSBP: VendorField<number>;
  baselineDBP: VendorField<number>;
  standSBP: VendorField<number>;
  standDBP: VendorField<number>;
  /** baseline − stand (positive = a drop on standing). */
  sbpDrop: number;
  dbpDrop: number;
  /** True when the vendor's values meet the OH criterion (≥20 SBP or ≥10 DBP). */
  meetsOrthostaticHypotension: boolean;
  /** Human summary with explicit vendor-reported framing. */
  summary: string;
}

export interface VendorReportExtraction {
  /** Whether the pages looked like a genuine P&S / ANS vendor report. */
  looksLikeVendorReport: boolean;
  identity: VendorIdentity;
  baseline: VendorBaseline;
  ratios: VendorRatios;
  /**
   * Per-phase A–F numerical summary (page 2). Present when the summary table was
   * located; rows/cells the scan could not resolve are ABSENT/null, never guessed.
   */
  phases?: VendorPhaseTable;
  /**
   * Vendor-reported baseline→stand BP observation (context only, NOT a
   * deterministic .ans scoring input). Present only when the paired PDF shows
   * both baseline and stand BP.
   */
  orthostatic?: VendorOrthostaticObservation;
  /**
   * Categorical findings from a NARRATIVE vendor document (summary / letter),
   * plus any numbers the vendor printed in prose (e.g. SB = 2.59). Present when
   * the PDF states findings in prose rather than a numeric grid.
   */
  narrative?: {
    findings: VendorNarrativeFinding[];
    printedNumbers: Array<{ key: "SB" | "LFa" | "RFa"; value: number; sourceText: string }>;
  };
  /**
   * Mean confidence (0..1) across the fields actually read. INTERNAL DIAGNOSTIC
   * ONLY — do not render it as the headline for a read failure. "18 fields, 0%
   * mean confidence" reads like a low-quality match; the truth in that case is
   * "0 of 19 structured fields read". Use `fieldCount` / `attemptedFieldCount`.
   */
  meanConfidence: number;
  /** Count of attempted structured scalar fields successfully extracted (READ). */
  fieldCount: number;
  /**
   * Count of fields the extractor ATTEMPTED. `fieldCount` of
   * `attemptedFieldCount` is the plain, honest summary for any UI.
   */
  attemptedFieldCount?: number;
  /** Notes for admin transparency. */
  notes: string[];
  /**
   * Set when this extraction is the MERGE of multiple vendor documents: the
   * source filenames combined, and any field-level conflicts surfaced (never
   * silently overwritten). Absent for a single-document extraction.
   */
  merged?: {
    sourceFiles: string[];
    conflicts: VendorMergeConflict[];
  };
}
