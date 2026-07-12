// Shared types for the HumanOS ANS application.
// Kept in sync with api/upload.ts (Colombo methodology V2).
//
// NOTE: We use TypeScript interfaces here instead of Zod schemas because the
// frontend treats these as opaque transport types. Validation happens on the
// server where the algorithm generates them.

import type { MetricProvenance } from "./metricProvenance.js";

export interface ANSPatientData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  weight?: number;
  bmi?: number;
  dobString?: string;
  testDate?: string;
  eiRatio: number;
  valsalvaRatio: number;
  thirtyFifteenRatio: number;
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
}

export interface PhaseMetrics {
  phase: "Baseline-A" | "DeepBreathing-B" | "Baseline-C" | "Valsalva-D" | "Baseline-E" | "Stand-F";
  label: string;
  duration: string;
  durationSec: number;
  meanHR: number;
  rangeHR: number;
  FRF: number;
  LFa: number;
  RFa: number;
  SB: number;
  SBP?: number;
  DBP?: number;
  PP?: number;
  MAP?: number;
  HRV_SDNN: number;
  HRV_RMSSD: number;
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

export interface DysfunctionPatterns {
  parasympatheticDominance: boolean;
  parasympatheticExcess: boolean;
  parasympatheticWithdrawal: boolean;
  sympatheticExcess: boolean;
  sympatheticWithdrawal: boolean;
  maskedSW: boolean;
  advancedAutonomicDysfunction: boolean;
  CAN: boolean;
  POTS: boolean;
  orthostaticHypotension: boolean;
  vasovagalRisk: boolean;
  preSyncopeRisk: boolean;
  bradycardia: boolean;
  highFRF: boolean;
}

export interface WellnessDriver {
  label: string;
  value: string;
  points: number;                                                        // signed: + boosts, − drags
  severity: "positive" | "neutral" | "mild" | "moderate" | "severe";
}

export interface SubScore {
  score: number;
  weight: number;
  contribution: number;
  drivers?: WellnessDriver[];
  notes: string[];
}

export interface WellnessBreakdown {
  baselineAutonomic: SubScore;
  sympathovagalBalance: SubScore;
  reflexIntegrity: SubScore;
  orthostaticResponse: SubScore;
  hrvReserve: SubScore;
  patternPenalty?: { total: number; items: WellnessDriver[] };
  ageMultiplier: number;
  rawTotal: number;
  ageAdjusted: number;
  final: number;
  topPositiveDrivers?: WellnessDriver[];
  topNegativeDrivers?: WellnessDriver[];
  headline?: string;
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
  impact: number;
  label: string;
  description: string;
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
  startClock: string;  // e.g. "13:12:18"
  endClock: string;
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
  /** Per-phase LFa/RFa scatter points with age-banded normal regions. */
  scatter: {
    baselineLFa: number;      // A
    baselineRFa: number;      // A
    dbRFa: number;            // B
    valsalvaLFa: number;      // D
    standLFa: number;         // F
    standRFa: number;         // F
    /** % change A→D for Valsalva and A→F for Stand RFa, for the Excess panel. */
    rfaChangeValsalvaPct: number;
    rfaChangeStandPct: number;
  };
  /** Per-phase cardio-respiratory coupling windows (60 s each for Baseline/DB/Valsalva; 90 s for Stand). */
  coupling: CardioRespiratoryWindow[];
  /** Wavelet analysis metadata for the footer. */
  wavelet: { type: string; cycles: number; spectralUpdateSec: number };
}

export interface ANSReport {
  patientData: ANSPatientData;
  wellnessScore: number;
  wellnessTier: WellnessTier;
  wellnessBreakdown: WellnessBreakdown;
  riskLevel: string;
  energyLevel: "Low" | "Moderate" | "High";
  autonomicBalance: {
    parasympathetic: number;
    sympathetic: number;
    balance: number;
    interpretation: string;
  };
  phaseEvents: PhaseMetrics[];
  ratios: {
    eiRatio: { value: number; normal: string; classification: Classification };
    valsalvaRatio: { value: number; normal: string; classification: Classification };
    thirtyFifteenRatio: { value: number; normal: string; classification: Classification };
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
  respiratoryFrequency: number;
  rPeakCount: number;
  generatedAt: string;
  patientSynopsis?: string;
  clinicianSynopsis?: string;
  multiParameter?: MultiParameterGraphical;
  /** Path B — Colombo indication detection (CAN, POTS, OD, VVS, etc.) */
  indications?: Indication[];
  /** PR2 — Deterministic scoring + confidence summary (back-compat optional). */
  diagnosticSummary?: import("./diagnosticSummary").DiagnosticSummary;
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
