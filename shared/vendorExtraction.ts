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
  /** Mean confidence (0..1) across the fields actually read. */
  meanConfidence: number;
  /** Count of fields successfully extracted. */
  fieldCount: number;
  /** Notes for admin transparency. */
  notes: string[];
}
