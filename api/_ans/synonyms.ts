/**
 * Synonym tables for ASCII section extraction.
 *
 * --- HOW TO ADD A NEW SYNONYM ---
 * 1. Find the canonical key below (e.g. `FIELD_SYNONYMS.HEART_RATE`).
 * 2. Add the new label to the `labels` array — order matters: list the most
 *    specific phrases first ("Mean Arterial Pressure" before "MAP" so the
 *    longer phrase wins the scan).
 * 3. If you're adding a brand-new field, add the canonical key + a default
 *    extraction regex in `FIELD_SYNONYMS`. Then wire it up in
 *    `api/_ans/parseStudy.ts` (look for the matching extractField() call).
 * 4. If you're adding a brand-new section, add the heading patterns to
 *    `SECTION_HEADINGS` keyed by `AnsSectionId`. The sectionizer scans for
 *    the first match in file order.
 * 5. Run `npm run test:ans` — the unit tests will tell you immediately if
 *    your new synonym shadows an existing one.
 *
 * Rules:
 * - All labels are matched case-insensitively.
 * - All labels are matched anchored on a word boundary on either side so
 *   "HR" doesn't accidentally match inside "HRV".
 * - Never put a label inside FIELD_SYNONYMS that's also a section heading.
 */

import type { AnsSectionId } from "../../shared/ansStudy.js";

// ---------------------------------------------------------------------------
// Section headings -> AnsSectionId
// ---------------------------------------------------------------------------
//
// Each AnsSectionId maps to a list of header patterns we'll accept. The
// sectionizer walks the cleaned ASCII view and splits on the first occurrence
// of any of these phrases.
//
export const SECTION_HEADINGS: Record<AnsSectionId, RegExp[]> = {
  demographics: [
    /\bDemographics?\b/i,
    /\bPatient\s+Information\b/i,
    /\bPatient\s+Data\b/i,
  ],
  study_metadata: [
    /\bStudy\s+(?:Information|Metadata|Details)\b/i,
    /\bTest\s+Information\b/i,
    /\bExam\s+(?:Date|Information)\b/i,
  ],
  baseline: [
    /\bBaseline\b/i,
    /\bResting\b/i,
    /\bSupine\b/i,
    /\bInitial\s+Baseline\b/i,
    /\bPre[\-\s]?Test\b/i,
  ],
  deep_breathing: [
    // Negative lookahead for "Ratio" so the E/I ratio prose line
    // ("E/I Ratio = 1.21") is never mistaken for a phase heading.
    /\bDeep\s+Breathing\b(?!\s+Ratio)/i,
    /\bDB\s+Phase\b/i,
    /\bParasympathetic\s+Challenge\b/i,
    /\bE[:\/]I\s+Test\b/i,
  ],
  valsalva: [
    // Negative lookahead for "Ratio": the Ewing summary line
    // "Valsalva Ratio = 1.43" is prose, NOT a Valsalva phase table.
    /\bValsalva(?:\s+Maneuver)?\b(?!\s+Ratio)/i,
    /\bForced\s+Expiratory\s+Strain\b/i,
  ],
  stand: [
    /\bStand(?:ing)?\b(?!\s+Ratio)/i,
    /\bOrthostatic\b/i,
    /\bPostural\s+Challenge\b/i,
  ],
  tilt: [
    /\bTilt(?:\s+Table)?\b/i,
    /\bHead[\-\s]?Up\s+Tilt\b/i,
    /\bHUT\b/i,
    /\bTilt[\-\s]?Up\b/i,
    /\bUpright\s+Tilt\b/i,
    /\b(?:V|P)RT\b/i,
    /\bVertical\s+Recovery\s+Test\b/i,
  ],
  summary: [
    /\bSummary\b/i,
    /\bOverall\s+Impression\b/i,
    /\bClinical\s+Impression\b/i,
  ],
  medications: [
    /\bMedications?\b/i,
    /\bCurrent\s+Meds?\b/i,
    /\bRx\b/i,
  ],
  symptoms: [
    /\bSymptoms?\b/i,
    /\bChief\s+Complaint\b/i,
    /\bPresenting\s+Complaint\b/i,
  ],
  conclusions: [
    /\bConclusions?\b/i,
    /\bDiagnos[ei]s\b/i,
    /\bFindings\b/i,
  ],
  ratios: [
    /\bAutonomic\s+Ratios?\b/i,
    /\bEwing\s+Battery\b/i,
  ],
  events: [
    /\bEvents?\s+Log\b/i,
    /\bTest\s+Events?\b/i,
    /\bTimeline\b/i,
  ],
  physician_notes: [
    /\bPhysician\s+Notes?\b/i,
    /\bClinician\s+Notes?\b/i,
    /\bDoctor['']?s?\s+Notes?\b/i,
  ],
  unknown: [],
};

// ---------------------------------------------------------------------------
// Canonical field keys -> all accepted labels (synonyms)
// ---------------------------------------------------------------------------
//
// Each entry describes a single canonical scalar field. The extractor will:
//   1) For every `label`, build a regex of the form
//        /\b<label>\b\s*[:=]\s*<valuePattern>(\s*<unitPattern>)?/i
//      and scan the section's text.
//   2) Take the first match. If multiple labels match in the same section,
//      higher-priority labels (listed first) win.
//
export interface FieldSynonym {
  /** Canonical key — used to look up the field in the AnsStudy. */
  key: string;
  /** Accepted labels, most specific first. */
  labels: string[];
  /** Regex source for the numeric / string value. */
  valuePattern: string;
  /** Optional regex source for the unit immediately after the value. */
  unitPattern?: string;
  /** Optional post-processor that normalizes the raw match. */
  postProcess?: (raw: string) => string;
}

function lit(label: string): string {
  // Escape regex meta-chars for safe literal-label matching, then collapse
  // any internal whitespace to a \s+ token so "E/I  Ratio" or "E/I\tRatio"
  // matches the canonical "E/I Ratio" label.
  return label
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

/** Build a strict regex anchored on word/colon boundaries. */
export function buildFieldRegex(s: FieldSynonym, label: string): RegExp {
  // Allow "Label:" / "Label =" / "Label -" / "Label" with optional whitespace
  const sep = "\\s*(?:[:=\\-\u2013\u2014])?\\s*";
  const unit = s.unitPattern ? `(?:\\s*(${s.unitPattern}))?` : "";
  const re =
    "(?<![\\w])" +     // not preceded by word char
    lit(label) +
    "(?![\\w])" +     // not followed by word char (so "HR" doesn't match "HRV")
    sep +
    "(" +
    s.valuePattern +
    ")" +
    unit;
  return new RegExp(re, "i");
}

export const NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?";
const INT_PATTERN = "\\d+";
const TEXT_PATTERN = "[^\\r\\n;]+?";
// Greedy printable-label value: a run of human-readable characters (letters,
// digits, spaces, and common punctuation), stopping at control/binary bytes or
// a line break. Used for free-text fields like Procedure so we capture the
// whole label ("ANS Autonomic Study") instead of a single non-greedy char, and
// so binary padding after a bare marker yields no printable value.
// A single token may contain interior single spaces, but 2+ spaces (or a tab)
// mark the next header field, so we stop there rather than swallowing it.
const LABEL_TEXT_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9,.&()/+-]|[ ](?![ ]))*";

export const FIELD_SYNONYMS: Record<string, FieldSynonym> = {
  // ---- Patient identifiers --------------------------------------------------
  PATIENT_NAME: {
    key: "patient.fullName",
    labels: ["Patient Name", "Patient", "Name"],
    valuePattern: TEXT_PATTERN,
  },
  DOB: {
    key: "patient.dob",
    labels: ["Date of Birth", "Birth Date", "D.O.B.", "DOB", "Born"],
    valuePattern:
      "(?:\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})|(?:\\d{4}-\\d{2}-\\d{2})",
  },
  AGE: {
    key: "patient.ageAtStudy",
    labels: ["Age at Study", "Patient Age", "Age"],
    valuePattern: INT_PATTERN,
    unitPattern: "yrs?|years?|y\\.o\\.?|y/o",
  },
  SEX: {
    key: "patient.sex",
    labels: ["Sex", "Gender"],
    valuePattern: "Male|Female|M|F|Other|Unknown",
  },
  MRN: {
    key: "patient.mrn",
    labels: ["MRN", "Medical Record Number", "Chart #", "Patient ID"],
    valuePattern: "[A-Za-z0-9\\-]+",
  },
  PHYSICIAN: {
    key: "patient.physician",
    labels: ["Physician", "Doctor", "Provider", "Referring Physician"],
    valuePattern: TEXT_PATTERN,
  },

  // ---- Study metadata -------------------------------------------------------
  STUDY_DATE: {
    key: "fileMetadata.studyDate",
    labels: ["Study Date", "Test Date", "Exam Date", "Date of Study"],
    valuePattern:
      "(?:\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})|(?:\\d{4}-\\d{2}-\\d{2})",
  },
  STUDY_START_TIME: {
    key: "fileMetadata.studyStartTime",
    labels: ["Study Start", "Test Start", "Start Time", "Recording Start"],
    valuePattern: "\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?",
  },
  PROCEDURE: {
    key: "fileMetadata.procedureType",
    labels: ["Procedure", "Protocol", "Test Type"],
    valuePattern: LABEL_TEXT_PATTERN,
  },

  // ---- Anthropometrics ------------------------------------------------------
  HEIGHT: {
    key: "anthropometrics.height",
    labels: ["Height"],
    valuePattern: "\\d+\\s*ft\\s*\\d+\\s*in|\\d+(?:\\.\\d+)?\\s*(?:cm|in)",
  },
  WEIGHT: {
    key: "anthropometrics.weight",
    labels: ["Weight"],
    valuePattern: "\\d{2,3}(?:\\.\\d+)?",
    unitPattern: "lbs?|pounds|kg",
  },
  BMI: {
    key: "anthropometrics.bmi",
    labels: ["BMI", "Body Mass Index"],
    valuePattern: NUMBER_PATTERN,
  },

  // ---- Vital signs ----------------------------------------------------------
  HEART_RATE: {
    key: "phase.heartRate",
    labels: [
      "Mean Heart Rate",
      "Resting Heart Rate",
      "Heart Rate",
      "Pulse Rate",
      "HR",
      "Pulse",
      "HR avg",
    ],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "bpm|beats\\s*\\/?\\s*min",
  },
  RR_INTERVAL: {
    key: "phase.rrInterval",
    labels: [
      "R-R Interval",
      "RR Interval",
      "Mean RR",
      "Mean R-R",
      "Mean NN",
      "NN Interval",
      "RRI",
    ],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "ms|msec",
  },
  SBP: {
    key: "phase.bp.sbp",
    labels: [
      "Systolic Blood Pressure",
      "Systolic BP",
      "Systolic Pressure",
      "Systolic",
      "SBP",
      "SYS",
    ],
    valuePattern: INT_PATTERN,
    unitPattern: "mm\\s*Hg|mmHg",
  },
  DBP: {
    key: "phase.bp.dbp",
    labels: [
      "Diastolic Blood Pressure",
      "Diastolic BP",
      "Diastolic Pressure",
      "Diastolic",
      "DBP",
      "DIA",
    ],
    valuePattern: INT_PATTERN,
    unitPattern: "mm\\s*Hg|mmHg",
  },
  MAP: {
    key: "phase.bp.map",
    labels: ["Mean Arterial Pressure", "MAP", "MBP"],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "mm\\s*Hg|mmHg",
  },
  BP_COMBINED: {
    key: "phase.bp.combined",
    labels: ["BP", "Blood Pressure"],
    valuePattern: "\\d{2,3}\\s*\\/\\s*\\d{2,3}",
    unitPattern: "mm\\s*Hg|mmHg",
  },

  // ---- Autonomic spectral metrics ------------------------------------------
  LFA: {
    key: "phase.lfa",
    labels: ["Low Frequency Area", "Sympathetic", "LFa", "LF"],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "bpm2|bpm\\^2|ms2|ms\\^2",
  },
  RFA: {
    key: "phase.rfa",
    labels: ["Respiratory Frequency Area", "Parasympathetic", "RFa", "RF", "HF"],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "bpm2|bpm\\^2|ms2|ms\\^2",
  },
  SB: {
    key: "phase.sb",
    labels: ["Sympathovagal Balance", "LFa/RFa", "LF/HF", "SB"],
    valuePattern: NUMBER_PATTERN,
  },

  // ---- Standard ANS ratios --------------------------------------------------
  EI_RATIO: {
    key: "ratios.eiRatio",
    labels: [
      "Expiratory Inspiratory Ratio",
      "E:I Ratio",
      "E/I Ratio",
      "E:I",
      "E/I",
    ],
    valuePattern: NUMBER_PATTERN,
  },
  VALSALVA_RATIO: {
    key: "ratios.valsalvaRatio",
    labels: ["Valsalva Ratio"],
    valuePattern: NUMBER_PATTERN,
  },
  THIRTY_FIFTEEN_RATIO: {
    key: "ratios.thirtyFifteenRatio",
    labels: ["30:15 Ratio", "30/15 Ratio", "30 to 15 Ratio"],
    valuePattern: NUMBER_PATTERN,
  },
  ECTOPIC_BEATS: {
    key: "ratios.ectopicBeats",
    labels: [
      "Premature Beats",
      "Ectopic Beats",
      "PVCs",
      "PACs",
      "Premature Ventricular Contractions",
      "Premature Atrial Contractions",
    ],
    valuePattern: INT_PATTERN,
  },
  SUDOMOTOR: {
    key: "sudomotor.qsart",
    labels: [
      "QSART",
      "Quantitative Sudomotor Axon Reflex Test",
      "Sweat Response",
      "Sudomotor Response",
      "Sudomotor Function",
      "Electrochemical Skin Conductance",
      "ESC",
    ],
    valuePattern: NUMBER_PATTERN,
    unitPattern: "u?L|uL|nL|uS|nS|micro\\s*siemens",
  },
  ORTHOSTATIC_INTOLERANCE: {
    key: "diagnostics.orthostaticIntolerance",
    labels: [
      "Postural Tachycardia",
      "Orthostatic Intolerance",
      "Postural Orthostatic Tachycardia",
      "OI Score",
      "OI",
    ],
    valuePattern: TEXT_PATTERN,
  },

  // ---- Med / symptom free-text ---------------------------------------------
  MEDICATIONS: {
    key: "medications.raw",
    labels: ["Medications", "Current Medications", "Rx"],
    valuePattern: "[^\\x00]{1,400}",
  },
  SYMPTOMS: {
    key: "symptoms.raw",
    labels: ["Symptoms", "Chief Complaint"],
    valuePattern: "[^\\x00]{1,400}",
  },
};

// ---------------------------------------------------------------------------
// Symptom keyword normalization (for SymptomEntry.key)
// ---------------------------------------------------------------------------
export const SYMPTOM_KEYWORDS: Record<string, RegExp[]> = {
  dizziness: [/\bdizz/i, /\blight[\-\s]?head/i, /\bvertigo\b/i],
  syncope: [/\bsyncope\b/i, /\bfaint/i, /\bpassed?\s+out\b/i, /\bloss\s+of\s+consciousness\b/i, /\bLOC\b/],
  presyncope: [/\bpre[\-\s]?syncop/i, /\bnear[\-\s]?faint/i],
  palpitations: [/\bpalpitation/i, /\bracing\s+heart\b/i, /\bpounding\s+heart\b/i],
  fatigue: [/\bfatigue\b/i, /\bexhaust/i, /\btired/i, /\blethargy\b/i, /\bmalaise\b/i],
  brain_fog: [/\bbrain\s+fog\b/i, /\bcognitive\s+(?:fog|haze|impair)\b/i, /\bmental\s+cloudiness\b/i],
  sleep_disturbance: [/\binsomnia\b/i, /\bsleep\s+(?:disturbance|problems?)\b/i, /\bnon[\-\s]?restorative\s+sleep\b/i],
  exercise_intolerance: [/\bexercise\s+intoleranc/i, /\bpost[\-\s]?exertional\s+malaise\b/i, /\bPEM\b/],
  chest_pain: [/\bchest\s+pain\b/i, /\bchest\s+discomfort\b/i, /\bchest\s+tightness\b/i],
  anxiety: [/\banxiety\b/i, /\banxious\b/i, /\bpanic\s+attack/i],
  depression: [/\bdepression\b/i, /\bdepressed\b/i, /\blow\s+mood\b/i],
  numbness: [/\bnumbness\b/i, /\btingling\b/i, /\bparesthesia\b/i],
  gi_dysmotility: [/\bgastroparesis\b/i, /\bearly\s+satiety\b/i, /\bGI\s+dysmotility\b/i, /\bdelayed\s+gastric\s+emptying\b/i],
  thermoregulatory: [/\banhidrosis\b/i, /\bhyperhidrosis\b/i, /\bheat\s+intoleranc/i, /\bcold\s+intoleranc/i, /\bthermoregulatory\s+dysfunction\b/i],
  bladder_dysfunction: [/\bneurogenic\s+bladder\b/i, /\burinary\s+(?:retention|urgency|frequency)\b/i],
};

// ---------------------------------------------------------------------------
// Pattern labels (for AnsConclusion.pattern detection in summary text)
// ---------------------------------------------------------------------------
export const PATTERN_LABELS: Record<string, RegExp[]> = {
  PE: [/\bparasympathetic\s+excess\b/i, /\bPE\b/i],
  PW: [/\bparasympathetic\s+weakness\b/i, /\bPW\b/i],
  SE: [/\bsympathetic\s+excess\b/i, /\bSE\b/i],
  SW: [/\bsympathetic\s+(?:weakness|withdrawal)\b/i, /\bSW\b/i],
  AAD: [/\badvanced\s+autonomic\s+dysfunction\b/i, /\bAAD\b/i],
  CAN: [/\bcardiac\s+autonomic\s+neuropathy\b/i, /\bCAN\b/i],
  POTS: [/\bpostural\s+orthostatic\s+tachycardia\b/i, /\bPOTS\b/i, /\bpostural\s+tachycardia\s+syndrome\b/i],
  VASOVAGAL: [/\bvasovagal\b/i, /\bneurocardiogenic\b/i, /\bneurally\s+mediated\s+syncope\b/i],
  ORTHOSTATIC_HYPOTENSION: [/\borthostatic\s+hypotension\b/i, /\bOH\b/i, /\bneurogenic\s+orthostatic\s+hypotension\b/i, /\bnOH\b/],
  CARDIOVAGAL_IMPAIRMENT: [/\bcardiovagal\s+(?:impairment|dysfunction)\b/i, /\bvagal\s+impairment\b/i],
  SUDOMOTOR_DYSFUNCTION: [/\bsudomotor\s+(?:dysfunction|impairment)\b/i, /\bsmall\s+fiber\s+neuropathy\b/i, /\bSFN\b/],
  ADRENERGIC_FAILURE: [/\badrenergic\s+failure\b/i, /\bsympathetic\s+failure\b/i],
};
