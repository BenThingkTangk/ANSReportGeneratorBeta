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

export interface VendorReportExtraction {
  /** Whether the pages looked like a genuine P&S / ANS vendor report. */
  looksLikeVendorReport: boolean;
  identity: VendorIdentity;
  baseline: VendorBaseline;
  ratios: VendorRatios;
  /** Mean confidence (0..1) across the fields actually read. */
  meanConfidence: number;
  /** Count of fields successfully extracted. */
  fieldCount: number;
  /** Notes for admin transparency. */
  notes: string[];
}
