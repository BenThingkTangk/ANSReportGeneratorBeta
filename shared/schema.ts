// Shared types for the HumanOS ANS application.
// Kept in sync with api/upload.ts (Colombo methodology V2).
//
// NOTE: We use TypeScript interfaces here instead of Zod schemas because the
// frontend treats these as opaque transport types. Validation happens on the
// server where the algorithm generates them.

import type { MetricProvenance } from "./metricProvenance.js";
import type { PatternStates, Scorability } from "./clinicalStates.js";

export interface ANSPatientData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  /** UNKNOWN IS null, never 0. A 0 lb weight / 0 BMI is not a measurement. */
  weight?: number | null;
  bmi?: number | null;
  dobString?: string;
  testDate?: string;
  /** UNKNOWN IS null, never 0 (a 0.00 ratio would classify as severely abnormal). */
  eiRatio: number | null;
  valsalvaRatio: number | null;
  thirtyFifteenRatio: number | null;
  ectopicBeats: number;
  testNotes: string;
  procedureType: string;
  samplingInterval: number;
  dataPointCount: number;
  ecgData: number[];
  anesMedications?: string;
  otherMedicationsSymptoms?: string;
  baselineSystolicBP?: number;
  baselineDiastolicBP?: number;
  ecgQuality?: EcgQualitySummary;
  /** Seconds past midnight of the recording start, or null when unknown. */
  studyClockStartSec?: number | null;
}

/** ECG usability verdict that gates every interpretation in the report. */
export interface EcgQualitySummary {
  snrDb: number | null;
  motionFraction: number | null;
  leadOff: boolean;
  usable: boolean;
  warnings: string[];
}

export interface PhaseMetrics {
  phase: "Baseline-A" | "DeepBreathing-B" | "Baseline-C" | "Valsalva-D" | "Baseline-E" | "Stand-F";
  label: string;
  duration: string;
  durationSec: number;
  /** null when the phase had too few usable beats — never 0 bpm. */
  meanHR: number | null;
  rangeHR: number | null;
  /** ESTIMATED respiratory frequency; null when not derivable. */
  FRF: number | null;
  /**
   * Spectral aggregates. Read `provenance` to know WHAT these are:
   * `vendor_reported`/`derived_from_vendor` = verbatim vendor value;
   * `computed` (+ validation `estimated`) = HumanOS waveform-derived estimate
   * that must be labelled as such and must not be presented as vendor parity;
   * `unavailable` = value is null because the calculation was impossible.
   */
  LFa: number | null;
  RFa: number | null;
  SB: number | null;
  /** Uncertainty envelope for a waveform-derived (estimated) spectral value. */
  spectralEstimate?: {
    confidence: number;
    warnings: string[];
    bands: {
      lfLo: number; lfHi: number; hfLo: number; hfHi: number;
      bandSource: "respiration_adaptive" | "fixed_standard";
      respFreqHz: number | null;
    };
    beats: number;
    method: "morlet_cwt_bpm2";
  };
  SBP?: number;
  DBP?: number;
  PP?: number;
  MAP?: number;
  /**
   * Heart-rhythm variability. RENAMED from `HRV_SDNN` / `HRV_RMSSD`: those
   * instrument-internal parameter names shipped inside the patient-facing
   * report object and leaked through any generic key/value renderer, which the
   * PhysioPS output protocol forbids. Values and calculations are unchanged.
   * null when the beat series for the phase was not usable.
   */
  hrvOverallVariabilityMs: number | null;
  hrvBeatToBeatMs: number | null;
  /**
   * False when the beat series failed a MEASURED signal-quality check
   * (non-physiologic intervals, ectopic/mis-detected intervals vs a local
   * median, clipped rail fiducials, or alternation near the mathematical
   * RMSSD/SDNN ceiling of 2). Beat-to-beat variability simply exceeding overall
   * variability is NOT a defect: the ratio is sqrt(2*(1 - lag-1 autocorrelation)),
   * so it exceeds 1 whenever that autocorrelation is below 0.5.
   */
  hrvReliable?: boolean;
  hrvUnreliableReasons?: string[];
  /** Measured signal-quality evidence behind `hrvReliable`. */
  hrvQuality?: {
    intervals: number;
    meanRrMs: number | null;
    sdnnMs: number | null;
    rmssdMs: number | null;
    rmssdSdnnRatio: number | null;
    lag1Autocorr: number | null;
    ectopicFraction: number;
    nonPhysiologicFraction: number;
    alternationFraction: number;
    clippedFiducialFraction: number;
  };
  /** Explains a >1 RMSSD/SDNN ratio that carries no quality defect. */
  hrvRatioPhysiologicNote?: string | null;
  /**
   * The variability numbers AS MEASURED, kept even when `hrvReliable` is false
   * so a raw trend can still be charted with an explicit low-confidence label.
   * Never consumed by scoring or by any clinical claim.
   */
  hrvOverallVariabilityRawMs?: number | null;
  hrvBeatToBeatRawMs?: number | null;
  /**
   * Per-metric provenance for the proprietary [P] spectral aggregates. Present
   * for reports produced after the numericalSummaryOverride removal. `method`
   * is "computed" (generic, tagged `estimated`) or "unavailable"; it is NEVER a
   * memorized/identity-substituted vendor value.
   */
  provenance?: {
    LFa: MetricProvenance;
    RFa: MetricProvenance;
    SB: MetricProvenance;
    FRF: MetricProvenance;
  };
}

export interface Classification {
  label: "Low" | "Borderline Low" | "Normal" | "Borderline High" | "High" | "Low Normal";
  severity: "Abnormal" | "Warning" | "Normal";
  value: number;
  lo: number;
  hi: number;
}

/**
 * TRI-STATE clinical patterns: true = present, false = assessed and genuinely
 * absent, null = NOT ASSESSABLE. `false` may never stand in for "we could not
 * look" — see shared/clinicalStates.ts.
 */
export type DysfunctionPatterns = PatternStates;

export interface WellnessDriver {
  label: string;
  value: string;
  points: number;                                                        // signed: + boosts, − drags
  severity: "positive" | "neutral" | "mild" | "moderate" | "severe";
}

export interface SubScore {
  /** null when this domain had no measured input. */
  score: number | null;
  weight: number;
  contribution: number;
  drivers?: WellnessDriver[];
  notes: string[];
  /**
   * False when every component of this sub-score depends on unavailable
   * proprietary spectral data (e.g. sympathovagal balance on a raw ECG-only
   * file). Omitted/true means the sub-score reflects measured data. The UI
   * renders "Not assessed" for unavailable sub-scores instead of a number.
   */
  available?: boolean;
}

export interface WellnessBreakdown {
  baselineAutonomic: SubScore;
  sympathovagalBalance: SubScore;
  reflexIntegrity: SubScore;
  orthostaticResponse: SubScore;
  hrvReserve: SubScore;
  patternPenalty?: { total: number; items: WellnessDriver[] };
  ageMultiplier: number;
  /**
   * null when `scorability.scorable` is false. Unavailable domains contribute
   * zero out of their FULL nominal weight and are never renormalized away, so
   * missing data can only lower these figures, never raise them.
   */
  rawTotal: number | null;
  ageAdjusted: number | null;
  final: number | null;
  topPositiveDrivers?: WellnessDriver[];
  topNegativeDrivers?: WellnessDriver[];
  headline?: string;
  /**
   * Whether a composite score/tier may be published at all. Every consumer MUST
   * check this before rendering a number or a tier. Optional only for
   * back-compat with reports persisted before this contract existed.
   */
  scorability?: Scorability;
}

export interface PhaseFinding {
  phase: string;
  indication: string;
  findings: string[];
}

export interface TherapyRecommendation {
  category: string;
  intervention: string;
  dose?: string;
  rationale: string;
  contraindications?: string[];
  priority: "primary" | "secondary" | "optional";
}

export interface BodySystemImpact {
  system: "cardiovascular" | "respiratory" | "digestive" | "nervous" | "endocrine" | "musculoskeletal" | "immune";
  /**
   * Numeric magnitude retained for the heatmap gradient. When `assessed` is
   * false this is 0 (neutral) and MUST NOT be rendered as a score — the domain
   * was not measured on this recording, so the UI shows a qualitative
   * "Not assessed" state instead of a number.
   */
  impact: number;
  label: string;
  description: string;
  /** False when this domain depends on measures not available in the file. */
  assessed?: boolean;
}

export type WellnessTier = "Optimal" | "Resilient" | "Balanced" | "Stressed" | "Depleted" | "Critical";

// --- Multi-Parameter Graphical (Clinician) ---------------------------------
// Everything needed to reproduce Dr. Colombo's PhysioPS multi-parameter
// graphical report directly from the .ans file.

export interface TimeSeries {
  /** Time axis, seconds from test start, downsampled for rendering (~1 Hz or 0.5 Hz). */
  t: number[];
  /** Value at each t. */
  v: number[];
}

/** A phase boundary in seconds from test start — used to draw A/B/C/D/E/F vertical dividers. */
export interface PhaseBoundary {
  name: "A" | "B" | "C" | "D" | "E" | "F";
  label: string;
  startSec: number;
  endSec: number;
}

/** One minute of HR + breathing waveform shown in the Cardio-Respiratory Coupling grid. */
export interface CardioRespiratoryWindow {
  phase: "Baseline" | "DeepBreathing" | "Valsalva" | "Stand";
  label: string;
  /**
   * Wall clock, or null when the file carried no valid time-of-day (the UI then
   * shows the relative offsets). An hour > 23 can never be emitted.
   */
  startClock: string | null;  // e.g. "13:12:18"
  endClock: string | null;
  /** Always-valid seconds from the start of the recording. */
  startOffsetSec?: number;
  endOffsetSec?: number;
  clockSource?: "file_timestamp" | "relative_only";
  /** Per-beat HR (bpm) sampled at the R-peaks in this window, uniformly time-referenced. */
  hr: TimeSeries;
  /** Breathing envelope (EDR) over the same window, offset to the bottom of the plot. */
  breathing: TimeSeries;
  /** Annotations like "RFA = 5.13" or "E/I Ratio = 1.21". */
  annotations: string[];
}

export interface MultiParameterGraphical {
  /**
   * True iff the uploaded .ans file actually contained real ECG sample data.
   * If false, time-series panels (HR / Breathing / LFa-RFa trends, coupling
   * windows) render as informative empty states; scatter + ratio panels
   * that rely on per-phase metrics still render as normal.
   */
  ecgAvailable: boolean;
  /** Total recording length in seconds. */
  totalSec: number;
  /** A-F phase boundaries. */
  phases: PhaseBoundary[];
  /** Continuous HR (beats/min) trend across the whole test. */
  heartRateTrend: TimeSeries;
  /** Breathing envelope across the whole test (ECG-derived respiration). */
  breathingTrend: TimeSeries;
  /** LFa (sympathetic) trend — rolling wavelet power. */
  lfaTrend: TimeSeries;
  /** RFa (parasympathetic) trend — rolling wavelet power. */
  rfaTrend: TimeSeries;
  /**
   * Per-phase LFa/RFa scatter points with age-banded normal regions.
   *
   * Every field is `number | null`: the proprietary spectral aggregates are not
   * reproducible from a raw ECG-only .ans, so on those files (and for phases a
   * paired vendor PDF did not supply) the value is `null` and the panel must
   * render "Not assessed" — it is NEVER coerced to 0. Consumers MUST null-check
   * before calling numeric methods (e.g. `.toFixed()`).
   */
  scatter: {
    baselineLFa: number | null;      // A
    baselineRFa: number | null;      // A
    dbRFa: number | null;            // B
    valsalvaLFa: number | null;      // D
    standLFa: number | null;         // F
    standRFa: number | null;         // F
    /** % change A→D for Valsalva and A→F for Stand RFa, for the Excess panel.
     *  null when either endpoint's RFa is unavailable. */
    rfaChangeValsalvaPct: number | null;
    rfaChangeStandPct: number | null;
  };
  /** Per-phase cardio-respiratory coupling windows (60 s each for Baseline/DB/Valsalva; 90 s for Stand). */
  coupling: CardioRespiratoryWindow[];
  /** Wavelet analysis metadata for the footer. */
  wavelet: { type: string; cycles: number; spectralUpdateSec: number };
}

export interface ANSReport {
  patientData: ANSPatientData;
  /** null when the composite is not scorable (see wellnessBreakdown.scorability). */
  wellnessScore: number | null;
  wellnessTier: WellnessTier | null;
  wellnessBreakdown: WellnessBreakdown;
  riskLevel: string;
  energyLevel: "Low" | "Moderate" | "High";
  /**
   * True only when the proprietary spectral aggregates (LFa/RFa/SB) are
   * available at a clinically-usable provenance tier. False for raw ECG-only
   * .ans files — every spectral/adrenergic/neuropathy interpretation is then
   * gated OFF, and the UI must render "Not assessed".
   */
  spectralAvailable?: boolean;
  /**
   * Where the spectral numbers in `phaseEvents` came from. "humanos_estimated"
   * means displayable-but-unvalidated waveform estimates: charts and trends are
   * populated, while `spectralAvailable` stays false so no clinical conclusion
   * or composite score consumes them.
   */
  spectralSource?: "ans_stored" | "vendor_reported" | "humanos_estimated" | "unavailable";
  /** Uncertainty envelope + mandatory disclosure for waveform estimates. */
  spectralEstimation?: {
    present: boolean;
    method: "morlet_cwt_bpm2" | null;
    confidence: number | null;
    warnings: string[];
    disclosure: string;
  };
  bpAvailable?: boolean;
  autonomicBalance: {
    // null when spectral aggregates are unavailable — the UI must render
    // "Not assessed", never coerce to 0 or a 0/100 percentage split.
    parasympathetic: number | null;
    sympathetic: number | null;
    balance: number | null;
    available?: boolean;
    interpretation: string;
  };
  phaseEvents: PhaseMetrics[];
  ratios: {
    eiRatio: { value: number | null; normal: string; classification: Classification | null };
    valsalvaRatio: { value: number | null; normal: string; classification: Classification | null };
    thirtyFifteenRatio: { value: number | null; normal: string; classification: Classification | null };
  };
  phaseFindings: PhaseFinding[];
  dysfunctionPatterns: DysfunctionPatterns;
  therapyRecommendations: TherapyRecommendation[];
  contraindications: string[];
  followUp: { retestInterval: string; rationale: string; monitorParameters: string[] };
  bodySystemImpact: BodySystemImpact[];
  clinicalFlags: string[];
  overallImpression: string;
  samplingRate: number;
  respiratoryFrequency: number | null;
  /** Explicit validation envelope for the respiratory estimate. */
  respiratory?: {
    frequencyHz: number | null;
    validation: "estimated" | "unavailable";
    note: string;
  };
  ecgQuality?: EcgQualitySummary;
  rPeakCount: number;
  generatedAt: string;
  patientSynopsis?: string;
  clinicianSynopsis?: string;
  multiParameter?: MultiParameterGraphical;
  /** Path B — Colombo indication detection (CAN, POTS, OD, VVS, etc.) */
  indications?: Indication[];
  /** PR2 — Deterministic scoring + confidence summary (back-compat optional). */
  diagnosticSummary?: import("./diagnosticSummary").DiagnosticSummary;
  /** Warnings when a paired vendor PDF's identity did NOT reconcile. */
  vendorReconciliationWarnings?: string[];
  /** Paired vendor-PDF identity reconciliation status (drives the matched badge). */
  vendorReconciliation?: {
    status:
      | "no_vendor_pdf"
      | "matched"
      | "unreadable_numerics"
      | "conflicting_recommendations"
      | "mismatch"
      | "malformed";
    matchedName?: string;
    matchedDate?: string;
    checks?: { name: boolean | null; testDate: boolean | null; dob: boolean | null };
    reason?: string;
    /** Plain counts, never a percent-confidence figure. */
    numericFields?: { read: number; total: number };
    /** Unresolved disagreements BETWEEN vendor documents. */
    conflicts?: Array<{
      field: string;
      values: Array<{ value: string; source: string }>;
      message: string;
    }>;
  };
}

export interface UploadResponse {
  success: boolean;
  patientData?: ANSPatientData;
  report?: ANSReport;
  error?: string;
  /** PR1 — normalized AnsStudy with per-field provenance. */
  ansStudy?: import("./ansStudy").AnsStudy;
  /** PR2 — deterministic DiagnosticSummary. */
  diagnosticSummary?: import("./diagnosticSummary").DiagnosticSummary;
}

// Colombo P&S indication detection (Path B)
export interface Indication {
  code: string;
  name: string;
  description: string;
  severity: "high" | "moderate" | "low";
}

// Ask Atom chat message
export interface AtomMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  timestamp?: string;
}
