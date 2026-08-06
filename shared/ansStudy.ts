/**
 * Canonical normalized .ans study schema.
 *
 * Every uploaded .ans file is parsed into one of these objects. Every
 * extracted scalar carries provenance + confidence so downstream scoring
 * never confuses "missing" with "normal".
 *
 * This module has NO runtime dependencies (pure types + a few small const
 * tables). It is safe to import from both the server (api/) and the client.
 */

// ============================================================================
// Provenance / confidence primitives
// ============================================================================

/** Where a value came from inside the .ans buffer. */
export type ExtractionSource =
  | "binary_lp_string"   // length-prefixed string in the binary header
  | "binary_labview_i64" // LabVIEW int64 seconds-since-1904 timestamp
  | "binary_double"      // raw double-precision number in the binary header
  | "binary_int16"       // signed int16 sample stream (ECG)
  | "ascii_section"      // ASCII text inside a recognized section
  | "ascii_global_regex" // ASCII text found by global regex with weak section
  | "filename"           // fallback parsed from the filename itself
  | "computed"           // derived from other extracted fields (e.g. age from dob+study)
  | "missing";           // value not present in the file

export interface FieldProvenance {
  /** Where the value came from. */
  source: ExtractionSource;
  /** Byte offset in the .ans buffer (when applicable). */
  offset?: number;
  /** Logical section name when source === "ascii_section". */
  sourceSection?: AnsSectionId;
  /** Verbatim substring from the file that produced the value (for audit/debug). */
  sourceText?: string;
  /** Synonym/label that matched (e.g. "DOB" vs "D.O.B." vs "Date of Birth"). */
  matchedLabel?: string;
  /** 0..1 — extractor's self-reported confidence in this value. */
  confidence: number;
  /** Human-readable explanation when confidence < 1. */
  warnings?: string[];
}

/**
 * A typed value with provenance. `value === null` means MISSING — not zero,
 * not "normal", not "unknown". Validators MUST distinguish these.
 */
export interface ProvField<T> {
  value: T | null;
  unit?: string;
  provenance: FieldProvenance;
}

// ============================================================================
// Section taxonomy
// ============================================================================

export type AnsSectionId =
  | "demographics"
  | "study_metadata"
  | "baseline"
  | "deep_breathing"
  | "valsalva"
  | "stand"
  | "tilt"
  | "summary"
  | "medications"
  | "symptoms"
  | "conclusions"
  | "ratios"
  | "events"
  | "physician_notes"
  | "unknown";

/** One contiguous text region of the .ans file labelled by the sectionizer. */
export interface AnsRawSection {
  id: AnsSectionId;
  /** Matched header text (e.g. "Baseline / Resting"). */
  headerText?: string;
  /** Byte offset where the section begins. */
  startOffset: number;
  /** Byte offset where the section ends (exclusive). */
  endOffset: number;
  /** Cleaned ASCII text of the section. */
  text: string;
}

// ============================================================================
// Demographics
// ============================================================================

export type Sex = "Male" | "Female" | "Other" | "Unknown";

export interface AnsDemographics {
  /** Family name. */
  lastName: ProvField<string>;
  /** Given name. */
  firstName: ProvField<string>;
  /** ISO YYYY-MM-DD. */
  dob: ProvField<string>;
  /** Years at time of study, computed from dob + studyDate when possible. */
  ageAtStudy: ProvField<number>;
  sex: ProvField<Sex>;
  /** Cleaned physician name (no "Dr." / "Doctor" prefix). */
  physician: ProvField<string>;
  /** Free-form patient ID if present in the file. */
  mrn: ProvField<string>;
}

// ============================================================================
// File / study metadata
// ============================================================================

export interface AnsFileMetadata {
  /** Original filename (e.g. "Francey-Shannon-Fri-Oct-24-2025.ans"). */
  fileName: ProvField<string>;
  fileSizeBytes: number;
  /** SHA-256 of the file bytes (hex). */
  fileSha256?: string;
  /** ISO YYYY-MM-DD of the study itself. */
  studyDate: ProvField<string>;
  /** Local 12-hour clock time with seconds (hh:mm:ss AM/PM), when available. */
  studyStartTime: ProvField<string>;
  procedureType: ProvField<string>;
  samplingRateHz: ProvField<number>;
  samplingInterval: ProvField<number>;
  dataPointCount: ProvField<number>;
  /** True when the buffer was shorter than dataPointCount * 2 + dataStart. */
  ecgTruncated: boolean;
  /** Detected device / firmware string if present in the binary header. */
  device: ProvField<string>;
}

// ============================================================================
// Anthropometrics + ECG signal
// ============================================================================

export interface AnsAnthropometrics {
  heightInches: ProvField<number>;
  weightLbs: ProvField<number>;
  bmi: ProvField<number>;
}

export interface AnsEcgQuality {
  /**
   * Crude signal-to-noise estimate (dB). NOTE: a HIGH value here does not imply
   * a usable recording — large sentinel/saturation spikes inflate the sample
   * standard deviation and therefore this figure. Read `unusableReasons`.
   */
  snrDb: number | null;
  /** Fraction of samples that are saturated/flatlined. 0..1. */
  motionFraction: number | null;
  /**
   * Fraction of preview samples at or beyond the int16 sentinel/rail magnitude
   * (|v| >= 30000). These are acquisition artifacts, not physiology, and must
   * never feed a heart-rate-variability metric.
   */
  sentinelFraction: number | null;
  /** True when the recording appears unusable for ANS analysis. */
  leadOff: boolean;
  /** Overall gate — false means downstream metrics must be flagged. */
  usable: boolean;
  /**
   * The SPECIFIC reasons `usable` is false, in stable machine-readable form.
   * Previously a single generic "signal-to-noise too low" string was emitted
   * even when SNR was 46 dB and the real problem was motion/saturation — a
   * self-contradictory record that made the gate impossible to act on.
   */
  unusableReasons: Array<
    | "no_ecg_block"
    | "lead_off_or_flatline"
    | "excess_motion_or_saturation"
    | "low_snr"
  >;
  /**
   * Non-blocking acquisition artifacts. These require disclosure and
   * downstream exclusion but do not, alone, make the study unusable.
   */
  artifactFlags: Array<"sentinel_spikes">;
  warnings: string[];
}

export interface AnsEcgSignal {
  /** Subset of the raw ECG for visualization (first N samples). */
  preview: number[];
  durationSec: number | null;
  quality: AnsEcgQuality;
}

// ============================================================================
// Vital signs / per-phase blocks
// ============================================================================

export interface BloodPressure {
  sbp: ProvField<number>;
  dbp: ProvField<number>;
  /** Mean arterial pressure when stated; otherwise computed. */
  map: ProvField<number>;
}

/** A clinical phase block (baseline, deepBreathing, valsalva, stand, tilt). */
export interface PhaseBlock {
  /** Did the file actually contain this phase? */
  present: boolean;
  /** Phase start/end seconds within the recording, when known. */
  startSec: ProvField<number>;
  endSec: ProvField<number>;
  heartRate: ProvField<number>;
  bp: BloodPressure;
  /** Sympathetic (low-frequency area). */
  lfa: ProvField<number>;
  /** Parasympathetic (respiratory-frequency area). */
  rfa: ProvField<number>;
  /** Sympathovagal balance = LFa / RFa, when extractable directly. */
  sb: ProvField<number>;
  /** Phase-specific notes lifted verbatim from the .ans file. */
  notes: string[];
}

// ============================================================================
// Standard ANS ratios + autonomic summary
// ============================================================================

export interface AnsRatios {
  /** Expiratory:Inspiratory ratio (deep breathing). */
  eiRatio: ProvField<number>;
  valsalvaRatio: ProvField<number>;
  /** 30:15 standing ratio. */
  thirtyFifteenRatio: ProvField<number>;
}

export interface AnsSympatheticParasympathetic {
  /** Resting/baseline sympathetic (LFa) and parasympathetic (RFa). */
  restingLfa: ProvField<number>;
  restingRfa: ProvField<number>;
  restingSb: ProvField<number>;
  /** Standing values (orthostatic challenge). */
  standingLfa: ProvField<number>;
  standingRfa: ProvField<number>;
  standingSb: ProvField<number>;
  /** Free-form clinical impression text lifted from the file. */
  impressionText: ProvField<string>;
}

// ============================================================================
// Medications, symptoms, conclusions
// ============================================================================

export interface MedicationEntry {
  raw: string;
  /** Best-effort split — null when not parseable. */
  name: string | null;
  dose: string | null;
  unit: string | null;
  frequency: string | null;
}

export interface SymptomEntry {
  raw: string;
  /** Normalized snake_case key when recognized (e.g. "dizziness", "syncope"). */
  key: string | null;
}

export interface AnsConclusion {
  raw: string;
  /** Recognized pattern label (PE, PW, SE, SW, AAD, CAN, POTS, etc.) if present. */
  pattern?: string;
}

// ============================================================================
// Validation envelope
// ============================================================================

export type WarningSeverity = "info" | "warn" | "error";

export interface ExtractionWarning {
  code: string;            // stable code, e.g. "DOB_IMPOSSIBLE"
  message: string;         // human-readable
  severity: WarningSeverity;
  field?: string;          // dotted path, e.g. "patient.dob"
  sectionId?: AnsSectionId;
}

export interface ParserConfidence {
  /** 0..1 overall confidence in the parse. */
  overall: number;
  /** Number of fields that came back null/missing. */
  missingCount: number;
  /** Number of fields whose own confidence was < 0.5. */
  lowConfidenceCount: number;
  /** Section ids that were detected vs. expected. */
  sectionsDetected: AnsSectionId[];
  sectionsMissing: AnsSectionId[];
  /** Hash of the deterministic parser version that produced this study. */
  parserVersion: string;
}

// ============================================================================
// Top-level AnsStudy
// ============================================================================

/**
 * Canonical normalized .ans study. All AI / scoring / report-rendering layers
 * MUST consume this shape — never the raw binary or ad-hoc strings.
 */
export interface AnsStudy {
  schemaVersion: "1.0";
  /** ISO timestamp when this study object was produced. */
  parsedAt: string;

  patient: AnsDemographics;
  fileMetadata: AnsFileMetadata;
  anthropometrics: AnsAnthropometrics;
  /**
   * Ectopic count from the .ans annotation. PhysioPS omits the annotation for
   * zero, represented as a provenance-bearing computed value only when the ECG
   * record is present and complete.
   */
  ectopicBeats: ProvField<number>;
  ecg: AnsEcgSignal;

  baseline: PhaseBlock;
  deepBreathing: PhaseBlock;
  valsalva: PhaseBlock;
  standOrTilt: PhaseBlock;

  ratios: AnsRatios;
  sympatheticParasympathetic: AnsSympatheticParasympathetic;

  medications: ProvField<MedicationEntry[]>;
  symptoms: ProvField<SymptomEntry[]>;
  conclusions: ProvField<AnsConclusion[]>;

  /** All recognized text sections, in file order. */
  rawSections: AnsRawSection[];
  /** Raw ASCII view (truncated to 16 KB) preserved for debugging. */
  rawAsciiHead: string;

  extractionWarnings: ExtractionWarning[];
  parserConfidence: ParserConfidence;
}

// ============================================================================
// Helpers — construction sugar so call-sites stay readable
// ============================================================================

/** Build a "missing" field of the right shape. */
export function missingField<T>(reason = "not present in file"): ProvField<T> {
  return {
    value: null,
    provenance: {
      source: "missing",
      confidence: 0,
      warnings: [reason],
    },
  };
}

/** Build a field with full provenance. */
export function provField<T>(
  value: T,
  source: ExtractionSource,
  opts: Partial<Omit<FieldProvenance, "source">> & { unit?: string } = {},
): ProvField<T> {
  const { unit, ...prov } = opts;
  return {
    value,
    unit,
    provenance: {
      source,
      confidence: 1,
      ...prov,
    },
  };
}

/** Constant — bumped whenever the parser changes deterministically. */
export const PARSER_VERSION = "ans-parser/1.1.0";
