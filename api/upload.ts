import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseStudy } from "./_ans/parseStudy.js";
import {
  ansStudyToLegacy,
  deriveStudyClockStartSec,
  type LegacyEcgQuality,
} from "./_ans/legacyAdapter.js";
import { isSentinelSample } from "../shared/ecgScaling.js";
import {
  detectVendorConflicts,
  type VendorDocumentText,
} from "../shared/vendorConflicts.js";
import { computeDiagnosticSummary } from "./_ans/scoring/index.js";
import { reconcileStudyWithReport } from "./_ans/reconcileStudy.js";
import { reconcilePhenotypesWithVendor } from "./_ans/reconcilePhenotypesWithVendor.js";
import { reconcileVendorIdentity } from "./_ans/reconcileVendorIdentity.js";
import {
  EWING_THRESHOLDS,
  classifyEwing,
  ewingNormalRangeLabel,
  COLOMBO_NORMS,
  classifyLowSbDriver,
  ageContinuousNorm,
  ratioReferenceLabel,
  ewingThresholdForAge,
} from "../shared/colomboNorms.js";
import {
  PATTERN_KEYS,
  type PatternKey,
  type PatternStates,
  type TriState,
  type Scorability,
  type ScorabilityBlocker,
  presentPatterns,
  unassessablePatterns,
  mayClaimNoAbnormalPatterns,
  resolvePattern,
  scorabilityFrom,
} from "../shared/clinicalStates.js";
import {
  computedProvenance,
  unavailableProvenance,
  vendorReportedProvenance,
  derivedFromVendorProvenance,
  mayInterpretClinically,
  type MetricProvenance,
} from "../shared/metricProvenance.js";
import {
  estimatePhaseSpectral,
  estimateRespiratoryFrequencyFromPeaks,
  respirationAdaptiveBands,
  morletBandPowerSeries,
  resampleBeatsToBpmGrid,
  highPassMovingAverage,
  ESTIMATED_SPECTRAL_NOTE,
  ESTIMATED_SB_NOTE,
  ESTIMATED_FRF_NOTE,
  RESAMPLE_FS,
  type SpectralBands,
} from "./_ans/spectral.js";
import {
  assessRrQuality,
  highRatioIsPhysiologic,
  NEAR_LIMIT_RATIO,
  type RrQualityMetrics,
} from "./_ans/signalQuality.js";

/**
 * Vendor-reported metrics parsed verbatim from the paired signed PDF
 * (api/_ans/vendorReport.ts). When present, these populate the proprietary
 * spectral aggregates (LFa/RFa/SB) and cuff BP that the raw .ans export cannot
 * carry, tagged `vendor_reported` so the spectral-availability gate opens and
 * the full Colombo interpretation/treatment pathway runs. Values are injected
 * verbatim — never computed or inferred here.
 */
export interface VendorReportedMetrics {
  LFa?: number;
  RFa?: number;
  SB?: number;
  SBP?: number;
  DBP?: number;
}

/**
 * Result of reconciling a paired vendor-PDF's identity against the parsed .ans.
 * "matched" is the positive status the clinician UI shows as a "Vendor report
 * matched" badge; the others explain why vendor values were withheld.
 */
export type VendorReconciliationState =
  /** No vendor PDF was attached at all. */
  | "no_vendor_pdf"
  /** Attached, identity reconciled, numeric content read. */
  | "matched"
  /**
   * Attached and identity-reconciled, but NO numeric field could be read (e.g.
   * an image-only report whose OCR produced no usable numbers). This is NOT the
   * same as "no vendor PDF" and must never be shown as a low-confidence match.
   */
  | "unreadable_numerics"
  /** Attached and readable, but two vendor documents disagree. */
  | "conflicting_recommendations"
  /** Attached but identity does not match the .ans. */
  | "mismatch"
  /** Attached but structurally unparseable. */
  | "malformed";

/** A disagreement BETWEEN vendor documents, surfaced instead of silently resolved. */
export interface VendorConflict {
  field: string;
  /** Each distinct vendor value with the document it came from. */
  values: Array<{ value: string; source: string }>;
  /** Human-readable statement of the conflict. Never picks a winner. */
  message: string;
}

export interface VendorReconciliationStatus {
  status: VendorReconciliationState;
  matchedName?: string;
  matchedDate?: string;
  checks?: { name: boolean | null; testDate: boolean | null; dob: boolean | null };
  reason?: string;
  /**
   * Plain counts, never a percentage-of-confidence figure. "0 of 18 numeric
   * fields read" is actionable; "18 fields, 0% mean confidence" reads like a
   * low-quality match rather than a total read failure.
   */
  numericFields?: { read: number; total: number };
  /** Unresolved disagreements between vendor documents (e.g. 3- vs 6-month retest). */
  conflicts?: VendorConflict[];
}

export const config = {
  api: {
    bodyParser: false,
  },
};

// ==================================================================
// SELF-CONTAINED: Types, parser, and gold-standard Colombo algorithm
// inlined to avoid cross-directory bundler issues on Vercel serverless.
// Based on /home/user/workspace/humanos-ans/api/ansAlgorithmV2.ts.
// ==================================================================

// ---- Types ------------------------------------------------------------------

interface ParsedANSData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  /**
   * UNKNOWN IS `null`, NEVER 0. A weight of 0 lb / a BMI of 0 is not a
   * measurement, it is a sentinel that downstream code and clinicians read as a
   * real value. The `.ans` export carries no weight, so this is normally null.
   */
  weight: number | null;
  bmi: number | null;
  dobString: string;
  testDate: string;
  /**
   * Ewing time-domain ratios. `null` when the file did not carry them — a 0.00
   * ratio would be scored as profoundly abnormal, so the 0 sentinel is unsafe
   * and has been removed.
   */
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
  /**
   * ECG signal-usability verdict from the deterministic parser. Interpretation
   * is GATED on this: an unusable recording may not produce a wellness score,
   * a tier, or a "no abnormal patterns" claim.
   */
  ecgQuality?: LegacyEcgQuality;
  /**
   * Seconds-past-midnight of the recording start, derived from a real parsed
   * timestamp. `null` when the file carried no valid time — in that case the UI
   * shows RELATIVE time only. Never a fabricated default.
   */
  studyClockStartSec?: number | null;
}

interface PhaseMetrics {
  phase: "Baseline-A" | "DeepBreathing-B" | "Baseline-C" | "Valsalva-D" | "Baseline-E" | "Stand-F";
  label: string;
  duration: string;
  durationSec: number;
  /**
   * `null` when the phase had too few usable beats to compute a rate. 0 bpm is
   * not a heart rate; the sentinel has been removed.
   */
  meanHR: number | null;
  rangeHR: number | null;
  /**
   * Fundamental respiratory frequency, ESTIMATED from the R-peak envelope.
   * `null` when not derivable. Always accompanied by `provenance.FRF`, whose
   * validation status is `estimated` — never published as a measured fact.
   */
  FRF: number | null;
  /**
   * Spectral aggregates. Three distinct states, always disambiguated by
   * `provenance` (never by the number alone):
   *   - `vendor_reported` / `derived_from_vendor` — verbatim from the paired
   *     signed PDF (baseline A only). Clinically interpretable.
   *   - `computed` + `validation: "estimated"` — HumanOS waveform-derived
   *     estimate (Morlet band power in bpm² over respiration-adaptive bands).
   *     Publishable as a labelled estimate/chart; NOT clinically interpretable
   *     and NOT asserted to match PhysioPS output.
   *   - `unavailable` → value is `null` (too few usable beats / segment too
   *     short for the band). Never 0, never fabricated.
   */
  LFa: number | null;
  RFa: number | null;
  SB: number | null;
  /**
   * Uncertainty envelope for the WAVEFORM-DERIVED spectral estimate of this
   * phase. Present whenever the estimator ran (even if it declined to produce a
   * number). Absent for vendor-reported values.
   */
  spectralEstimate?: {
    /** 0..1 self-assessed confidence. Never a clinical gate on its own. */
    confidence: number;
    /** Reasons the estimate is uncertain (artifacts, short segment, ...). */
    warnings: string[];
    /** Band edges used + how they were chosen. */
    bands: SpectralBands;
    /** R-R intervals the estimate was built from. */
    beats: number;
    method: "morlet_cwt_bpm2";
  };
  SBP?: number;
  DBP?: number;
  PP?: number;
  MAP?: number;
  /**
   * Heart-rhythm variability, plain-language keys.
   *
   * RENAMED from `HRV_SDNN` / `HRV_RMSSD`. These objects ship inside the
   * patient-facing `report`, so the instrument-internal parameter names were
   * exposed to any generic key/value renderer, debug view or JSON export — a
   * PhysioPS output-protocol violation. The VALUES and every calculation are
   * unchanged; only the key names are neutral.
   *
   * `null` when the beats in this phase were not usable (see `hrvReliable`).
   */
  hrvOverallVariabilityMs: number | null;
  hrvBeatToBeatMs: number | null;
  /**
   * False when the beat series for this phase fails a MEASURED signal-quality
   * check: non-physiologic intervals, ectopic/mis-detected intervals against a
   * local median, clipped (rail-saturated) fiducial points, or alternation near
   * the mathematical RMSSD/SDNN ceiling of 2. Beat-to-beat variability merely
   * exceeding overall variability is NOT a defect — see api/_ans/signalQuality.ts.
   * When false the variability values above are `null` and MUST NOT feed any score.
   */
  hrvReliable: boolean;
  /**
   * The variability numbers AS MEASURED, retained even when `hrvReliable` is
   * false so the raw measurable trend can still be charted with an explicit
   * low-confidence label. These are NEVER read by scoring or by any clinical
   * claim — scoring reads `hrvOverallVariabilityMs`/`hrvBeatToBeatMs`, which
   * stay `null` for an unreliable series. `null` only when the computation was
   * impossible (fewer than 4 usable intervals).
   */
  hrvOverallVariabilityRawMs: number | null;
  hrvBeatToBeatRawMs: number | null;
  /** Why `hrvReliable` is false. Empty when the series is usable. */
  hrvUnreliableReasons: string[];
  /** Measured signal-quality evidence behind `hrvReliable`. */
  hrvQuality?: RrQualityMetrics;
  /**
   * Set when RMSSD/SDNN exceeds 1 with no quality defect — the case the removed
   * "physiologically impossible" gate used to reject. Explains that the ratio is
   * governed by lag-1 autocorrelation and is bounded by 2.
   */
  hrvRatioPhysiologicNote?: string | null;
  /**
   * Per-metric provenance for the spectral aggregates (LFa/RFa/SB/FRF). The raw
   * .ans is never used to synthesize LFa/RFa/SB: those are `unavailable` unless
   * a paired vendor PDF supplied them (baseline A only), in which case they are
   * `vendor_reported` (or `derived_from_vendor` for a computed SB = LFa/RFa).
   * FRF is `computed` from the RR/peak envelope (a genuine time-domain measure).
   */
  provenance?: {
    LFa: MetricProvenance;
    RFa: MetricProvenance;
    SB: MetricProvenance;
    FRF: MetricProvenance;
  };
}

interface Classification {
  label: "Low" | "Borderline Low" | "Normal" | "Borderline High" | "High" | "Low Normal";
  severity: "Abnormal" | "Warning" | "Normal";
  value: number;
  lo: number;
  hi: number;
}

/**
 * TRI-STATE clinical patterns: true = present, false = assessed and genuinely
 * absent, null = NOT ASSESSABLE. See `shared/clinicalStates.ts` for why `false`
 * may never stand in for "we could not look" — that defect told downstream
 * consumers an abnormality was absent on a recording where the vendor clinician
 * documented Sympathetic Excess, pre-syncope risk and Advanced Autonomic
 * Dysfunction.
 */
type DysfunctionPatterns = PatternStates;

interface WellnessDriver {
  label: string;       // human-readable, e.g. "Baseline SB 0.18 — parasympathetic-dominant"
  value: string;       // the observed value, e.g. "0.18" or "56 bpm"
  points: number;      // signed contribution to the *final* score (positive boosts, negative drags)
  severity: "positive" | "neutral" | "mild" | "moderate" | "severe";
}

interface SubScore {
  score: number | null; // 0–100, or null when the domain was not assessable
  weight: number;       // effective (renormalized-over-available) weight in the composite
  contribution: number; // score × effective weight (points contributed to rawTotal out of 100)
  drivers: WellnessDriver[]; // ordered top-down by absolute |points|
  notes: string[];      // legacy plain-text notes for back-compat
  // False when every component of this sub-score depends on unavailable
  // proprietary spectral data (e.g. sympathovagal balance on a raw ECG-only
  // file). The UI renders "Not assessed" instead of a number.
  available?: boolean;
}

interface WellnessBreakdown {
  baselineAutonomic: SubScore;
  sympathovagalBalance: SubScore;
  reflexIntegrity: SubScore;
  orthostaticResponse: SubScore;
  hrvReserve: SubScore;
  patternPenalty: { total: number; items: WellnessDriver[] }; // negative points applied after composite
  ageMultiplier: number;
  /**
   * Composite over the FULL nominal weight set. Unavailable domains contribute
   * ZERO and their weight is NOT redistributed, so missing data can only ever
   * lower this number — never raise it. (The previous behaviour renormalized
   * over the available domains, so the absence of the one domain the vendor
   * flagged as abnormal silently inflated the composite to 91 / "Optimal".)
   *
   * `null` whenever `scorability.scorable` is false: no number is published.
   */
  rawTotal: number | null;
  ageAdjusted: number | null;
  final: number | null;
  topPositiveDrivers: WellnessDriver[]; // top 3 boosters across all categories
  topNegativeDrivers: WellnessDriver[]; // top 3 draggers across all categories
  headline: string;                     // one-sentence summary under the number
  /**
   * Whether a composite may be published at all, and why not. Authoritative:
   * every consumer must check this before rendering a score or tier.
   */
  scorability: Scorability;
}

interface PhaseFinding {
  phase: string;
  indication: string;
  findings: string[];
}

interface TherapyRecommendation {
  category: string;
  intervention: string;
  dose?: string;
  rationale: string;
  contraindications?: string[];
  priority: "primary" | "secondary" | "optional";
}

interface BodySystemImpact {
  system: "cardiovascular" | "respiratory" | "digestive" | "nervous" | "endocrine" | "musculoskeletal" | "immune";
  impact: number;
  label: string;
  description: string;
  assessed?: boolean;
}

// Multi-Parameter Graphical (kept in sync with shared/schema.ts)
interface TimeSeries { t: number[]; v: number[]; }
interface PhaseBoundary { name: "A"|"B"|"C"|"D"|"E"|"F"; label: string; startSec: number; endSec: number; }
interface CardioRespiratoryWindow {
  phase: "Baseline" | "DeepBreathing" | "Valsalva" | "Stand";
  label: string;
  /**
   * Wall-clock start/end, ONLY when a valid time-of-day was parsed from the
   * file. `null` otherwise — the UI then shows `startOffsetSec`/`endOffsetSec`
   * as relative time. An hour > 23 can no longer be emitted: the old code
   * matched the literal "30:15" of the *30:15 ratio* label in the ASCII head
   * and produced wall clocks like "30:20:36".
   */
  startClock: string | null;
  endClock: string | null;
  /** Always-valid seconds from the start of the recording. */
  startOffsetSec: number;
  endOffsetSec: number;
  /** Where the clock labels came from. */
  clockSource: "file_timestamp" | "relative_only";
  hr: TimeSeries;
  breathing: TimeSeries;
  annotations: string[];
}
interface MultiParameterGraphical {
  ecgAvailable: boolean;
  totalSec: number;
  phases: PhaseBoundary[];
  heartRateTrend: TimeSeries;
  breathingTrend: TimeSeries;
  lfaTrend: TimeSeries;
  rfaTrend: TimeSeries;
  scatter: {
    // null when the proprietary spectral aggregate is unavailable (raw
    // ECG-only .ans). The UI must render "Not assessed", never plot a 0.
    baselineLFa: number | null;
    baselineRFa: number | null;
    dbRFa: number | null;
    valsalvaLFa: number | null;
    standLFa: number | null;
    standRFa: number | null;
    rfaChangeValsalvaPct: number | null;
    rfaChangeStandPct: number | null;
  };
  coupling: CardioRespiratoryWindow[];
  wavelet: { type: string; cycles: number; spectralUpdateSec: number };
}

interface ANSReport {
  patientData: ParsedANSData;
  /**
   * `null` when `wellnessBreakdown.scorability.scorable` is false. A composite
   * score is NOT published when the ECG is unusable or an essential domain is
   * missing — no number, no tier, no "Optimal".
   */
  wellnessScore: number | null;
  wellnessTier: "Optimal" | "Resilient" | "Balanced" | "Stressed" | "Depleted" | "Critical" | null;
  wellnessBreakdown: WellnessBreakdown;
  riskLevel: string;
  energyLevel: "Low" | "Moderate" | "High";
  /**
   * True only when the proprietary spectral aggregates (LFa/RFa/SB) are
   * available at a clinically-usable provenance tier. For raw ECG-only .ans
   * files these are NOT vendor-reproducible, so this is false and every
   * spectral/adrenergic/neuropathy interpretation is gated OFF. HR + Ewing
   * ratios remain supported observations regardless.
   */
  spectralAvailable: boolean;
  /**
   * WHERE the spectral numbers in `phaseEvents` came from:
   *   - "vendor_reported"    — verbatim from the paired signed PDF (baseline A).
   *   - "humanos_estimated"  — computed generically from the waveform by
   *     `api/_ans/spectral.ts`. Displayable, chartable, and explicitly NOT
   *     vendor parity: `spectralAvailable` stays false so no clinical
   *     conclusion, pattern, therapy or composite score may use them.
   *   - "unavailable"        — neither source produced a value.
   */
  spectralSource: "vendor_reported" | "humanos_estimated" | "unavailable";
  /**
   * Uncertainty envelope for the waveform-derived estimates. Present whenever
   * `spectralSource === "humanos_estimated"`.
   */
  spectralEstimation: {
    present: boolean;
    method: "morlet_cwt_bpm2" | null;
    /** Best per-phase confidence (0..1). Never a clinical gate. */
    confidence: number | null;
    /** De-duplicated uncertainty reasons across phases. */
    warnings: string[];
    /** Mandatory provenance sentence every surface must show alongside a value. */
    disclosure: string;
  };
  bpAvailable: boolean;
  autonomicBalance: {
    // null when spectral aggregates are unavailable — the UI must render
    // "Not assessed", never coerce to 0 or a 0/100 percentage split.
    parasympathetic: number | null;
    sympathetic: number | null;
    balance: number | null;
    available: boolean;
    interpretation: string;
  };
  phaseEvents: PhaseMetrics[];
  /**
   * Ewing ratios. `value`/`classification` are null when the ratio was not
   * present in the file — never 0 (which would classify as severely abnormal).
   * `normal` always comes from the single authoritative age-specific reference
   * table (`ratioReferenceLabel`), so no surface can print a different band.
   */
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
  /**
   * Top-level respiratory frequency. Kept CONSISTENT with the per-phase FRF
   * values: previously this was null while six per-phase FRF values were
   * populated, so the same payload both denied and asserted the measure. It now
   * mirrors the baseline phase and always ships alongside `respiratory`, which
   * states the validation status explicitly.
   */
  respiratoryFrequency: number | null;
  /**
   * Explicit validation envelope for the respiratory estimate. An `estimated`
   * value is never presented as a measured fact by any surface.
   */
  respiratory: {
    frequencyHz: number | null;
    validation: "estimated" | "unavailable";
    note: string;
  };
  /**
   * ECG usability verdict that gated this report. Interpretation is suppressed
   * when `usable` is false.
   */
  ecgQuality?: LegacyEcgQuality;
  rPeakCount: number;
  /**
   * ENVELOPE METADATA — wall-clock time the report object was generated. This is
   * NON-DETERMINISTic (changes every run) and is NOT part of the clinical
   * content. It (and AnsStudy.parsedAt) MUST be excluded from any deterministic
   * clinical snapshot / golden-master comparison; use `clinicalSnapshot()`.
   */
  generatedAt: string;
  patientSynopsis?: string;
  clinicianSynopsis?: string;
  multiParameter?: MultiParameterGraphical;
  indications?: Indication[];
  /**
   * Present only when a paired vendor-PDF metrics payload was supplied but its
   * identity (patient name / study date / DOB) did NOT reconcile with the
   * uploaded .ans, so the vendor values were dropped. Surfaced so the UI can
   * warn the clinician that the PDF and the study appear to be different
   * patients/visits — never silently ignored.
   */
  vendorReconciliationWarnings?: string[];
  /**
   * Positive/negative reconciliation status for the paired vendor PDF. Drives
   * the "Vendor report matched" badge (status="matched") or a mismatch warning.
   * Absent when no vendor metrics were supplied.
   */
  vendorReconciliation?: VendorReconciliationStatus;
}

// ---- Multipart Parser -------------------------------------------------------

function parseMultipart(req: VercelRequest): Promise<{ buffer: Buffer; fileName?: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
      if (!boundaryMatch) {
        reject(new Error("No multipart boundary found"));
        return;
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const boundaryBuffer = Buffer.from(`--${boundary}`);

      let start = -1;
      let end = -1;
      let headerEnd = -1;

      for (let i = 0; i < body.length - boundaryBuffer.length; i++) {
        if (body.subarray(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
          if (start === -1) {
            start = i + boundaryBuffer.length + 2;
          } else {
            end = i - 2;
            break;
          }
        }
      }
      if (start === -1 || end === -1) {
        reject(new Error("Could not parse multipart data"));
        return;
      }
      const headerSection = body.subarray(start, Math.min(start + 1000, end));
      for (let i = 0; i < headerSection.length - 3; i++) {
        if (
          headerSection[i] === 0x0d &&
          headerSection[i + 1] === 0x0a &&
          headerSection[i + 2] === 0x0d &&
          headerSection[i + 3] === 0x0a
        ) {
          headerEnd = start + i + 4;
          break;
        }
      }
      if (headerEnd === -1) {
        reject(new Error("Could not find header end in multipart"));
        return;
      }
      // Extract filename from the Content-Disposition header within the part header section
      let fileName: string | undefined;
      try {
        const headerStr = body.subarray(start, headerEnd).toString("utf-8");
        const fnMatch = headerStr.match(/filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i);
        if (fnMatch) fileName = (fnMatch[1] || fnMatch[2] || "").trim();
      } catch { /* ignore */ }
      resolve({ buffer: body.subarray(headerEnd, end), fileName });
    });
    req.on("error", reject);
  });
}

// ---- ANS Binary File Parser -------------------------------------------------

/**
 * Parse a .ans file into the legacy ParsedANSData shape.
 *
 * SINGLE CANONICAL PATH: this now delegates to the deterministic,
 * provenance-gated engine in api/_ans (parseStudy + ansStudyToLegacy). The
 * previous hand-rolled heuristic parser — which carried a per-patient
 * `isJillShah` hardcode that fabricated Ewing ratios / BP / demographics, plus
 * `weight=150` / `heightInMeters=1.73` demographic defaults — has been removed.
 *
 * Everything the old parser produced from directly-verifiable source bytes
 * (identity, DOB, sex, physician, E/I / Valsalva / 30:15 ratios, ectopy note,
 * study date via LabVIEW timestamp or filename, full int16 ECG waveform) is
 * produced by the canonical engine with full per-field provenance and the
 * "missing stays missing" invariant. Missing values (weight, BMI, cuff BP)
 * stay absent rather than being defaulted.
 *
 * Kept as a thin exported wrapper because several tests import it directly.
 */
export function parseANSFile(buffer: Buffer, fileName?: string): ParsedANSData {
  const study = parseStudy({ buffer, fileName: fileName ?? "upload.ans" });
  return ansStudyToLegacy(study, buffer);
}

// ============================================================================
// STAGE 1 — ECG Signal Processing
// ============================================================================

/**
 * Adaptive Pan-Tompkins-inspired R-peak detector.
 * Uses adaptive threshold + 200ms refractory + quality filtering.
 * Returns {rPeakIndices, rPeakAmplitudes}.
 */
function detectRPeaks(ecg: number[], samplingRate: number): {
  indices: number[];
  amplitudes: number[];
  rrIntervalsMs: number[];
  /** Beats rejected because they sit on a sentinel/rail artifact. */
  rejectedArtifactBeats: number;
  /** R-R intervals discarded because an artifact fell inside them. */
  rejectedArtifactIntervals: number;
} {
  if (ecg.length < samplingRate * 2) {
    return {
      indices: [], amplitudes: [], rrIntervalsMs: [],
      rejectedArtifactBeats: 0, rejectedArtifactIntervals: 0,
    };
  }

  // Derivative + squaring (simple Pan-Tompkins feature)
  const feat = new Array(ecg.length).fill(0);
  for (let i = 2; i < ecg.length - 2; i++) {
    const d = (2 * ecg[i + 1] + ecg[i + 2] - ecg[i - 2] - 2 * ecg[i - 1]) / 8;
    feat[i] = d * d;
  }

  // Moving window integration (150ms)
  const winN = Math.max(5, Math.floor(samplingRate * 0.15));
  const integ = new Array(ecg.length).fill(0);
  let sum = 0;
  for (let i = 0; i < ecg.length; i++) {
    sum += feat[i];
    if (i >= winN) sum -= feat[i - winN];
    integ[i] = sum / winN;
  }

  // Adaptive threshold from sorted 97.5 percentile
  const sorted = [...integ].filter(v => v > 0).sort((a, b) => a - b);
  const thresh = sorted.length
    ? sorted[Math.floor(sorted.length * 0.975)] * 0.4
    : 0;

  const refractoryN = Math.floor(samplingRate * 0.25); // 250 ms
  const peaks: number[] = [];
  let lastPeak = -refractoryN;
  for (let i = 1; i < integ.length - 1; i++) {
    if (
      integ[i] > thresh &&
      integ[i] > integ[i - 1] &&
      integ[i] >= integ[i + 1] &&
      i - lastPeak > refractoryN
    ) {
      // Relocate to actual ECG peak within ±60ms
      const search = Math.floor(samplingRate * 0.06);
      let best = i;
      let bestVal = ecg[i];
      for (let j = Math.max(0, i - search); j < Math.min(ecg.length, i + search); j++) {
        if (ecg[j] > bestVal) { bestVal = ecg[j]; best = j; }
      }
      peaks.push(best);
      lastPeak = best;
    }
  }

  // ---- SENTINEL / RAIL ARTIFACT REJECTION ----------------------------------
  // Real exports contain ±31,8xx rail spikes. The detector happily locks onto
  // them (they are the largest "peaks" in the trace), which is what produced
  // per-phase RMSSD > SDNN in every phase and an inflated variability "reserve"
  // that drove 18.7 of a 91-point wellness score. A spike is not a beat: reject
  // any peak sitting on a sentinel sample, and discard any R-R interval that
  // spans a sentinel sample (its endpoints are then not consecutive real beats).
  // A beat is rejected only when the DETECTED PEAK SAMPLE ITSELF is clipped at
  // the rail. We deliberately do NOT reject a beat because a rail sample merely
  // lies nearby: in these exports a large negative rail deflection occurs once
  // per cardiac cycle (~230 samples apart at 250 Hz), so a ±60 ms neighbourhood
  // test rejected almost every beat and destroyed a legitimate, clinically
  // useful heart rate. The rail deflections are still kept out of the
  // variability metrics — a clipped peak has no trustworthy fiducial point, the
  // plausibility gate in `analyzePhase` rejects the resulting series, and the
  // parser marks the whole recording unusable (`sentinel_spikes`).
  const isArtifactIndex = (idx: number): boolean => isSentinelSample(ecg[idx]);
  const cleanPeaks: number[] = [];
  const rejectedPeaks: number[] = [];
  for (const p of peaks) {
    if (isArtifactIndex(p)) rejectedPeaks.push(p);
    else cleanPeaks.push(p);
  }
  const rejectedArtifactBeats = rejectedPeaks.length;

  const amplitudes = cleanPeaks.map(i => ecg[i]);
  const rrIntervalsMs: number[] = [];
  let rejectedArtifactIntervals = 0;
  for (let i = 1; i < cleanPeaks.length; i++) {
    const a = cleanPeaks[i - 1];
    const b = cleanPeaks[i];
    // Reject the interval only when a beat was ACTUALLY REMOVED between these
    // two peaks — the endpoints are then not consecutive beats and the interval
    // is a fiction. We deliberately do NOT reject every interval that merely
    // contains a sentinel sample somewhere: on real exports the rail spikes are
    // sprinkled through the trace and that rule discarded essentially every
    // interval, destroying a legitimate, clinically useful heart rate.
    const lostBeatInGap = rejectedPeaks.some((r) => r > a && r < b);
    if (lostBeatInGap) { rejectedArtifactIntervals++; continue; }
    const ms = ((b - a) / samplingRate) * 1000;
    if (ms > 300 && ms < 2000) rrIntervalsMs.push(ms);
  }

  return {
    indices: cleanPeaks, amplitudes, rrIntervalsMs,
    rejectedArtifactBeats, rejectedArtifactIntervals,
  };
}

// ============================================================================
// STAGE 2 — Morlet-style Continuous Wavelet Transform on RR intervals
// ============================================================================

// NOTE: The waveform spectral engine lives in `api/_ans/spectral.ts` and is
// imported above. Its predecessor's empirical `SCALE = 0.0018` multiplier —
// curve-fit to a single patient's report — is NOT restored and never will be;
// the engine normalises analytically instead. Waveform-derived LFa/RFa/SB carry
// `computed` + `validation: "estimated"` provenance: they are charted and
// labelled as HumanOS estimates, while `spectralAvailable` stays false so no
// clinical conclusion, dysfunction pattern, therapy line or composite score
// consumes them. Vendor-reported values still come exclusively from the signed
// PDF (OCR / x-vendor-metrics) with `vendor_reported` provenance and always
// outrank an estimate. FRF is derived from the RR/peak envelope as before.

// ============================================================================
// STAGE 4 — Phase Segmentation (6 phases: A B C D E F)
// ============================================================================

/**
 * Colombo protocol is a 6-phase test:
 *   A Baseline      5:00
 *   B Deep Breathing 1:00
 *   C Baseline      1:00
 *   D Valsalva      1:35
 *   E Baseline      2:30
 *   F Stand         5:30
 * Total ≈ 16:35, matching Jill Shah's recording duration.
 *
 * Because the .ans file doesn't include phase markers, we segment by
 * timestamp using the standard protocol fractions.
 */
function segmentPhases(totalSec: number): { start: number; end: number; name: PhaseMetrics["phase"]; label: string }[] {
  const proto = [
    { name: "Baseline-A" as const, label: "Baseline", dur: 300 },
    { name: "DeepBreathing-B" as const, label: "Deep Breathing", dur: 60 },
    { name: "Baseline-C" as const, label: "Baseline", dur: 60 },
    { name: "Valsalva-D" as const, label: "Valsalva", dur: 95 },
    { name: "Baseline-E" as const, label: "Baseline", dur: 150 },
    { name: "Stand-F" as const, label: "Stand", dur: 330 },
  ];
  const protoTotal = proto.reduce((a, p) => a + p.dur, 0);
  const scale = totalSec / protoTotal;
  const segments: { start: number; end: number; name: PhaseMetrics["phase"]; label: string }[] = [];
  let t = 0;
  for (const p of proto) {
    const dur = p.dur * scale;
    segments.push({ start: t, end: t + dur, name: p.name, label: p.label });
    t += dur;
  }
  return segments;
}

function analyzePhase(
  ecgPhase: number[],
  samplingRate: number,
  phaseName: PhaseMetrics["phase"],
  label: string,
  durationSec: number
): PhaseMetrics {
  const { indices, amplitudes, rrIntervalsMs, rejectedArtifactBeats, rejectedArtifactIntervals } =
    detectRPeaks(ecgPhase, samplingRate);
  if (rrIntervalsMs.length < 4) {
    // Not enough usable beats to compute anything for this phase. Every metric
    // is NULL — never 0. A 0 bpm heart rate / 0 ms variability is a sentinel a
    // clinician or a downstream score would read as a real, extreme value.
    const unavail = {
      LFa: unavailableProvenance("LFa", "Fewer than 4 usable beats in this phase."),
      RFa: unavailableProvenance("RFa", "Fewer than 4 usable beats in this phase."),
      SB: unavailableProvenance("SB", "Fewer than 4 usable beats in this phase."),
      FRF: unavailableProvenance("FRF", "Fewer than 4 usable beats in this phase."),
    };
    return {
      phase: phaseName, label,
      duration: formatDuration(durationSec), durationSec,
      meanHR: null, rangeHR: null, FRF: null, LFa: null, RFa: null, SB: null,
      hrvOverallVariabilityMs: null, hrvBeatToBeatMs: null,
      hrvOverallVariabilityRawMs: null, hrvBeatToBeatRawMs: null,
      hrvReliable: false,
      hrvUnreliableReasons: [
        `Fewer than 4 usable R-R intervals in this phase` +
          (rejectedArtifactBeats + rejectedArtifactIntervals > 0
            ? ` after rejecting ${rejectedArtifactBeats} artifact beat(s) and ` +
              `${rejectedArtifactIntervals} artifact-spanning interval(s)`
            : "") + ".",
      ],
      provenance: unavail,
    };
  }
  const meanRR = rrIntervalsMs.reduce((a, b) => a + b, 0) / rrIntervalsMs.length;
  const meanHR = Math.round(60000 / meanRR);

  // Per-peak instantaneous HR range
  const hrs = rrIntervalsMs.map(rr => 60000 / rr);
  const rangeHR = Math.round(Math.max(...hrs) - Math.min(...hrs));

  // SDNN + RMSSD
  const sdnn = Math.sqrt(rrIntervalsMs.reduce((s, rr) => s + (rr - meanRR) ** 2, 0) / (rrIntervalsMs.length - 1));
  let ssd = 0;
  for (let i = 1; i < rrIntervalsMs.length; i++) ssd += (rrIntervalsMs[i] - rrIntervalsMs[i - 1]) ** 2;
  const rmssd = Math.sqrt(ssd / (rrIntervalsMs.length - 1));

  // ---- SIGNAL-QUALITY GATE on the variability metrics -----------------------
  // REPLACES the removed "RMSSD > SDNN is physiologically impossible" rule.
  // That rule was wrong: RMSSD/SDNN = sqrt(2*(1 - r1)), so beat-to-beat
  // variability exceeds overall variability for ANY series whose lag-1
  // autocorrelation is below 0.5 — routine in respiratory-dominant rhythms,
  // during paced deep breathing, in young/athletic subjects, and in short
  // detrended segments. The real ceiling is a ratio of 2 (perfect alternation).
  // `assessRrQuality` (api/_ans/signalQuality.ts) now decides reliability from
  // measurable defects instead: non-physiologic intervals, ectopic/mis-detected
  // intervals against a local median, clipped (rail-saturated) fiducial points,
  // and near-limit alternation corroborated by a measured alternation rate.
  const quality = assessRrQuality(rrIntervalsMs, {
    clippedFiducialBeats: rejectedArtifactBeats,
    artifactSpanningIntervals: rejectedArtifactIntervals,
    detectedBeats: indices.length + rejectedArtifactBeats,
  });
  const hrvUnreliableReasons = [...quality.reasons];
  const hrvReliable = quality.reliable;

  // Respiratory frequency for THIS phase (derived from the RR/peak envelope —
  // this is a genuine time-domain measure, not a proprietary spectral aggregate).
  const frf = estimateRespiratoryFrequencyFromPeaks(indices, amplitudes, samplingRate);

  // --- WAVEFORM-DERIVED SPECTRAL ESTIMATE (restored generic engine) ----------
  // LFa / RFa / SB are computed generically from THIS phase's R-R series by
  // `api/_ans/spectral.ts`: instantaneous heart rate in bpm, resampled to 4 Hz,
  // linearly detrended, Morlet CWT band power with an analytic (parameter-free)
  // normalisation, over respiration-adaptive band edges. There is NO empirical
  // output multiplier — the removed `SCALE = 0.0018` had been curve-fit to a
  // single patient's report, which is why it (and, wrongly, the whole engine)
  // was deleted. Nothing here reads a patient name, a filename, demographics,
  // BP, a vendor value or a fingerprint.
  //
  // PROVENANCE: `computed` + `validation: "estimated"`. `mayInterpretClinically`
  // is therefore FALSE for these values, so they cannot drive a diagnosis,
  // pattern, therapy recommendation or composite score — they are published as
  // clearly-labelled HumanOS estimates with an uncertainty envelope. They are
  // NOT vendor-reported and are NOT claimed to reproduce PhysioPS output.
  const est = estimatePhaseSpectral({
    rrIntervalsMs,
    respFreqHz: frf,
    rejectedArtifactBeats,
    rejectedArtifactIntervals,
    signalQualityFailed: !hrvReliable,
    // Generic protocol property, not a patient-specific input: sub-0.15 Hz
    // respiration is EXPECTED during the paced deep-breathing manoeuvre.
    pacedBreathing: phaseName === "DeepBreathing-B",
  });

  const spectralImpossibleNote =
    "Waveform-derived estimate could not be computed for this phase: " +
    (est.warnings[0] ?? "insufficient usable R-R data.") +
    " A vendor-reported value, if any, is available only in the signed PDF.";

  return {
    phase: phaseName, label,
    duration: formatDuration(durationSec), durationSec,
    meanHR, rangeHR,
    FRF: frf == null ? null : Math.round(frf * 100) / 100,
    LFa: est.lfa,
    RFa: est.rfa,
    SB: est.sb,
    spectralEstimate: {
      confidence: est.confidence,
      warnings: est.warnings,
      bands: est.bands,
      beats: est.beats,
      method: "morlet_cwt_bpm2",
    },
    // Scoring-facing variability: suppressed for an implausible series.
    hrvOverallVariabilityMs: hrvReliable ? Math.round(sdnn * 10) / 10 : null,
    hrvBeatToBeatMs: hrvReliable ? Math.round(rmssd * 10) / 10 : null,
    // Chart-facing variability: always the measured number, carrying
    // `hrvReliable=false` + reasons so the surface can label the uncertainty
    // instead of erasing a real measurement.
    hrvOverallVariabilityRawMs: Math.round(sdnn * 10) / 10,
    hrvBeatToBeatRawMs: Math.round(rmssd * 10) / 10,
    hrvReliable,
    hrvUnreliableReasons,
    // Measured signal-quality evidence behind `hrvReliable`, published so a
    // clinician can see WHY a phase was accepted or withheld. `rmssdSdnnRatio`
    // above 1 is normal (it means lag-1 autocorrelation below 0.5) and is NOT
    // by itself a defect.
    hrvQuality: quality.metrics,
    hrvRatioPhysiologicNote: highRatioIsPhysiologic(quality.metrics)
      ? `Beat-to-beat variability exceeds overall variability (ratio ` +
        `${quality.metrics.rmssdSdnnRatio!.toFixed(2)}, implied lag-1 autocorrelation ` +
        `${quality.metrics.lag1Autocorr!.toFixed(2)}). This is an ordinary consequence of a ` +
        `respiration-dominated rhythm, not an artifact; the ratio only approaches its ` +
        `mathematical ceiling of 2 above ${NEAR_LIMIT_RATIO}.`
      : null,
    provenance: {
      LFa: est.lfa == null
        ? unavailableProvenance("LFa", spectralImpossibleNote)
        : computedProvenance("LFa", { note: ESTIMATED_SPECTRAL_NOTE }),
      RFa: est.rfa == null
        ? unavailableProvenance("RFa", spectralImpossibleNote)
        : computedProvenance("RFa", { note: ESTIMATED_SPECTRAL_NOTE }),
      SB: est.sb == null
        ? unavailableProvenance("SB", spectralImpossibleNote)
        : computedProvenance("SB", { note: ESTIMATED_SB_NOTE }),
      FRF: frf == null
        ? unavailableProvenance("FRF", "Respiratory envelope too short to estimate a fundamental respiratory frequency.")
        : computedProvenance("FRF", { note: ESTIMATED_FRF_NOTE }),
    },
  };
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================================
// STAGE 5 — Age-Continuous Normative Percentiles (P10/P90)
// ============================================================================

/**
 * Age-continuous P10/P90 normal ranges from Agelink & Gelber aggregated curves.
 * Returns { lo, hi } for a given parameter at a given age.
 */
// Age-continuous P10/P90 normal ranges now live in the single source of truth,
// shared/colomboNorms.ts (`ageContinuousNorm`). This thin alias keeps the many
// call sites below readable.
const norm = ageContinuousNorm;

function classify(value: number, lo: number, hi: number, lowBorderMargin = 0.15, highBorderMargin = 0.15): Classification {
  const borderlineLow = lo * (1 + lowBorderMargin);
  const borderlineHigh = hi * (1 - highBorderMargin);
  let label: Classification["label"];
  let severity: Classification["severity"];
  if (value < lo) { label = "Low"; severity = "Abnormal"; }
  else if (value < borderlineLow) { label = "Borderline Low"; severity = "Warning"; }
  else if (value <= borderlineHigh) { label = "Normal"; severity = "Normal"; }
  else if (value <= hi) { label = "Borderline High"; severity = "Warning"; }
  else { label = "High"; severity = "Abnormal"; }
  return { label, severity, value, lo, hi };
}

/**
 * Per-phase-safe classification. Returns null when the value is null/undefined/
 * non-finite/≤0 (i.e. the proprietary spectral aggregate for THIS phase was not
 * captured), so a missing value can never be coerced to 0 and classified as
 * "Low"/"Abnormal". This is the guard for the baseline-only vendor case, where
 * the GLOBAL spectralAvailable gate is true (baseline A was vendor-reported) but
 * phases B–F still carry null spectral — classifying those nulls fabricated
 * Low/Abnormal Valsalva/stand responses and a spurious "advanced autonomic
 * dysfunction" impression.
 */
function classifyOrNull(
  value: number | null | undefined,
  lo: number,
  hi: number,
  lowBorderMargin = 0.15,
  highBorderMargin = 0.15,
): Classification | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return classify(value, lo, hi, lowBorderMargin, highBorderMargin);
}

// ============================================================================
// STAGE 6 — Continuous Wellness Score (5-factor, age-normalized)
// ============================================================================

function bandScore(value: number, lo: number, hi: number): number {
  if (!isFinite(value) || value <= 0) return 0;
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  if (half <= 0) return 0;
  const offset = Math.abs(value - mid) / half;
  if (offset <= 1) return Math.round((100 - 30 * offset * offset) * 10) / 10;
  const overshoot = offset - 1;
  return Math.max(0, Math.round(70 * Math.exp(-1.2 * overshoot) * 10) / 10);
}

function thresholdScore(value: number, lo: number, hi: number): number {
  if (!isFinite(value) || value <= 0) return 0;
  if (value >= hi) return 100;
  if (value <= lo) return 0;
  return Math.round(((value - lo) / (hi - lo)) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Wellness Score v2 — Colombo-accurate bands, structured drivers, pattern penalties
// ---------------------------------------------------------------------------
// Design principles:
//   1. Every sub-score emits an explicit list of signed "drivers" in score·weight
//      space so the UI can show "Jill's score is 58 because: ↓ SB 0.18 cost 6pts,
//      ↓ bradycardia cost 4pts, ↑ E/I 1.21 added 5pts, …".
//   2. Sub-score band functions use a *signed severity* curve that penalizes
//      each standard-deviation-of-band more aggressively than the old symmetric
//      quadratic, so SB=0.18 (55% below lower bound) scores ~20, not 57.
//   3. After the 5-factor composite we apply a pattern-penalty layer: each
//      detected dysfunction pattern subtracts a fixed severity weight directly
//      from the final (with diminishing returns). This is the biggest gap the
//      v1 model had — it computed only from phase metrics and didn't know that
//      the clinician side had flagged e.g. "Parasympathetic Excess on stand".
//   4. Floor raised from 15 to 10; ceiling of 98 for mild-imbalance cases so
//      "Optimal" (90+) is reserved for patients with zero abnormal flags.

function signedBandScore(value: number, lo: number, hi: number, opts?: { lowPenalty?: number; highPenalty?: number }): number {
  // Returns 0–100. Steeper than v1: 100 at mid, 80 at band edge, ~40 at 1 sd
  // outside band, ~15 at 2 sd outside. lowPenalty/highPenalty optionally make
  // one side harsher (e.g. SB low is a bigger red flag than SB high).
  if (!isFinite(value) || value <= 0) return 0;
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  if (half <= 0) return 0;
  const rawOffset = (value - mid) / half;
  const direction = rawOffset < 0 ? (opts?.lowPenalty ?? 1.0) : (opts?.highPenalty ?? 1.0);
  const offset = Math.abs(rawOffset) * direction;
  if (offset <= 1) return Math.round((100 - 20 * offset * offset) * 10) / 10; // 100 at center, 80 at edge
  // outside band: exponential decay from 80 — harsher than v1
  const overshoot = offset - 1;
  return Math.max(0, Math.round(80 * Math.exp(-0.9 * overshoot) * 10) / 10);
}

function thresholdScoreV2(value: number, criticalLo: number, normalLo: number): number {
  // Ewing ratios: below criticalLo is abnormal, criticalLo–normalLo is
  // borderline, above normalLo is normal. Scores 0–100 with a sigmoid.
  if (!isFinite(value) || value <= 0) return 0;
  if (value >= normalLo) return 100;
  if (value <= criticalLo) return Math.max(0, 40 * (value / criticalLo));
  // between critical and normal — linear 40→100
  return Math.round((40 + ((value - criticalLo) / (normalLo - criticalLo)) * 60) * 10) / 10;
}

function severityOf(score: number): WellnessDriver["severity"] {
  if (score >= 85) return "positive";
  if (score >= 70) return "neutral";
  if (score >= 50) return "mild";
  if (score >= 30) return "moderate";
  return "severe";
}

function mkDriver(label: string, value: string, subScoreOutOf100: number, weightInFinal: number): WellnessDriver {
  // points = how many points of the *final 100* this driver contributes or costs,
  // relative to a 70/100 "neutral/expected" reference. Above 70 adds; below 70 drags.
  const centered = subScoreOutOf100 - 70;   // +30 max upside, −70 max downside
  const points = Math.round(centered * weightInFinal * 10) / 10;
  return { label, value, points, severity: severityOf(subScoreOutOf100) };
}

// Pattern penalty weights (points subtracted from final score, cumulative w/ diminishing returns)
const PATTERN_PENALTIES: Record<keyof DysfunctionPatterns, { points: number; label: string }> = {
  advancedAutonomicDysfunction: { points: 22, label: "Advanced Autonomic Dysfunction (AAD/DAN)" },
  CAN:                          { points: 20, label: "Cardiovascular Autonomic Neuropathy" },
  POTS:                         { points: 14, label: "Postural Orthostatic Tachycardia Syndrome" },
  orthostaticHypotension:       { points: 12, label: "Orthostatic Hypotension" },
  preSyncopeRisk:               { points: 10, label: "Pre-syncope risk" },
  parasympatheticExcess:        { points:  8, label: "Parasympathetic Excess on standing" },
  parasympatheticWithdrawal:    { points:  8, label: "Parasympathetic Withdrawal" },
  sympatheticExcess:            { points:  7, label: "Sympathetic Excess" },
  sympatheticWithdrawal:        { points:  7, label: "Sympathetic Withdrawal" },
  maskedSW:                     { points:  6, label: "Masked Sympathetic Withdrawal" },
  parasympatheticDominance:     { points:  6, label: "Parasympathetic Dominance at rest" },
  vasovagalRisk:                { points:  5, label: "Vasovagal risk" },
  bradycardia:                  { points:  4, label: "Bradycardia (low resting HR)" },
  highFRF:                      { points:  3, label: "High respiratory frequency during DB" },
};

function computeWellness(
  patient: ParsedANSData,
  phases: PhaseMetrics[],
  patterns?: DysfunctionPatterns,
): WellnessBreakdown {
  const age = patient.age;
  const ecgUsable = patient.ecgQuality ? patient.ecgQuality.usable : true;
  const A = phases[0]; // Baseline A
  const B = phases[1]; // DB
  const F = phases[5]; // Stand

  // Spectral aggregates (LFa/RFa/SB) are only present when the paired vendor PDF
  // supplied them (vendor_reported). For raw ECG-only .ans files they are null
  // and every sub-score component that depends on them is UNAVAILABLE.
  //
  // CRITICAL CHANGE: unavailable components/domains are NO LONGER renormalized
  // away. They contribute ZERO out of their full nominal weight, so missing data
  // can only ever LOWER the composite. Renormalizing let the absence of the one
  // domain the vendor flagged as abnormal silently RAISE the number to 91 /
  // "Optimal". Any unavailable domain also makes the result NOT SCORABLE, so the
  // depressed composite is never published as a score either — it exists only as
  // an internal audit figure inside the breakdown.
  const aRFa = A.RFa, aLFa = A.LFa, aSB = A.SB;
  const bRFa = B.RFa;
  const fRFa = F.RFa, fLFa = F.LFa, fSB = F.SB;

  const RFa_n = norm("RFa", age);
  const LFa_n = norm("LFa", age);
  const HR_n  = norm("HR", age);
  const SB_n  = norm("SB", age);
  const EI_n  = norm("EI", age);
  const Val_n = norm("Valsalva", age);
  const Tf_n  = norm("ThirtyFifteen", age);

  const W = { baseline: 0.22, sb: 0.20, reflex: 0.23, ortho: 0.20, hrv: 0.15 };

  // A weighted component that may be unavailable (null input). `combineComponents`
  // computes the weighted average over AVAILABLE components only, renormalizing
  // their nominal weights, and returns availability + the drivers to display.
  interface WComp {
    label: string;
    value: string;
    score: number;
    nominalWeight: number; // within-subscore fraction (sums to 1 across the group)
    available: boolean;
  }
  function combineComponents(subWeight: number, comps: WComp[]): {
    score: number | null;
    available: boolean;
    /** True when at least one component of this sub-score was unavailable. */
    partial: boolean;
    missing: string[];
    drivers: WellnessDriver[];
  } {
    const avail = comps.filter((c) => c.available);
    const missing = comps.filter((c) => !c.available).map((c) => c.label);
    if (avail.length === 0) {
      return { score: null, available: false, partial: true, missing, drivers: [] };
    }
    // Weighted over the FULL nominal weight set (missing components score 0).
    // No renormalization: absence cannot raise the sub-score.
    const wSumAll = comps.reduce((s, c) => s + c.nominalWeight, 0) || 1;
    const score =
      Math.round(avail.reduce((s, c) => s + c.score * (c.nominalWeight / wSumAll), 0) * 10) / 10;
    const drivers = avail.map((c) =>
      mkDriver(c.label, c.value, c.score, subWeight * (c.nominalWeight / wSumAll)),
    );
    return { score, available: true, partial: missing.length > 0, missing, drivers };
  }

  // ---- 1. Baseline Autonomic Tone (RFa/LFa spectral + resting HR) ----
  const hrKnown = A.meanHR != null && A.meanHR > 0;
  const baselineHR = hrKnown
    ? signedBandScore(A.meanHR as number, HR_n.lo, HR_n.hi, { lowPenalty: 1.4, highPenalty: 1.1 })
    : 0;
  const c1 = combineComponents(W.baseline, [
    { label: `Resting RFa (parasympathetic)`, value: aRFa == null ? "Not assessed" : `${aRFa}`,
      score: aRFa == null ? 0 : signedBandScore(aRFa, RFa_n.lo, RFa_n.hi, { lowPenalty: 1.2 }), nominalWeight: 0.40, available: aRFa != null },
    { label: `Resting LFa (sympathetic)`, value: aLFa == null ? "Not assessed" : `${aLFa}`,
      score: aLFa == null ? 0 : signedBandScore(aLFa, LFa_n.lo, LFa_n.hi, { lowPenalty: 1.2 }), nominalWeight: 0.35, available: aLFa != null },
    { label: `Resting heart rate`, value: hrKnown ? `${A.meanHR} bpm` : "Not assessed",
      score: baselineHR, nominalWeight: 0.25, available: hrKnown },
  ]);
  const s1 = c1.score;
  const s1Drivers = c1.drivers;

  // ---- 2. Sympathovagal Balance (entirely spectral) ----
  const sbShift = aSB != null && fSB != null ? fSB - aSB : null;
  let sbShiftScore = 0;
  if (sbShift != null) {
    if (sbShift < -0.5) sbShiftScore = Math.max(10, 40 + sbShift * 25);
    else if (sbShift < 0) sbShiftScore = 60;
    else if (sbShift <= 2.0) sbShiftScore = 100;
    else if (sbShift <= 4.0) sbShiftScore = Math.max(40, 100 - (sbShift - 2.0) * 20);
    else sbShiftScore = Math.max(20, 60 - (sbShift - 4.0) * 8);
    sbShiftScore = Math.round(sbShiftScore * 10) / 10;
  }
  const c2 = combineComponents(W.sb, [
    { label: `Resting sympathovagal balance`, value: aSB == null ? "Not assessed" : `SB = ${aSB}`,
      score: aSB == null ? 0 : signedBandScore(aSB, SB_n.lo, SB_n.hi, { lowPenalty: 1.5, highPenalty: 1.2 }), nominalWeight: 0.45, available: aSB != null },
    { label: `Standing sympathovagal balance`, value: fSB == null ? "Not assessed" : `SB = ${fSB}`,
      score: fSB == null ? 0 : signedBandScore(fSB, SB_n.lo, SB_n.hi * 1.3, { lowPenalty: 1.2, highPenalty: 1.0 }), nominalWeight: 0.30, available: fSB != null },
    { label: `SB shift from rest to stand`, value: sbShift == null ? "Not assessed" : `${sbShift >= 0 ? "+" : ""}${Math.round(sbShift * 100) / 100}`,
      score: sbShiftScore, nominalWeight: 0.25, available: sbShift != null },
  ]);
  const s2 = c2.score;
  const s2Drivers = c2.drivers;

  // ---- 3. Reflex Integrity (Ewing battery) ----
  // Ratios may be null (not present in the file). A null ratio is NOT scored as
  // 0 — that would read as a profoundly abnormal reflex. It is unavailable.
  const eiScore  = patient.eiRatio == null ? 0
    : thresholdScoreV2(patient.eiRatio, EI_n.lo * 0.85, EI_n.lo);
  const valScore = patient.valsalvaRatio == null ? 0
    : thresholdScoreV2(patient.valsalvaRatio, Val_n.lo * 0.85, Val_n.lo);
  const tfScore  = patient.thirtyFifteenRatio == null ? 0
    : thresholdScoreV2(patient.thirtyFifteenRatio, Tf_n.lo * 0.85, Tf_n.lo);
  const dbRFaGain = aRFa != null && bRFa != null && aRFa > 0 ? bRFa / aRFa : null;
  let dbGainScore = 0;
  if (dbRFaGain != null) {
    if (dbRFaGain >= 1.3) dbGainScore = 100;
    else if (dbRFaGain >= 1.0) dbGainScore = 60 + (dbRFaGain - 1.0) * 133;
    else if (dbRFaGain >= 0.7) dbGainScore = 20 + (dbRFaGain - 0.7) * 133;
    else dbGainScore = Math.max(5, 20 * (dbRFaGain / 0.7));
    dbGainScore = Math.round(dbGainScore * 10) / 10;
  }
  const c3 = combineComponents(W.reflex, [
    { label: `E/I ratio (deep-breathing vagal)`, value: patient.eiRatio == null ? "Not assessed" : `${patient.eiRatio}`,
      score: eiScore, nominalWeight: 0.30, available: patient.eiRatio != null },
    { label: `Valsalva ratio`, value: patient.valsalvaRatio == null ? "Not assessed" : `${patient.valsalvaRatio}`,
      score: valScore, nominalWeight: 0.30, available: patient.valsalvaRatio != null },
    { label: `30:15 ratio (standing baroreflex)`, value: patient.thirtyFifteenRatio == null ? "Not assessed" : `${patient.thirtyFifteenRatio}`,
      score: tfScore, nominalWeight: 0.25, available: patient.thirtyFifteenRatio != null },
    { label: `DB RFa gain (vagal augmentation)`, value: dbRFaGain == null ? "Not assessed" : `${Math.round(dbRFaGain * 100) / 100}×`,
      score: dbGainScore, nominalWeight: 0.15, available: dbRFaGain != null },
  ]);
  const s3 = c3.score;
  const s3Drivers = c3.drivers;

  // ---- 4. Orthostatic Response (HR delta always measured; LFa/RFa spectral) ----
  // ΔHR uses the SINGLE canonical definition shared with the parse payload and
  // the diagnostic summary (`standDeltaBpm`), so the report can no longer say
  // "+9 bpm" while another payload in the same response says "ΔHR = 8 bpm".
  const hrDelta = standDeltaBpm(A.meanHR, F.meanHR);
  let hrDeltaScore = 0;
  if (hrDelta != null) {
    if (hrDelta < 0) hrDeltaScore = 20;               // HR drop on stand = chronotropic failure
    else if (hrDelta < 5) hrDeltaScore = 40;
    else if (hrDelta < 10) hrDeltaScore = 75;
    else if (hrDelta <= 20) hrDeltaScore = 100;
    else if (hrDelta <= 30) hrDeltaScore = Math.max(55, 100 - (hrDelta - 20) * 4.5);
    else hrDeltaScore = Math.max(10, 55 - (hrDelta - 30) * 3.5);   // POTS territory
    hrDeltaScore = Math.round(hrDeltaScore * 10) / 10;
  }
  const standLFaGain = aLFa != null && fLFa != null && aLFa > 0 ? fLFa / aLFa : null;
  let standLFaGainScore = 0;
  if (standLFaGain != null) {
    if (standLFaGain >= 1.4) standLFaGainScore = 100;
    else if (standLFaGain >= 1.1) standLFaGainScore = 60 + (standLFaGain - 1.1) * 133;
    else if (standLFaGain >= 0.8) standLFaGainScore = 25 + (standLFaGain - 0.8) * 117;
    else standLFaGainScore = Math.max(5, 25 * (standLFaGain / 0.8));
    standLFaGainScore = Math.round(standLFaGainScore * 10) / 10;
  }
  const c4 = combineComponents(W.ortho, [
    { label: `HR response to stand`, value: hrDelta == null ? "Not assessed" : `Δ${hrDelta >= 0 ? "+" : ""}${hrDelta} bpm`,
      score: hrDeltaScore, nominalWeight: 0.35, available: hrDelta != null },
    { label: `Standing LFa (sympathetic)`, value: fLFa == null ? "Not assessed" : `${fLFa}`,
      score: fLFa == null ? 0 : signedBandScore(fLFa, LFa_n.lo, LFa_n.hi * 1.4, { lowPenalty: 1.2 }), nominalWeight: 0.25, available: fLFa != null },
    { label: `Standing LFa gain`, value: standLFaGain == null ? "Not assessed" : `${Math.round(standLFaGain * 100) / 100}×`,
      score: standLFaGainScore, nominalWeight: 0.25, available: standLFaGain != null },
    { label: `Standing RFa (parasympathetic)`, value: fRFa == null ? "Not assessed" : `${fRFa}`,
      score: fRFa == null ? 0 : signedBandScore(fRFa, RFa_n.lo * 0.5, RFa_n.hi, { highPenalty: 1.2 }), nominalWeight: 0.15, available: fRFa != null },
  ]);
  const s4 = c4.score;
  const s4Drivers = c4.drivers;

  // ---- 5. Heart-rhythm variability reserve ----------------------------------
  // Only phases whose beat series passed the artifact/plausibility gate are used.
  // The audit's inflated "112.9 ms vs 45 ms expected" reserve was computed from
  // series in which beat-to-beat variability exceeded overall variability in
  // every phase — an R-peak artifact — and it was a POSITIVE driver of the 91.
  const expectedSDNN = age < 36 ? 55 : age < 56 ? 45 : 35;
  const reliableVars = phases
    .map((p) => p.hrvOverallVariabilityMs)
    .filter((v): v is number => v != null);
  const hrvAssessable = reliableVars.length >= 2;
  let s5: number | null = null;
  let s5Drivers: WellnessDriver[] = [];
  let avgSDNN: number | null = null;
  let sdnnSpread: number | null = null;
  if (hrvAssessable) {
    avgSDNN = reliableVars.reduce((s, v) => s + v, 0) / reliableVars.length;
    let sdnnScore = avgSDNN >= expectedSDNN
      ? Math.min(100, 100 + (avgSDNN - expectedSDNN) * 0.25)
      : Math.max(10, 100 * Math.pow(avgSDNN / expectedSDNN, 0.8));
    sdnnScore = Math.round(sdnnScore * 10) / 10;
    sdnnSpread = Math.max(...reliableVars) - Math.min(...reliableVars);
    const spreadScore = sdnnSpread < 5 ? 40 : sdnnSpread > 60 ? 65 : Math.min(100, 40 + sdnnSpread * 1.5);
    s5 = Math.round((sdnnScore * 0.70 + spreadScore * 0.30) * 10) / 10;
    s5Drivers = [
      // AUTHORIZED PhysioPS OUTPUT PROTOCOL: these driver labels are rendered in
      // the PATIENT wellness breakdown, so they must not name the HRV-specific
      // parameter. Calculation, weight and score are unchanged.
      mkDriver(`Heart-rhythm variability reserve`, `${Math.round(avgSDNN * 10) / 10} ms vs ${expectedSDNN} ms expected for age`, sdnnScore, W.hrv * 0.70),
      mkDriver(`Heart-rhythm variability dynamic range`, `${Math.round(sdnnSpread * 10) / 10} ms spread across the test`, spreadScore, W.hrv * 0.30),
    ];
  }

  // ---- Composite over the FULL nominal weight set (no renormalization) ------
  const subScores: Array<{ key: string; label: string; score: number | null; weight: number; available: boolean; partial: boolean; missing: string[] }> = [
    { key: "baselineAutonomic", label: "Baseline autonomic tone", score: s1, weight: W.baseline, available: c1.available, partial: c1.partial, missing: c1.missing },
    { key: "sympathovagalBalance", label: "Sympathovagal balance", score: s2, weight: W.sb, available: c2.available, partial: c2.partial, missing: c2.missing },
    { key: "reflexIntegrity", label: "Reflex integrity", score: s3, weight: W.reflex, available: c3.available, partial: c3.partial, missing: c3.missing },
    { key: "orthostaticResponse", label: "Orthostatic response", score: s4, weight: W.ortho, available: c4.available, partial: c4.partial, missing: c4.missing },
    { key: "hrvReserve", label: "Heart-rhythm variability reserve", score: s5, weight: W.hrv, available: hrvAssessable, partial: !hrvAssessable, missing: hrvAssessable ? [] : ["Heart-rhythm variability (artifact/insufficient beats)"] },
  ];
  const nominalWeightSum = subScores.reduce((s, x) => s + x.weight, 0) || 1;
  const unavailableWeight =
    Math.round(
      (subScores.filter((s) => !s.available).reduce((s, x) => s + x.weight, 0) / nominalWeightSum) * 1000,
    ) / 1000;
  const rawTotal =
    Math.round(
      subScores.reduce((s, x) => s + (x.score ?? 0) * (x.weight / nominalWeightSum), 0) * 10,
    ) / 10;
  const ageMul = age < 36 ? 1.00 : age < 56 ? 1.03 : 1.06;
  const ageAdjusted = Math.round(rawTotal * ageMul * 10) / 10;

  // ---- Pattern penalty layer ----
  const patternDrivers: WellnessDriver[] = [];
  let patternPenaltyTotal = 0;
  if (patterns) {
    // Only patterns affirmatively PRESENT (=== true) penalize. `null` means "not
    // assessable" and must neither penalize nor be read as absent.
    const detected = presentPatterns(patterns)
      .map((k) => ({ key: k, ...PATTERN_PENALTIES[k] }))
      .sort((a, b) => b.points - a.points);
    for (let i = 0; i < detected.length; i++) {
      const decay = Math.pow(0.75, i); // 1st at 100%, 2nd at 75%, 3rd at 56%, …
      const pts = Math.round(detected[i].points * decay * 10) / 10;
      patternPenaltyTotal += pts;
      patternDrivers.push({
        label: detected[i].label,
        value: "detected",
        points: -pts,
        severity: detected[i].points >= 12 ? "severe" : detected[i].points >= 7 ? "moderate" : "mild",
      });
    }
  }

  // ---- Ectopic penalty ----
  const ectopicPenalty = patient.ectopicBeats > 10
    ? Math.min(8, Math.log2(patient.ectopicBeats) * 1.2)
    : patient.ectopicBeats > 0 ? 0.5 : 0;

  const provisionalFinal = Math.max(10, Math.min(100, Math.round((ageAdjusted - patternPenaltyTotal - ectopicPenalty) * 10) / 10));

  // ---- SCORABILITY GATE ----------------------------------------------------
  // A composite is published ONLY when the recording is usable, the variability
  // reserve is trustworthy, every scored domain had at least one measured input,
  // and no clinical pattern is left unassessable. Otherwise no number, no tier.
  const blockers: ScorabilityBlocker[] = [];
  if (!ecgUsable) {
    const reasons = patient.ecgQuality?.warnings ?? [];
    blockers.push({
      code: "ECG_UNUSABLE",
      message:
        "The ECG recording did not pass the signal-usability gate" +
        (reasons.length ? `: ${reasons.join(" ")}` : ".") +
        " Every metric derived from the waveform is therefore an observation to be confirmed, not a graded result.",
      domains: ["all"],
    });
  }
  if (!hrvAssessable) {
    blockers.push({
      code: "ECG_ARTIFACT_HRV_UNRELIABLE",
      message:
        "Heart-rhythm variability could not be measured reliably (artifact or too few clean beats), " +
        "so the variability-reserve domain of the score has no input.",
      domains: ["hrvReserve"],
    });
  }
  const missingDomains = subScores.filter((s) => !s.available).map((s) => s.label);
  const spectralDomainsMissing = subScores.filter((s) => !s.available && s.key !== "hrvReserve");
  if (spectralDomainsMissing.length > 0) {
    blockers.push({
      code: "ESSENTIAL_DOMAIN_MISSING",
      message:
        `${spectralDomainsMissing.map((s) => s.label).join(", ")} could not be assessed on this ` +
        "recording, so a composite that covers all autonomic domains cannot be produced. The " +
        "missing weight is NOT redistributed to the remaining domains.",
      domains: spectralDomainsMissing.map((s) => s.key),
    });
  }
  const ratiosMissing = [
    patient.eiRatio == null ? "E/I ratio" : null,
    patient.valsalvaRatio == null ? "Valsalva ratio" : null,
    patient.thirtyFifteenRatio == null ? "30:15 ratio" : null,
  ].filter((x): x is string => x != null);
  if (ratiosMissing.length > 0) {
    blockers.push({
      code: "RATIOS_MISSING",
      message: `${ratiosMissing.join(", ")} not present in this file.`,
      domains: ["reflexIntegrity"],
    });
  }
  if (patterns) {
    const unassessable = unassessablePatterns(patterns);
    if (unassessable.length > 0) {
      blockers.push({
        code: "PATTERNS_UNASSESSABLE",
        message:
          `${unassessable.length} clinical pattern(s) could not be assessed on this recording ` +
          `(${unassessable.join(", ")}), so the absence of an abnormality cannot be asserted.`,
        domains: ["patterns"],
      });
    }
  }
  const scorability = scorabilityFrom(blockers, unavailableWeight, missingDomains);

  const final = scorability.scorable ? provisionalFinal : null;

  // ---- Top drivers across all sub-scores + patterns (for the hover tooltip) ----
  const allDrivers = [
    ...s1Drivers, ...s2Drivers, ...s3Drivers, ...s4Drivers, ...s5Drivers, ...patternDrivers,
  ];
  const topPositiveDrivers = [...allDrivers].filter(d => d.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const topNegativeDrivers = [...allDrivers].filter(d => d.points < 0).sort((a, b) => a.points - b.points).slice(0, 3);

  // ---- Headline ----
  const headline = buildHeadline(final, patterns, topNegativeDrivers, topPositiveDrivers, scorability);

  // Effective weight of a sub-score = its NOMINAL weight share. Unavailable
  // sub-scores have weight 0 and that weight is NOT given to anyone else.
  const effW = (nominal: number, available: boolean) =>
    available ? Math.round((nominal / nominalWeightSum) * 1000) / 1000 : 0;
  const subScore = (
    score: number | null,
    nominal: number,
    available: boolean,
    drivers: WellnessDriver[],
    missing: string[],
  ): SubScore => {
    const w = effW(nominal, available);
    return {
      score,
      weight: w,
      contribution: Math.round((score ?? 0) * w * 10) / 10,
      drivers: drivers.slice().sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
      notes: available
        ? [
            ...drivers.map((d) => `${d.label}: ${d.value}`),
            ...(missing.length ? [`Not assessed: ${missing.join(", ")}`] : []),
          ]
        : [`Not assessed — ${missing.join(", ") || "required inputs unavailable"}`],
      available,
    };
  };

  return {
    baselineAutonomic:    subScore(s1, W.baseline, c1.available, s1Drivers, c1.missing),
    sympathovagalBalance: subScore(s2, W.sb,       c2.available, s2Drivers, c2.missing),
    reflexIntegrity:      subScore(s3, W.reflex,   c3.available, s3Drivers, c3.missing),
    orthostaticResponse:  subScore(s4, W.ortho,    c4.available, s4Drivers, c4.missing),
    hrvReserve:           subScore(s5, W.hrv,      hrvAssessable, s5Drivers,
                                   hrvAssessable ? [] : ["Heart-rhythm variability unreliable on this recording"]),
    patternPenalty:       { total: Math.round(patternPenaltyTotal * 10) / 10, items: patternDrivers },
    ageMultiplier: ageMul,
    rawTotal: scorability.scorable ? rawTotal : null,
    ageAdjusted: scorability.scorable ? ageAdjusted : null,
    final,
    topPositiveDrivers, topNegativeDrivers, headline,
    scorability,
  };
}


function buildHeadline(
  final: number | null,
  patterns: DysfunctionPatterns | undefined,
  topNeg: WellnessDriver[],
  topPos: WellnessDriver[],
  scorability: Scorability,
): string {
  // NOT SCORABLE: no reassurance, no number, no "no abnormal patterns". This is
  // the headline that replaced "Strong autonomic function across all tests — no
  // abnormal patterns detected" on a recording where the vendor clinician
  // documented Advanced Autonomic Dysfunction.
  if (final == null || !scorability.scorable) return scorability.notice;
  // Even when a number exists, the "no abnormal patterns" claim requires that
  // EVERY pattern was actually assessed and found absent.
  if (final >= 90) {
    return patterns && mayClaimNoAbnormalPatterns(patterns)
      ? `Strong autonomic function across all tests — no abnormal patterns detected.`
      : `Strong results on the measures that were assessed. Some patterns could not be assessed on this recording — see the not-assessed list below.`;
  }
  if (final >= 78) {
    const mildPatterns = patterns && presentPatterns(patterns).length > 0
      ? ` (one or two borderline findings noted below)`
      : "";
    return `Resilient autonomic function with good reflex integrity${mildPatterns}.`;
  }
  const lead = topNeg[0]?.label ?? "multiple borderline findings";
  const secondary = topNeg[1]?.label;
  const booster = topPos[0]?.label;
  if (final >= 65) return `Mostly balanced, but ${lead.toLowerCase()} is pulling the score down${secondary ? `, along with ${secondary.toLowerCase()}` : ""}. ${booster ? `Strong point: ${booster.toLowerCase()}.` : ""}`.trim();
  if (final >= 50) return `Mild autonomic imbalance. Main draggers: ${lead.toLowerCase()}${secondary ? `, ${secondary.toLowerCase()}` : ""}.`;
  if (final >= 35) return `Significant autonomic dysfunction. Priority findings: ${lead.toLowerCase()}${secondary ? `, ${secondary.toLowerCase()}` : ""}.`;
  return `Severely impaired autonomic function — multiple systems affected. Escalate to clinician review.`;
}

/**
 * Canonical stand-delta. ONE definition, shared by the report, the parse payload
 * and the diagnostic summary, so the same response can no longer report both
 * "Δ+9 bpm" and "ΔHR = 8 bpm" for the same recording. Baseline is the resting
 * Baseline-A window (not a pool of A+C+E). Returns null when either rate is
 * unknown — never 0.
 */
export function standDeltaBpm(
  baselineHr: number | null | undefined,
  standHr: number | null | undefined,
): number | null {
  if (baselineHr == null || standHr == null) return null;
  if (!Number.isFinite(baselineHr) || !Number.isFinite(standHr)) return null;
  if (baselineHr <= 0 || standHr <= 0) return null;
  return Math.round(standHr - baselineHr);
}

function tierFromScore(score: number | null): ANSReport["wellnessTier"] {
  // No score → no tier. A tier is an interpretation, not a placeholder.
  if (score == null) return null;
  if (score >= 90) return "Optimal";
  if (score >= 78) return "Resilient";
  if (score >= 65) return "Balanced";
  if (score >= 50) return "Stressed";
  if (score >= 35) return "Depleted";
  return "Critical";
}

// ============================================================================
// STAGE 7 — Body-system impact heatmap (GenUI data)
// ============================================================================

function computeBodyImpact(
  patterns: DysfunctionPatterns,
  phases: PhaseMetrics[],
  opts: { spectralAvailable: boolean; bpAvailable: boolean } = { spectralAvailable: true, bpAvailable: true },
): BodySystemImpact[] {
  const { spectralAvailable, bpAvailable } = opts;
  const out: BodySystemImpact[] = [];

  // A domain that depends on spectral or BP measures we don't have must NOT be
  // shown with a numeric score or a negative impact. It is emitted as a
  // qualitative "Not assessed" card (impact 0, assessed:false) so the heatmap
  // shows neutral and the copy explains why — never an unexplained -35.
  const notAssessed = (
    system: BodySystemImpact["system"],
    dependsOn: string,
  ): BodySystemImpact => ({
    system,
    impact: 0,
    assessed: false,
    label: "Not assessed",
    description: `Not assessed on this recording — this domain depends on ${dependsOn}, which ${dependsOn.includes("blood pressure") ? "was not recorded" : "is not reproducible"} from this file. A clinician can interpret it from the signed vendor report.`,
  });

  // --- Cardiovascular: HR-derived facts are supported; spectral/BP escalators
  //     only apply when available. ---------------------------------------------
  let cv = 0;
  const cvSupported = true; // resting/standing HR always available
  if (patterns.bradycardia) cv -= 20;
  if (patterns.POTS) cv -= 30; // HR-based
  if (spectralAvailable) {
    if (patterns.parasympatheticDominance) cv -= 15;
    if (patterns.parasympatheticExcess) cv -= 25;
    if (patterns.preSyncopeRisk) cv -= 20;
    if (patterns.vasovagalRisk) cv -= 15;
  }
  if (bpAvailable && patterns.orthostaticHypotension) cv -= 30;
  out.push({ system: "cardiovascular", impact: Math.max(-100, cv), assessed: cvSupported,
    label: cv < -30 ? "Significantly Affected" : cv < -10 ? "Mildly Affected" : "Stable",
    description: cv <= -10
      ? (patterns.bradycardia === true && phases[0].meanHR != null ? `Resting heart rate is low (${phases[0].meanHR} bpm), which can contribute to fatigue and cold extremities.` : "Heart-rate response to the protocol was outside the expected range on this test.")
      : "Heart-rate regulation is within functional range on the measures available (resting and standing heart rate)." });

  // --- Respiratory: FRF is a proprietary [P] measure — only when spectral. ----
  if (spectralAvailable) {
    let resp = 0;
    if (patterns.highFRF) resp -= 35;
    out.push({ system: "respiratory", impact: resp, assessed: true,
      label: resp < -20 ? "Affected" : "Stable",
      description: patterns.highFRF
        ? "Elevated fundamental respiratory frequency suggests ragged or shallow breathing — may reflect anxiety, upper-respiratory issues, or pulmonary irritation."
        : "Breathing pattern falls within normal respiratory frequency range." });
  } else {
    out.push(notAssessed("respiratory", "the proprietary respiratory-frequency (FRF) measure"));
  }

  // --- Nervous (autonomic): entirely spectral-derived. -----------------------
  if (spectralAvailable) {
    let ner = -10; // baseline noise
    if (patterns.advancedAutonomicDysfunction) ner -= 40;
    if (patterns.CAN) ner -= 30;
    if (patterns.parasympatheticExcess) ner -= 20;
    if (patterns.sympatheticWithdrawal) ner -= 20;
    if (patterns.maskedSW) ner -= 10;
    const nerParts: string[] = [];
    if (patterns.advancedAutonomicDysfunction) nerParts.push("broad autonomic dysfunction across several test phases");
    if (patterns.CAN) nerParts.push("a pattern consistent with cardiovascular autonomic neuropathy (not a diagnosis)");
    if (patterns.parasympatheticExcess) nerParts.push("excess resting parasympathetic (vagal) activity");
    if (patterns.sympatheticWithdrawal) nerParts.push("reduced sympathetic response on standing");
    const nerDesc = nerParts.length
      ? `Your autonomic nervous system — the automatic control of heart rate, blood pressure, and organ function — shows ${nerParts.join(", and ")}. This can affect how well you tolerate stress, standing up, and recovery. Discuss these findings with your clinician.`
      : "Your autonomic nervous system is regulating heart rate, blood pressure, and organ function within its expected range on this test.";
    out.push({ system: "nervous", impact: Math.max(-100, nerParts.length ? ner : 0), assessed: true,
      label: nerParts.length ? (ner < -30 ? "Significantly Affected" : "Mildly Affected") : "Stable",
      description: nerDesc });
  } else {
    out.push(notAssessed("nervous", "the proprietary spectral sympathetic/parasympathetic measures (LFa/RFa/SB)"));
  }

  // --- Digestive (vagal-tone): spectral-derived. -----------------------------
  if (spectralAvailable) {
    let dig = 0;
    if (patterns.parasympatheticDominance) dig += 5;
    if (patterns.sympatheticExcess) dig -= 15;
    if (patterns.parasympatheticExcess) dig -= 10;
    out.push({ system: "digestive", impact: dig, assessed: true,
      label: Math.abs(dig) < 10 ? "Stable" : dig < 0 ? "Mildly Affected" : "Over-active",
      description: patterns.parasympatheticDominance
        ? "High parasympathetic tone generally supports digestion, but excess may cause nausea or unpredictable gut motility."
        : "Digestive regulation appears balanced." });
  } else {
    out.push(notAssessed("digestive", "the proprietary vagal-tone (parasympathetic) measures"));
  }

  // --- Endocrine (stress axis): spectral-derived. ----------------------------
  if (spectralAvailable) {
    let end = 0;
    if (patterns.sympatheticExcess) end -= 20;
    if (patterns.sympatheticWithdrawal) end -= 15;
    if (patterns.advancedAutonomicDysfunction) end -= 25;
    out.push({ system: "endocrine", impact: end, assessed: true,
      label: end < -15 ? "Affected" : "Stable",
      description: end < -15
        ? "The autonomic signals that drive your stress (adrenal) axis look imbalanced on this test, which can influence cortisol rhythm, blood-sugar regulation, and thyroid signaling. This is an indirect, screening-level observation."
        : "The autonomic drive to your stress (adrenal) axis appears balanced on this test." });
  } else {
    out.push(notAssessed("endocrine", "the proprietary sympathetic measures"));
  }

  // --- Musculoskeletal: depends on spectral tone + BP. -----------------------
  if (spectralAvailable || bpAvailable) {
    let ms = 0;
    if (spectralAvailable && patterns.parasympatheticDominance) ms -= 15;
    if (bpAvailable && patterns.orthostaticHypotension) ms -= 15;
    out.push({ system: "musculoskeletal", impact: ms, assessed: true,
      label: ms < -10 ? "Mildly Affected" : "Stable",
      description: ms < -10
        ? "Reduced perfusion signals (from low resting tone or a blood-pressure drop on standing) can contribute to muscle fatigue, slower recovery, and cold hands and feet."
        : "No perfusion-related muscle impact was flagged on the measures available." });
  } else {
    out.push(notAssessed("musculoskeletal", "the proprietary tone and blood-pressure measures"));
  }

  // --- Immune (HRV/SDNN proxy): SDNN is ECG-derived (consensus tier) — always
  //     supported. --------------------------------------------------------------
  // Only phases whose beat series passed the artifact/plausibility gate count.
  // When none did, this domain is NOT ASSESSED — the previous code averaged
  // artifact-inflated values and used them to justify an "immune: Stable" claim.
  const reliableVars = phases
    .map((p) => p.hrvOverallVariabilityMs)
    .filter((v): v is number => v != null);
  if (reliableVars.length === 0) {
    out.push(notAssessed("immune", "beat-to-beat heart-rhythm variability, which was not measurable on this recording"));
    return out;
  }
  const avgSDNN = reliableVars.reduce((s, v) => s + v, 0) / reliableVars.length;
  let imm = 0;
  if (avgSDNN < 30) imm -= 25;
  else if (avgSDNN < 45) imm -= 10;
  if (spectralAvailable && patterns.advancedAutonomicDysfunction === true) imm -= 15;
  out.push({ system: "immune", impact: imm, assessed: true,
    label: imm < -15 ? "Affected" : imm < 0 ? "Mildly Affected" : "Stable",
    // Patient-facing copy: plain language only, no HRV-specific parameter name
    // (output protocol). Thresholds and the impact score above are unchanged.
    description: avgSDNN < 30
      ? `Low beat-to-beat heart-rhythm variability across the test (averaging ${avgSDNN.toFixed(0)} ms) is associated at a population level with reduced resilience and slower recovery. This is an indirect marker — not a direct immune measurement.`
      : avgSDNN < 45
        ? `Your beat-to-beat heart-rhythm variability is modest (averaging ${avgSDNN.toFixed(0)} ms); building autonomic reserve through sleep, activity, and stress management may help.`
        : `Your beat-to-beat heart-rhythm variability reserve (averaging ${avgSDNN.toFixed(0)} ms) is adequate on this test.` });

  return out;
}

// ============================================================================
// STAGE 7.5 — Multi-Parameter Graphical (Clinician view)
// ============================================================================
//
// Builds the exact data needed to reproduce Dr. Colombo's PhysioPS multi-
// parameter graphical report from the .ans file:
//   - Continuous HR trend across the whole test (beat-to-beat, downsampled)
//   - Continuous breathing envelope (ECG-derived respiration)
//   - Continuous LFa & RFa trends (rolling Morlet wavelet power)
//   - Per-phase cardio-respiratory coupling windows
//   - Scatter points + % RFa change metrics for the Excess panel

function downsample(t: number[], v: number[], targetPoints: number): TimeSeries {
  if (t.length <= targetPoints) return { t, v };
  const out: TimeSeries = { t: [], v: [] };
  const step = t.length / targetPoints;
  for (let i = 0; i < targetPoints; i++) {
    const i0 = Math.floor(i * step);
    const i1 = Math.min(t.length, Math.floor((i + 1) * step));
    let sum = 0;
    let n = 0;
    for (let j = i0; j < i1; j++) { sum += v[j]; n++; }
    out.t.push(t[Math.floor((i0 + i1) / 2)]);
    out.v.push(n > 0 ? sum / n : 0);
  }
  return out;
}

/**
 * Build a beat-to-beat HR time series (bpm at each R-peak time, seconds from t=0).
 * Returns an empty series if not enough peaks.
 */
function hrTrendFromPeaks(peaks: number[], samplingRate: number): TimeSeries {
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const rrMs = ((peaks[i] - peaks[i - 1]) / samplingRate) * 1000;
    if (rrMs <= 300 || rrMs >= 2000) continue;
    t.push(peaks[i] / samplingRate);
    v.push(60000 / rrMs);
  }
  return { t, v };
}

/**
 * Build a breathing envelope from R-peak amplitudes (ECG-derived respiration).
 * High-passed, smoothed, and centered around a baseline so the envelope
 * renders in the same frame as bpm.
 */
function breathingTrendFromPeaks(
  peaks: number[], amplitudes: number[], samplingRate: number
): TimeSeries {
  const t: number[] = [];
  const v: number[] = [];
  if (peaks.length < 4) return { t, v };
  // Moving-average detrend (10-beat window) -> residual = breathing envelope
  const win = 10;
  for (let i = 0; i < peaks.length; i++) {
    const i0 = Math.max(0, i - Math.floor(win / 2));
    const i1 = Math.min(amplitudes.length, i + Math.ceil(win / 2));
    let sum = 0;
    for (let k = i0; k < i1; k++) sum += amplitudes[k];
    const mean = sum / (i1 - i0);
    t.push(peaks[i] / samplingRate);
    v.push(amplitudes[i] - mean);
  }
  // Normalize to a modest visual range
  if (v.length === 0) return { t, v };
  const absMax = Math.max(1e-6, ...v.map(Math.abs));
  for (let i = 0; i < v.length; i++) v[i] = v[i] / absMax;
  return { t, v };
}

/**
 * Rolling LFa/RFa band-power trends over sliding windows (restored generic
 * engine).
 *
 * WINDOW LENGTH IS A HARD CONSTRAINT, NOT A STYLE CHOICE: a Morlet wavelet with
 * Q=5 cycles at the bottom of the sympathetic band (0.04 Hz) spans ~20 s per
 * sigma, so a window shorter than ~2 minutes cannot support the low edge of the
 * band at all. The old 30 s window silently dropped everything below ~0.1 Hz
 * and reported the remainder as "LFa". We therefore use a 120 s window stepped
 * every 10 s and say so, instead of publishing a fast-updating trend that is
 * quietly missing most of its band.
 *
 * Band edges follow the containing phase's OWN respiratory-frequency estimate
 * where available, and fall back to the fixed standard edges otherwise — the
 * old code silently substituted 0.2 Hz.
 *
 * Every point is a HumanOS ESTIMATE in bpm², never a vendor value. The series
 * is a raw measurable trend: it is preserved even when the composite clinical
 * score is withheld, and consumers must label it as an unvalidated estimate.
 */
function lfaRfaTrendsFromEcg(
  ecg: number[], samplingRate: number,
  phases: PhaseBoundary[],
  phaseMetrics: PhaseMetrics[]
): { lfa: TimeSeries; rfa: TimeSeries } {
  const lfa: TimeSeries = { t: [], v: [] };
  const rfa: TimeSeries = { t: [], v: [] };
  const windowSec = 120;
  const stepSec = 10;
  const totalSec = ecg.length / samplingRate;
  if (!Number.isFinite(totalSec) || totalSec < windowSec) return { lfa, rfa };

  // Detect R-peaks ONCE over the whole record. Re-running the detector on every
  // overlapping slice was both far slower and inconsistent at the slice edges
  // (a beat could be found in one window and missed in the next because the
  // adaptive threshold shifted).
  const { indices: allPeaks } = detectRPeaks(ecg, samplingRate);
  const beatSec: number[] = [];
  const beatRrMs: number[] = [];
  for (let i = 1; i < allPeaks.length; i++) {
    const ms = ((allPeaks[i] - allPeaks[i - 1]) / samplingRate) * 1000;
    if (ms > 300 && ms < 2000) {
      beatSec.push(allPeaks[i] / samplingRate);
      beatRrMs.push(ms);
    }
  }
  if (beatRrMs.length < 12) return { lfa, rfa };

  // One record-length bpm grid, high-pass filtered below the sympathetic band
  // so the heart-rate STEPS the protocol provokes (notably on standing) are not
  // read as sympathetic band power.
  const grid = highPassMovingAverage(
    resampleBeatsToBpmGrid(beatSec, beatRrMs, totalSec, RESAMPLE_FS),
    RESAMPLE_FS,
  );
  if (grid.length < 16) return { lfa, rfa };

  // Each phase contributes its own respiration-adaptive band edges, so group the
  // phases by band tuple and run ONE wavelet pass per distinct tuple (at most a
  // handful) instead of one per window.
  const bandsForPhase = phases.map((_, i) => {
    const pm = phaseMetrics[i];
    return respirationAdaptiveBands(pm?.FRF ?? null, {
      pacedBreathing: pm?.phase === "DeepBreathing-B",
    });
  });
  const phaseIndexAt = (t: number): number => {
    const p = phases.findIndex((ph) => t >= ph.startSec && t < ph.endSec);
    return p < 0 ? 0 : p;
  };
  const keyOf = (b: SpectralBands) => `${b.lfLo}|${b.lfHi}|${b.hfLo}|${b.hfHi}`;
  const unique = new Map<string, SpectralBands>();
  for (const b of bandsForPhase) if (!unique.has(keyOf(b))) unique.set(keyOf(b), b);

  type Row = { lf: Map<number, number>; hf: Map<number, number> };
  const byKey = new Map<string, Row>();
  for (const [key, b] of unique) {
    const lfSeries =
      b.lfHi - b.lfLo >= 0.01
        ? morletBandPowerSeries(grid, RESAMPLE_FS, b.lfLo, b.lfHi, { windowSec, stepSec })
        : { t: [], v: [] };
    const hfSeries = morletBandPowerSeries(grid, RESAMPLE_FS, b.hfLo, b.hfHi, { windowSec, stepSec });
    const row: Row = { lf: new Map(), hf: new Map() };
    lfSeries.t.forEach((t, i) => row.lf.set(Math.round(t * 10) / 10, lfSeries.v[i]));
    hfSeries.t.forEach((t, i) => row.hf.set(Math.round(t * 10) / 10, hfSeries.v[i]));
    byKey.set(key, row);
  }

  // Emit one point per window centre, taken from the series belonging to the
  // band tuple of the phase that contains that centre.
  for (let tCenter = windowSec / 2; tCenter + windowSec / 2 <= totalSec; tCenter += stepSec) {
    const t = Math.round(tCenter * 10) / 10;
    const bands = bandsForPhase[phaseIndexAt(tCenter)] ?? bandsForPhase[0];
    if (!bands) continue;
    // Require real beats inside the window: an all-bridged span must not be
    // published as if it had been measured.
    let beatsInWindow = 0;
    for (let i = 0; i < beatSec.length; i++) {
      if (beatSec[i] >= tCenter - windowSec / 2 && beatSec[i] < tCenter + windowSec / 2) beatsInWindow++;
    }
    if (beatsInWindow < 12) continue;

    const row = byKey.get(keyOf(bands));
    if (!row) continue;
    const lfPower = row.lf.get(t);
    const hfPower = row.hf.get(t);
    if (lfPower != null) {
      lfa.t.push(t);
      lfa.v.push(Math.round(Math.max(0, lfPower) * 100) / 100);
    }
    if (hfPower != null) {
      rfa.t.push(t);
      rfa.v.push(Math.round(Math.max(0, hfPower) * 100) / 100);
    }
  }
  return { lfa, rfa };
}

/**
 * Build a cardio-respiratory coupling window: 60 s (or 90 s for Stand) of
 * beat-to-beat HR + breathing envelope centered in the chosen phase.
 */
function buildCouplingWindow(
  phaseName: CardioRespiratoryWindow["phase"],
  label: string,
  ecg: number[],
  samplingRate: number,
  phaseStartSec: number,
  phaseEndSec: number,
  testStartClockSec: number | null,
  windowSec: number,
  annotations: string[]
): CardioRespiratoryWindow {
  // Choose window centered in the phase, but nudged to start after any warm-up
  const startSec = phaseName === "Stand"
    ? phaseStartSec + 5 // skip first-peak transient
    : phaseStartSec + Math.max(0, (phaseEndSec - phaseStartSec - windowSec) / 2);
  const endSec = Math.min(phaseEndSec, startSec + windowSec);

  const i0 = Math.floor(startSec * samplingRate);
  const i1 = Math.floor(endSec * samplingRate);
  const slice = ecg.slice(i0, i1);
  const { indices, amplitudes } = detectRPeaks(slice, samplingRate);
  // Offset indices into absolute test time
  const absPeaks = indices.map(idx => idx + i0);
  const hr = hrTrendFromPeaks(absPeaks, samplingRate);
  const breathing = breathingTrendFromPeaks(absPeaks, amplitudes, samplingRate);

  // Re-reference time axis to window-relative seconds (0 .. windowSec)
  const hrRel: TimeSeries = { t: hr.t.map(x => x - startSec), v: hr.v };
  const brRel: TimeSeries = { t: breathing.t.map(x => x - startSec), v: breathing.v };

  // Wall clocks are emitted ONLY from a real parsed time-of-day and only when
  // the result is a valid < 24 h clock. Otherwise both are null and the UI uses
  // the relative offsets. See `deriveStudyClockStartSec` for the "30:20:36" bug.
  const startClock = secondsToClock(testStartClockSec, startSec);
  const endClock = secondsToClock(testStartClockSec, endSec);

  return {
    phase: phaseName, label,
    startClock, endClock,
    startOffsetSec: Math.round(startSec * 10) / 10,
    endOffsetSec: Math.round(endSec * 10) / 10,
    clockSource: startClock != null && endClock != null ? "file_timestamp" : "relative_only",
    hr: hrRel, breathing: brRel, annotations,
  };
}

/**
 * Format a wall clock, or return null when no valid clock can be produced.
 *
 * HARD INVARIANT: never emits an hour > 23. The previous implementation had no
 * such guard, so a bogus start-of-recording seed produced "30:20:36" etc. on
 * every coupling window while the file itself carried real 10:17:37 AM stamps.
 */
export function secondsToClock(
  startClockSec: number | null | undefined,
  offsetSec: number,
): string | null {
  if (startClockSec == null || !Number.isFinite(startClockSec)) return null;
  if (startClockSec < 0 || startClockSec >= 24 * 3600) return null;
  if (!Number.isFinite(offsetSec) || offsetSec < 0) return null;
  const totalSec = Math.floor(startClockSec + offsetSec);
  // A recording that runs past midnight would need a date to be meaningful; we
  // decline to guess rather than print a > 23 h clock.
  if (totalSec >= 24 * 3600) return null;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Recording-start wall clock in seconds past midnight, or null.
 *
 * NO FABRICATED DEFAULT. The old version fell back to a hardcoded 13:08:00 and,
 * worse, ran a loose `(\d{1,2}):(\d{2})` regex over the raw ASCII head which
 * matched the literal "30:15" of the **30:15 Ratio** label — hour 30 — and
 * emitted "30:20:36" / "30:25:27" as wall-clock times. The strict derivation
 * lives in `deriveStudyClockStartSec` (api/_ans/legacyAdapter.ts) and is
 * computed once at parse time; when it yields nothing we show relative time.
 */
function parseTestStartClockSec(data: ParsedANSData): number | null {
  if (data.studyClockStartSec !== undefined) return data.studyClockStartSec;
  return deriveStudyClockStartSec(data.testNotes);
}

// Returns true iff the raw ECG samples contain real signal (not all-zero / constant).
function hasRealEcg(ecg: number[]): boolean {
  if (!ecg || ecg.length < 100) return false;
  let mn = Infinity, mx = -Infinity;
  const step = Math.max(1, Math.floor(ecg.length / 500));
  for (let i = 0; i < ecg.length; i += step) {
    const v = ecg[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return (mx - mn) > 10; // any meaningful dynamic range = real ECG
}

function computeMultiParameterGraphical(
  data: ParsedANSData,
  phaseEvents: PhaseMetrics[]
): MultiParameterGraphical {
  // Spectral fields (LFa/RFa/SB) are null unless the paired vendor PDF supplied
  // them. The scatter panels preserve null (rendered "Not assessed") rather
  // than coercing a fabricated 0. Percent-change is only defined when BOTH
  // endpoints are present. HR + breathing trends are genuine time-domain
  // measures and always plotted.
  const rfaChangePct = (base: number | null, other: number | null): number | null =>
    base != null && other != null && base > 0
      ? Math.round(((other - base) / base) * 100 * 10) / 10
      : null;
  const ecgAvailable = hasRealEcg(data.ecgData);
  // Short-circuit if the file has no real ECG — still emit scatter/ratios so
  // the clinician panels that rely on header metrics keep working.
  if (!ecgAvailable) {
    const samplingRate = 1 / data.samplingInterval;
    const totalSec = data.dataPointCount * data.samplingInterval;
    const segs = segmentPhases(totalSec);
    const phaseLabels: Record<string, PhaseBoundary["name"]> = {
      "Baseline-A": "A", "DeepBreathing-B": "B", "Baseline-C": "C",
      "Valsalva-D": "D", "Baseline-E": "E", "Stand-F": "F",
    };
    const phases: PhaseBoundary[] = segs.map(s => ({
      name: phaseLabels[s.name], label: s.label, startSec: s.start, endSec: s.end,
    }));
    const A = phaseEvents[0], B = phaseEvents[1], D = phaseEvents[3], F = phaseEvents[5];
    return {
      ecgAvailable: false,
      totalSec,
      phases,
      heartRateTrend: { t: [], v: [] },
      breathingTrend: { t: [], v: [] },
      lfaTrend: { t: [], v: [] },
      rfaTrend: { t: [], v: [] },
      scatter: {
        baselineLFa: A.LFa, baselineRFa: A.RFa,
        dbRFa: B.RFa,
        valsalvaLFa: D.LFa,
        standLFa: F.LFa, standRFa: F.RFa,
        rfaChangeValsalvaPct: rfaChangePct(A.RFa, D.RFa),
        rfaChangeStandPct: rfaChangePct(A.RFa, F.RFa),
      },
      coupling: [],
      wavelet: { type: "n/a", cycles: 0, spectralUpdateSec: 0 },
    };
  }
  const samplingRate = 1 / data.samplingInterval;
  const totalSec = data.dataPointCount * data.samplingInterval;

  // Rebuild segment boundaries (identical to segmentPhases but return PhaseBoundary shape)
  const segs = segmentPhases(totalSec);
  const phaseLabels: Record<string, PhaseBoundary["name"]> = {
    "Baseline-A": "A", "DeepBreathing-B": "B", "Baseline-C": "C",
    "Valsalva-D": "D", "Baseline-E": "E", "Stand-F": "F",
  };
  const phases: PhaseBoundary[] = segs.map(s => ({
    name: phaseLabels[s.name], label: s.label, startSec: s.start, endSec: s.end,
  }));

  // --- HR + breathing trends (whole test) ---
  const { indices, amplitudes } = detectRPeaks(data.ecgData, samplingRate);
  const hrFull = hrTrendFromPeaks(indices, samplingRate);
  const brFull = breathingTrendFromPeaks(indices, amplitudes, samplingRate);
  // Downsample for transport: ~240 points across the test (~4 s per point)
  const heartRateTrend = downsample(hrFull.t, hrFull.v, 240);
  const breathingTrend = downsample(brFull.t, brFull.v, 480);

  // --- LFa / RFa trends (rolling wavelet) ---
  const { lfa, rfa } = lfaRfaTrendsFromEcg(data.ecgData, samplingRate, phases, phaseEvents);

  // --- Scatter + % change ---
  const A = phaseEvents[0], B = phaseEvents[1], D = phaseEvents[3], F = phaseEvents[5];

  // --- Coupling windows (4 panels: Baseline / DB / Valsalva / Stand) ---
  // Baseline spectral annotations are shown only when vendor spectral exists;
  // otherwise they read "Not assessed" rather than a fabricated 0.00.
  const testClock = parseTestStartClockSec(data);
  const couplingSpecs: Array<{ phase: CardioRespiratoryWindow["phase"]; label: string; idx: number; win: number; annots: () => string[] }> = [
    // Vendor P&S casing is normalized to `LFa` / `RFa` everywhere (the mixed
    // `LFA`/`LFa` spelling risked a future regex confusing `LFA` with `LF`).
    { phase: "Baseline", label: "Baseline (1 min)", idx: 2, win: 60, annots: () => [`RFa = ${A.RFa == null ? "Not assessed" : A.RFa.toFixed(2)}`, `LFa/RFa = ${A.SB == null ? "Not assessed" : A.SB.toFixed(2)}`] },
    // Reference ranges come from the SINGLE authoritative age-specific table.
    // The old hardcoded "ref (1.2 - 1.6)" / "ref (1.15 - 1.5)" annotations were
    // a third, inconsistent normal-limit set for the same three ratios.
    { phase: "DeepBreathing", label: "Deep Breathing (1 min)", idx: 1, win: 60, annots: () => [`E/I Ratio = ${data.eiRatio == null ? "Not assessed" : data.eiRatio.toFixed(2)}`, ratioReferenceLabel("eiRatio", data.age || null)] },
    { phase: "Valsalva", label: "Valsalva (1 min)", idx: 3, win: 60, annots: () => [`Valsalva Ratio = ${data.valsalvaRatio == null ? "Not assessed" : data.valsalvaRatio.toFixed(2)}`, ratioReferenceLabel("valsalvaRatio", data.age || null)] },
    { phase: "Stand", label: "Stand (1 min)", idx: 5, win: 90, annots: () => [`30:15 Ratio = ${data.thirtyFifteenRatio == null ? "Not assessed" : data.thirtyFifteenRatio.toFixed(2)}`, ratioReferenceLabel("thirtyFifteenRatio", data.age || null)] },
  ];
  const coupling: CardioRespiratoryWindow[] = couplingSpecs.map(spec => {
    const seg = segs[spec.idx];
    return buildCouplingWindow(
      spec.phase, spec.label, data.ecgData, samplingRate,
      seg.start, seg.end, testClock, spec.win, spec.annots()
    );
  });

  return {
    ecgAvailable: true,
    totalSec,
    phases,
    heartRateTrend,
    breathingTrend,
    lfaTrend: lfa,
    rfaTrend: rfa,
    scatter: {
      baselineLFa: A.LFa, baselineRFa: A.RFa,
      dbRFa: B.RFa,
      valsalvaLFa: D.LFa,
      standLFa: F.LFa, standRFa: F.RFa,
      rfaChangeValsalvaPct: rfaChangePct(A.RFa, D.RFa),
      rfaChangeStandPct: rfaChangePct(A.RFa, F.RFa),
    },
    coupling,
    wavelet: { type: "n/a (vendor spectral required)", cycles: 0, spectralUpdateSec: 0 },
  };
}

// ============================================================================
// STAGE 7.5 — Path B: Colombo indication detector
// ============================================================================

interface Indication {
  code: string;
  name: string;
  description: string;
  severity: "high" | "moderate" | "low";
}

function pctChangeLocal(a: number, b: number): number {
  if (a === 0) return b > 0 ? Infinity : 0;
  return ((b - a) / a) * 100;
}

/** Cheynes-Stokes detector via auto-corr of breathing envelope at 25–65s lags. */
function detectCheynesStokesLocal(breathing?: { t: number[]; v: number[] }): boolean {
  if (!breathing || breathing.v.length < 120) return false;
  const v = breathing.v, t = breathing.t;
  if (t.length < 2) return false;
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (dt <= 0) return false;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const env = v.map(x => Math.abs(x - mean));
  const minLag = Math.max(2, Math.round(25 / dt));
  const maxLag = Math.min(v.length - 1, Math.round(65 / dt));
  if (maxLag <= minLag + 2) return false;
  const envMean = env.reduce((a, b) => a + b, 0) / env.length;
  const envCentered = env.map(x => x - envMean);
  const envVar = envCentered.reduce((a, b) => a + b * b, 0);
  if (envVar < 1e-6) return false;
  let peakCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < envCentered.length; i++) s += envCentered[i] * envCentered[i + lag];
    const corr = s / envVar;
    if (corr > peakCorr) peakCorr = corr;
  }
  return peakCorr > 0.55;
}

function detectIndicationsLocal(
  phaseEvents: PhaseMetrics[],
  mpg?: MultiParameterGraphical,
  gates: { standSpectralAvailable: boolean; standBpAvailable: boolean } = {
    standSpectralAvailable: true,
    standBpAvailable: true,
  },
): Indication[] {
  if (!phaseEvents || phaseEvents.length === 0) return [];
  const A = phaseEvents[0];
  const D = phaseEvents[3] || null;
  const F = phaseEvents[phaseEvents.length - 1];

  const restingLfa = A?.LFa ?? null;
  const restingRfa = A?.RFa ?? null;
  const restingSb  = A?.SB ?? null;
  const restingHr  = A?.meanHR ?? null;
  const restingSbp = A?.SBP ?? null;
  const restingDbp = A?.DBP ?? null;
  const valsalvaLfa = D?.LFa ?? null;
  const valsalvaRfa = D?.RFa ?? null;
  const valsalvaSbp = D?.SBP ?? null;
  // Standing findings must use REAL standing data only. When the stand phase's
  // spectral is a computed estimate (paired path supplies vendor values for the
  // baseline only) or the standing cuff BP was never measured, these read null so
  // no orthostatic/adrenergic/syncope indication can be fabricated. HR is always
  // ECG-derived, so standHr stays available for HR-only findings (POTS/Pre-POTS).
  const standLfa = gates.standSpectralAvailable ? (F?.LFa ?? null) : null;
  const standRfa = gates.standSpectralAvailable ? (F?.RFa ?? null) : null;
  const standHr  = F?.meanHR ?? null;
  const standSbp = gates.standBpAvailable ? (F?.SBP ?? null) : null;
  const standDbp = gates.standBpAvailable ? (F?.DBP ?? null) : null;

  const out: Indication[] = [];
  const has = (code: string) => out.some(i => i.code === code);

  // CAN: RFa < 0.1
  if (restingRfa != null && restingRfa < 0.1) {
    if (restingSb != null && restingSb >= 0.4 && restingSb <= 3.0) {
      out.push({ code: "CAN", name: "Cardiovascular Autonomic Neuropathy (CAN) with normal SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm² (< 0.1), SB ${restingSb.toFixed(2)} (within 0.4–3.0). Findings consistent with CAN with preserved sympathovagal balance.`,
        severity: "high" });
    } else if (restingSb != null && restingSb > 3.0) {
      out.push({ code: "CAN_HIGH_SB", name: "CAN with high SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm², SB ${restingSb.toFixed(2)} (> 3.0). CAN plus concurrent Sympathetic Excess.`,
        severity: "high" });
    } else if (restingSb != null && restingSb < 0.4) {
      out.push({ code: "CAN_LOW_SB", name: "CAN with low SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm², SB ${restingSb.toFixed(2)} (< 0.4). CAN plus concurrent Parasympathetic Excess.`,
        severity: "high" });
    } else {
      out.push({ code: "CAN", name: "Cardiovascular Autonomic Neuropathy (CAN)",
        description: `Very low resting parasympathetic activity (RFa ${restingRfa.toFixed(2)} bpm² < 0.1).`,
        severity: "high" });
    }
  }

  // Resting SE: SB > 3.0
  if (restingSb != null && restingSb > 3.0 && !has("CAN_HIGH_SB")) {
    out.push({ code: "SE_REST", name: "Resting Sympathetic Excess (SE)",
      description: `Sympathovagal balance ${restingSb.toFixed(2)} (> 3.0) at rest. Associated with hypertension, anxiety, cardiovascular events.`,
      severity: "high" });
  }

  // Resting low SB: SB < 0.4 — classified by WHAT DRIVES IT (see colomboNorms
  // classifyLowSbDriver). True parasympathetic excess ONLY when RFa is elevated;
  // otherwise a low/low-normal LFa drives the ratio → relative parasympathetic
  // dominance / reduced sympathetic modulation (never "excess", never "withdrawal").
  if (restingSb != null && restingSb < 0.4 && !has("CAN_LOW_SB")) {
    const driver = classifyLowSbDriver(restingLfa, restingRfa);
    if (driver === "parasympathetic-excess" || driver === "mixed") {
      out.push({ code: "PE_REST", name: "Resting Parasympathetic Excess (PE)",
        description: `Sympathovagal balance ${restingSb.toFixed(2)} (< 0.4) at rest with elevated RFa ${restingRfa!.toFixed(2)} bpm² (> ${COLOMBO_NORMS.RFa.hi}). Parasympathetic (vagal) activity is genuinely high.`,
        severity: "moderate" });
    } else {
      const lfaNote = restingLfa != null ? ` LFa ${restingLfa.toFixed(2)} bpm² is low/low-normal` : " sympathetic modulation is reduced";
      const rfaNote = restingRfa != null ? `, RFa ${restingRfa.toFixed(2)} bpm² is within normal limits` : "";
      out.push({ code: "RPD_REST", name: "Relative Parasympathetic Dominance (reduced sympathetic modulation)",
        description: `Sympathovagal balance ${restingSb.toFixed(2)} (< 0.4) at rest:${lfaNote}${rfaNote}. The low ratio reflects reduced sympathetic modulation, not parasympathetic excess. Clinician review of the vendor report is advised.`,
        severity: "moderate" });
    }
  }

  // AAN: LFa in [0.1, 0.5) OR RFa < 0.5
  const aanFromLfa = restingLfa != null && restingLfa >= 0.1 && restingLfa < 0.5;
  const aanFromRfa = restingRfa != null && restingRfa < 0.5;
  if (aanFromLfa || aanFromRfa) {
    const parts: string[] = [];
    if (aanFromLfa) parts.push(`LFa ${restingLfa!.toFixed(2)} bpm²`);
    if (aanFromRfa) parts.push(`RFa ${restingRfa!.toFixed(2)} bpm²`);
    out.push({ code: "AAN", name: "Advanced Autonomic Neuropathy (AAN)",
      description: `Very low autonomic activity at rest (${parts.join("; ")}). Consistent with significant autonomic nerve damage.`,
      severity: "high" });
  }

  // Dynamic SE — Valsalva
  if (restingLfa != null && valsalvaLfa != null && restingLfa > 0 && pctChangeLocal(restingLfa, valsalvaLfa) > 500) {
    out.push({ code: "SE_VALSALVA", name: "Dynamic Sympathetic Excess (SE) — Valsalva",
      description: `Sympathetic surge during Valsalva: LFa ${restingLfa.toFixed(2)} → ${valsalvaLfa.toFixed(2)} bpm² (+${pctChangeLocal(restingLfa, valsalvaLfa).toFixed(0)}%). Associated with hypertension and anxiety.`,
      severity: "moderate" });
  }

  // Dynamic SE — Standing
  if (restingLfa != null && standLfa != null && restingLfa > 0 && pctChangeLocal(restingLfa, standLfa) > 500) {
    out.push({ code: "SE_STAND", name: "Dynamic Sympathetic Excess (SE) — Standing",
      description: `Sympathetic surge on standing: LFa ${restingLfa.toFixed(2)} → ${standLfa.toFixed(2)} bpm² (+${pctChangeLocal(restingLfa, standLfa).toFixed(0)}%).`,
      severity: "moderate" });
  }

  // Dynamic PE — Valsalva
  if (restingRfa != null && valsalvaRfa != null && restingRfa > 0 && pctChangeLocal(restingRfa, valsalvaRfa) > 600) {
    out.push({ code: "PE_VALSALVA", name: "Dynamic Parasympathetic Excess (PE) — Valsalva",
      description: `Parasympathetic surge during Valsalva: RFa ${restingRfa.toFixed(2)} → ${valsalvaRfa.toFixed(2)} bpm² (+${pctChangeLocal(restingRfa, valsalvaRfa).toFixed(0)}%). Associated with difficult-to-control BP or blood sugar.`,
      severity: "moderate" });
  }

  // Dynamic PE — Standing
  if (restingRfa != null && standRfa != null && standRfa > restingRfa) {
    out.push({ code: "PE_STAND", name: "Dynamic Parasympathetic Excess (PE) — Standing",
      description: `RFa rose on standing (${restingRfa.toFixed(2)} → ${standRfa.toFixed(2)} bpm²) — atypical; normally parasympathetic withdraws on standing.`,
      severity: "moderate" });
  }

  // Orthostatic Dysfunction (OD)
  const hasOD = restingLfa != null && standLfa != null && standLfa < restingLfa;
  if (hasOD) {
    const isHighRisk = restingSb != null && (restingSb < 0.4 || restingSb > 3.0);
    const sbNote = restingSb != null ? ` Resting SB ${restingSb.toFixed(2)} (${isHighRisk ? "outside" : "within"} 0.4–3.0).` : "";
    out.push({
      code: isHighRisk ? "OD_HIGH" : "OD_NORMAL",
      name: `Orthostatic Dysfunction (OD) — ${isHighRisk ? "High Risk" : "Normal Risk"}`,
      description: `LFa decreased rest → standing (${restingLfa!.toFixed(2)} → ${standLfa!.toFixed(2)} bpm²). Consistent with impaired sympathetic support of posture.${sbNote}`,
      severity: isHighRisk ? "high" : "moderate",
    });
  }

  // POTS / Pre-POTS
  if (hasOD && standHr != null && restingHr != null) {
    const rise = standHr - restingHr;
    if (rise > 30 || standHr > 120) {
      out.push({ code: "POTS", name: "Postural Orthostatic Tachycardia Syndrome (POTS)",
        description: `OD with HR rise ${rise.toFixed(0)} bpm on standing (${restingHr.toFixed(0)} → ${standHr.toFixed(0)})${standHr > 120 ? ", exceeding 120 bpm" : ""}.`,
        severity: "high" });
    } else if (rise >= 20 && rise <= 30) {
      out.push({ code: "PRE_POTS", name: "Pre-POTS",
        description: `Borderline orthostatic tachycardia: HR rose ${rise.toFixed(0)} bpm on standing (${restingHr.toFixed(0)} → ${standHr.toFixed(0)}). Below 30 bpm POTS threshold but warrants monitoring.`,
        severity: "moderate" });
    }
  }

  // VVS
  if (restingLfa != null && standLfa != null && restingLfa > 0 &&
      restingRfa != null && standRfa != null &&
      standLfa > 5 * restingLfa && standRfa > restingRfa) {
    out.push({ code: "VVS", name: "Vasovagal Syncope (VVS) Predisposition",
      description: `Large sympathetic surge on standing (LFa ${restingLfa.toFixed(2)} → ${standLfa.toFixed(2)} bpm²) with concurrent parasympathetic excess (RFa ${restingRfa.toFixed(2)} → ${standRfa.toFixed(2)}). Pattern consistent with predisposition to fainting on postural change.`,
      severity: "high" });
  }

  // Baroreceptor reflex impairment
  if (restingSbp != null && valsalvaSbp != null && restingSbp > 0) {
    const sbpRisePct = pctChangeLocal(restingSbp, valsalvaSbp);
    if (sbpRisePct < 10) {
      out.push({ code: "BARORECEPTOR", name: "Baroreceptor Reflex Impairment",
        description: `Systolic BP rose only ${sbpRisePct.toFixed(1)}% during Valsalva (${restingSbp} → ${valsalvaSbp} mmHg, expected ≥ 10%). Consistent with impaired baroreceptor sensitivity.`,
        severity: "moderate" });
    }
  }

  // Neurogenic syncope risk
  if ((has("OD_HIGH") || has("VVS")) && (has("AAN") || has("CAN") || has("CAN_HIGH_SB") || has("CAN_LOW_SB"))) {
    out.push({ code: "NEUROGENIC_SYNCOPE", name: "Neurogenic Syncope Risk",
      description: "Orthostatic dysfunction (high risk) combined with autonomic neuropathy markers raises concern for neurogenic syncope. Counsel on fall precautions; consider tilt-table referral.",
      severity: "high" });
  }

  // Cardiogenic syncope risk
  if (restingHr != null && restingHr < 50 && hasOD) {
    out.push({ code: "CARDIOGENIC_SYNCOPE", name: "Cardiogenic Syncope Risk",
      description: `Resting bradycardia (${restingHr.toFixed(0)} bpm) with orthostatic dysfunction. Consider cardiology evaluation for sinus node or conduction system disease.`,
      severity: "high" });
  }

  // Cheynes-Stokes
  if (detectCheynesStokesLocal(mpg?.breathingTrend)) {
    out.push({ code: "CHEYNES_STOKES", name: "Cheynes-Stokes Breathing",
      description: "Cyclical crescendo-decrescendo breathing (period 30–60 s) detected in the respiratory envelope. Often associated with congestive heart failure, stroke, or central sleep apnea.",
      severity: "high" });
  }

  // Orthostatic Hypotension by BP
  if (restingSbp != null && standSbp != null && (restingSbp - standSbp) >= 20) {
    out.push({ code: "ORTHOSTATIC_HYPOTENSION", name: "Orthostatic Hypotension (BP)",
      description: `SBP fell ≥ 20 mmHg on standing (${restingSbp} → ${standSbp}). Meets BP-criteria for orthostatic hypotension.`,
      severity: "high" });
  } else if (restingDbp != null && standDbp != null && (restingDbp - standDbp) >= 10) {
    out.push({ code: "ORTHOSTATIC_HYPOTENSION", name: "Orthostatic Hypotension (BP)",
      description: `DBP fell ≥ 10 mmHg on standing (${restingDbp} → ${standDbp}). Meets BP-criteria for orthostatic hypotension.`,
      severity: "high" });
  }

  return out;
}

// ============================================================================
// STAGE 8 — Main entry point: generate full report
// ============================================================================

export function generateColomboReport(
  data: ParsedANSData,
  vendorMetrics?: VendorReportedMetrics,
): ANSReport {
  const samplingRate = 1 / data.samplingInterval;
  const totalSec = data.dataPointCount * data.samplingInterval;

  // Segment into 6 phases
  const segments = segmentPhases(totalSec);

  // Analyze each phase
  const phaseEvents: PhaseMetrics[] = segments.map(seg => {
    const i0 = Math.floor(seg.start * samplingRate);
    const i1 = Math.min(data.ecgData.length, Math.floor(seg.end * samplingRate));
    const ecgSlice = data.ecgData.slice(i0, i1);
    return analyzePhase(ecgSlice, samplingRate, seg.name, seg.label, seg.end - seg.start);
  });

  // --- No spectral synthesis, no vendor-value substitution -------------------
  // The per-phase spectral aggregates (LFa/RFa/SB) are NOT stored as extractable
  // scalars in the .ans binary; the vendor derives them via an undisclosed
  // wavelet algorithm and prints them only in the signed PDF. This engine does
  // NOT estimate them from the raw waveform (the former SCALE=0.0018 Morlet
  // routine was removed) and does NOT memorize/fingerprint-substitute PDF
  // values. `analyzePhase` therefore emits LFa/RFa/SB as null with `unavailable`
  // provenance. The ONLY way a spectral value enters the report is a paired
  // vendor PDF applied to baseline A below (`vendor_reported`, or
  // `derived_from_vendor` for a computed SB) — after server-side identity
  // reconciliation. Unavailable phases render "not assessed", never vendor truth.

  // Baseline A is the canonical resting measurement
  const A = phaseEvents[0];
  const B = phaseEvents[1];
  const C = phaseEvents[2];
  const D = phaseEvents[3];
  const E = phaseEvents[4];
  const F = phaseEvents[5];

  // Add BP from parsed metadata (Jill: 92/55 at rest)
  if (data.baselineSystolicBP && data.baselineDiastolicBP) {
    A.SBP = data.baselineSystolicBP;
    A.DBP = data.baselineDiastolicBP;
    A.PP = A.SBP - A.DBP;
    A.MAP = Math.round((A.SBP + 2 * A.DBP) / 3);
  }

  // --- Paired vendor-PDF override (vendor_reported provenance) ----------------
  // When the clinician supplies the signed vendor report, its verbatim spectral
  // aggregates (LFa/RFa/SB) and cuff BP are injected onto the baseline with
  // `vendor_reported` provenance. `mayInterpretClinically(vendor_reported)` is
  // true, so the spectral gate below opens and the FULL Colombo interpretation +
  // treatment pathway runs — instead of the honest "Not assessed" fallback.
  // Nothing is computed or inferred here; only vendor-printed numbers pass through.
  if (vendorMetrics) {
    if (typeof vendorMetrics.LFa === "number") {
      A.LFa = vendorMetrics.LFa;
      if (A.provenance) A.provenance.LFa = vendorReportedProvenance("LFa");
    }
    if (typeof vendorMetrics.RFa === "number") {
      A.RFa = vendorMetrics.RFa;
      if (A.provenance) A.provenance.RFa = vendorReportedProvenance("RFa");
    }
    // SB: prefer the vendor's printed value; otherwise derive it from vendor
    // LFa/RFa. The two cases carry DIFFERENT provenance — a printed SB is
    // vendor_reported, a computed quotient is derived_from_vendor — so the
    // report never overstates a locally-derived number as vendor-printed.
    const vendorPrintedSB = typeof vendorMetrics.SB === "number";
    const vendorSB = vendorPrintedSB
      ? (vendorMetrics.SB as number)
      : typeof vendorMetrics.LFa === "number" &&
          typeof vendorMetrics.RFa === "number" &&
          vendorMetrics.RFa !== 0
        ? vendorMetrics.LFa / vendorMetrics.RFa
        : undefined;
    if (typeof vendorSB === "number") {
      A.SB = vendorSB;
      if (A.provenance) {
        A.provenance.SB = vendorPrintedSB
          ? vendorReportedProvenance("SB")
          : derivedFromVendorProvenance("SB", "Computed here as vendor LFa ÷ vendor RFa; the vendor report printed LFa and RFa but not the ratio.");
      }
    }
    if (typeof vendorMetrics.SBP === "number" && typeof vendorMetrics.DBP === "number") {
      A.SBP = vendorMetrics.SBP;
      A.DBP = vendorMetrics.DBP;
      A.PP = A.SBP - A.DBP;
      A.MAP = Math.round((A.SBP + 2 * A.DBP) / 3);
    }
  }

  // --- Spectral / BP availability gate ---------------------------------------
  // TWO DIFFERENT QUESTIONS, TWO DIFFERENT FLAGS:
  //
  //  * `spectralAvailable` = may a spectral value DRIVE A CLINICAL CONCLUSION?
  //    True only when baseline A carries a vendor_reported / derived_from_vendor
  //    value from the paired signed PDF. A HumanOS waveform estimate is
  //    `computed` + `estimated`, for which `mayInterpretClinically()` is false,
  //    so an estimate can never be read as "sympathetic 0%" or trigger an
  //    autonomic-neuropathy / parasympathetic / treatment finding, and can never
  //    unlock the composite score. This flag is UNCHANGED in meaning.
  //
  //  * `spectralEstimated` (below) = did the generic waveform engine produce
  //    displayable LFa/RFa/SB estimates? Those numbers stay in `phaseEvents`
  //    with `computed`/`estimated` provenance so charts, trends and the
  //    clinician instrument view keep the raw measurable content instead of
  //    being blanket-nulled. Requirement: preserve measurable output even when
  //    a composite score is withheld.
  //
  // NOTE this is the GLOBAL (baseline-A) clinical gate; per-phase narrative
  // classification additionally checks each phase's own provenance
  // (classifyOrNull) — see phaseFindings below.
  const spectralAvailable = !!(
    A.provenance &&
    mayInterpretClinically(A.provenance.LFa) &&
    mayInterpretClinically(A.provenance.RFa) &&
    mayInterpretClinically(A.provenance.SB)
  );
  const bpAvailable = A.SBP != null && A.DBP != null;

  // --- Standing-phase availability gates -------------------------------------
  // Orthostatic / standing findings must be driven ONLY by real standing data.
  // In the paired-report path only the BASELINE receives vendor_reported values;
  // the Stand (F) phase spectral stays computed/estimated and its cuff BP is not
  // present at all. Reading those estimates as a real standing response is what
  // fabricated "a weakened fight-or-flight response on standing", "a
  // blood-pressure drop when standing", "a tendency toward fainting spells", and
  // "Orthostatic Dysfunction (High Risk)" while the clinician view correctly
  // said Adrenergic/orthostatic were NOT assessed. We gate on the STAND phase's
  // OWN provenance (spectral) and on the presence of BOTH baseline and standing
  // cuff BP (orthostatic BP), so nothing standing-derived surfaces unless the
  // standing measurement genuinely exists.
  const standSpectralAvailable = !!(
    F.provenance &&
    mayInterpretClinically(F.provenance.LFa) &&
    mayInterpretClinically(F.provenance.RFa)
  );
  const standBpAvailable = F.SBP != null && F.DBP != null;
  const orthostaticBpAssessable = bpAvailable && standBpAvailable;

  // The raw copy is kept for the internal wellness index and clinician trend
  // charts. It is now identical in its spectral fields to `phaseEvents` — the
  // former blanket-null pass over `phaseEvents` has been removed (see below) —
  // but the snapshot is retained so any future gate that does mutate the
  // published copy still has an unmutated reference.
  const phaseEventsRaw: PhaseMetrics[] = phaseEvents.map((p) => ({ ...p }));

  // NO BLANKET NULLING.
  //
  // Production previously overwrote LFa/RFa/SB/FRF with `null` on EVERY phase
  // whenever `spectralAvailable` was false, i.e. on every .ans-only upload. That
  // erased values the engine can legitimately compute from the waveform and left
  // the report with no spectral content whatsoever. The correct separation is
  // provenance-based, and it is already enforced downstream:
  //   - `sLFa/sRFa/sSB` below return null unless the CLINICAL gate is open, so
  //     no narrative, pattern, therapy or score can consume an estimate;
  //   - each value carries `computed`/`estimated` provenance so every surface
  //     must label it as a HumanOS estimate, never as a vendor value;
  //   - values that were genuinely impossible to compute are already `null`
  //     with `unavailable` provenance from `analyzePhase`.
  // Only phases whose estimator declined to produce a number are null here.
  // Shared clause so no surface can claim the spectral values are simply
  // "not reproducible" while the payload publishes computed estimates.
  const EST_CLAUSE =
    " — the values shown are HumanOS estimates computed from this recording's" +
    " R-R series, which are not vendor-reported and not validated against" +
    " PhysioPS output, so they are charted but not interpreted clinically here";
  const spectralEstimated = phaseEvents.some(
    (ph) =>
      ph.provenance?.LFa.method === "computed" ||
      ph.provenance?.RFa.method === "computed",
  );
  /** Where the published spectral numbers came from, for every surface to read. */
  const spectralSource: "vendor_reported" | "humanos_estimated" | "unavailable" =
    spectralAvailable ? "vendor_reported" : spectralEstimated ? "humanos_estimated" : "unavailable";
  const spectralEstimateConfidence = spectralEstimated
    ? Math.max(
        0,
        ...phaseEvents.map((ph) => (ph.LFa != null || ph.RFa != null ? ph.spectralEstimate?.confidence ?? 0 : 0)),
      )
    : null;
  const spectralEstimateWarnings = Array.from(
    new Set(phaseEvents.flatMap((ph) => ph.spectralEstimate?.warnings ?? [])),
  );

  // CLINICAL-CONSUMER COPY. Everything that can produce a clinical conclusion —
  // the composite wellness index, the body-system impact cards and the
  // indication detector — reads THIS copy, in which spectral values are null
  // unless they passed the clinical provenance gate. Charts, trends and the
  // published `phaseEvents` keep the estimates (clearly labelled). This is what
  // lets a raw measurable trend be preserved while the composite score is
  // withheld, without the estimate ever leaking into a diagnosis or a number
  // that the patient would read as a finding.
  const phaseEventsClinical: PhaseMetrics[] = phaseEvents.map((p) => ({
    ...p,
    LFa: spectralAvailable && !!p.provenance && mayInterpretClinically(p.provenance.LFa) ? p.LFa : null,
    RFa: spectralAvailable && !!p.provenance && mayInterpretClinically(p.provenance.RFa) ? p.RFa : null,
    SB: spectralAvailable && !!p.provenance && mayInterpretClinically(p.provenance.SB) ? p.SB : null,
  }));

  // Numeric accessors that are safe under the availability gate. When spectral
  // is unavailable these return null so no comparison can silently treat a
  // fabricated 0 as a real low value.
  // The gate is TWO-part and both parts are necessary:
  //   1. the study-level `spectralAvailable` gate (a paired vendor report exists),
  //   2. THIS phase's OWN provenance being clinically interpretable.
  // Part 2 is what stops a HumanOS waveform estimate for phases the vendor did
  // not supply from being classified as a Low/Normal/Abnormal response once the
  // baseline unlocks the study-level gate.
  const clinicalSpectral = (
    p: PhaseMetrics,
    key: "LFa" | "RFa" | "SB",
  ): number | null => {
    if (!spectralAvailable) return null;
    const prov = p.provenance?.[key];
    // No provenance record at all ⇒ we cannot vouch for the number ⇒ not
    // clinically usable. Fail closed.
    if (!prov || !mayInterpretClinically(prov)) return null;
    const v = p[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const sLFa = (p: PhaseMetrics): number | null => clinicalSpectral(p, "LFa");
  const sRFa = (p: PhaseMetrics): number | null => clinicalSpectral(p, "RFa");
  const sSB = (p: PhaseMetrics): number | null => clinicalSpectral(p, "SB");

  // Classify patient-reported (or computed) Ewing ratios
  const age = data.age;
  // Ewing time-domain ratios are ONE-SIDED (greater-than) normals: a value at
  // or above the Colombo threshold is Normal. Using the two-sided `classify`
  // here was the S1-3 defect (values comfortably above threshold were flagged
  // "Borderline Low"). Thresholds come from the single source of truth.
  // Thresholds are resolved for THIS patient's age from the single authoritative
  // age-specific ratio reference table. A null ratio yields a null
  // classification — never a fabricated "Normal" and never a 0.00 "Low".
  const ageOrNull = data.age > 0 ? data.age : null;
  const eiT = ewingThresholdForAge("eiRatio", ageOrNull);
  const valT = ewingThresholdForAge("valsalvaRatio", ageOrNull);
  const tfT = ewingThresholdForAge("thirtyFifteenRatio", ageOrNull);
  const toClassification = (
    value: number | null,
    t: typeof eiT,
  ): Classification | null => {
    if (value == null) return null;
    const c = classifyEwing(value, t);
    return { label: c.label, severity: c.severity, value, lo: t.normalAbove, hi: Infinity };
  };
  const ratios = {
    eiRatio: { value: data.eiRatio, normal: ratioReferenceLabel("eiRatio", ageOrNull),
      classification: toClassification(data.eiRatio, eiT) },
    valsalvaRatio: { value: data.valsalvaRatio, normal: ratioReferenceLabel("valsalvaRatio", ageOrNull),
      classification: toClassification(data.valsalvaRatio, valT) },
    thirtyFifteenRatio: { value: data.thirtyFifteenRatio, normal: ratioReferenceLabel("thirtyFifteenRatio", ageOrNull),
      classification: toClassification(data.thirtyFifteenRatio, tfT) },
  };

  // Dysfunction patterns (driven by Colombo rules from the PDF)
  const HR_n = norm("HR", age);
  const SB_n = norm("SB", age);
  const RFa_n = norm("RFa", age);
  const LFa_n = norm("LFa", age);

  // HR-only patterns are always supported (ECG-derived, consensus tier).
  // Bradycardia uses a VALIDATED clinical threshold (resting HR < 50 bpm), not
  // the P10 normative band. The percentile floor (~56 at age 60) mislabeled a
  // vendor-"Normal" resting HR of 56 as "slow"; a resting HR in the 50–60 range
  // is within normal limits and must not be called bradycardia. Aligns with the
  // < 50 cutoff already used by the syncope-risk indications.
  const BRADYCARDIA_BPM = 50;
  // TRI-STATE from here down. `resolvePattern(assessable, predicate)` returns
  // null when the inputs were never captured, so `false` always means "assessed
  // and absent". An unusable ECG makes even the HR-derived patterns
  // unassessable: the beat series that produced the rate is not trustworthy.
  const ecgUsableForPatterns = data.ecgQuality ? data.ecgQuality.usable : true;
  const restingHrAssessable = ecgUsableForPatterns && A.meanHR != null && A.meanHR > 0;
  const standHrAssessable = ecgUsableForPatterns && F.meanHR != null && F.meanHR > 0;
  const bradycardia = resolvePattern(
    restingHrAssessable,
    () => (A.meanHR as number) < BRADYCARDIA_BPM,
  );
  const hrDelta = restingHrAssessable && standHrAssessable
    ? standDeltaBpm(A.meanHR, F.meanHR)
    : null;
  const POTS = resolvePattern(hrDelta != null, () => (hrDelta as number) >= 30);
  // FRF norm band is the single source of truth (Colombo 0.09–0.15 Hz). FRF is
  // a proprietary [P] framing — gate it on spectral availability too.
  // FRF is now ESTIMATED from the ECG envelope for every phase. An estimate is
  // fine to display, but the Colombo FRF norm band was defined on the vendor's
  // own measurement, so a pattern (and any narrative derived from it) requires
  // clinically-interpretable provenance for THIS phase — otherwise the pattern
  // stays UNRESOLVED rather than becoming a finding.
  const highFRF = resolvePattern(
    spectralAvailable && B.FRF != null && !!B.provenance && mayInterpretClinically(B.provenance.FRF),
    () => (B.FRF as number) > COLOMBO_NORMS.FRF.hi,
  );

  // --- SPECTRAL-GATED patterns ------------------------------------------------
  // Every pattern below depends on LFa/RFa/SB. When spectral is unavailable they
  // are ALL false — we never coerce a null spectral value to 0 and read it as a
  // "low" finding. This is what previously produced the spurious Parasympathetic
  // Excess / Advanced Autonomic Neuropathy on a raw ECG-only file.
  const A_SB = sSB(A), A_RFa = sRFa(A), A_LFa = sLFa(A);
  const B_RFa = sRFa(B);
  const D_LFa = sLFa(D);
  // Standing (F) spectral is only usable when the STAND phase's OWN provenance is
  // clinically interpretable — not when only the baseline was vendor-reported and
  // the standing values are computed estimates. sF*() enforce that.
  const sfLFa = (p: PhaseMetrics): number | null => (standSpectralAvailable ? (p.LFa as number) : null);
  const sfRFa = (p: PhaseMetrics): number | null => (standSpectralAvailable ? (p.RFa as number) : null);
  const F_RFa = sfRFa(F), F_LFa = sfLFa(F);

  // ==========================================================================
  // TRI-STATE PATTERN RESOLUTION
  // ==========================================================================
  // THE FIX AT THE HEART OF THIS REPAIR. Previously every expression below was a
  // plain boolean: with LFa/RFa/SB unavailable they all evaluated to `false`, and
  // the report published "sympatheticExcess: false", "preSyncopeRisk: false",
  // "advancedAutonomicDysfunction: false" for domains the SAME payload declared
  // unassessable. On the Alex Pare recording the vendor clinician documented
  // Sympathetic Excess, pre-clinical syncope risk and Advanced Autonomic
  // Dysfunction — so those `false` values were affirmative false negatives.
  //
  // Each pattern now carries its own assessability precondition and resolves to
  // `null` when the inputs were never captured. Missing proprietary vendor
  // LFa/RFa/SB data is NEVER interpreted as normal or absent.
  const parasympatheticDominance = resolvePattern(
    A_SB != null && A_SB > 0,
    () => (A_SB as number) < SB_n.lo,
  );
  const dbRFaLow = B_RFa != null && B_RFa < 19; // Jill's PDF DB norm 19.97-70.79
  const parasympatheticExcess = resolvePattern(
    F_RFa != null && A_RFa != null,
    () => (F_RFa as number) > RFa_n.hi * 0.8 || (F_RFa as number) > (A_RFa as number) * 1.2,
  );
  const parasympatheticWithdrawal = resolvePattern(
    A_RFa != null,
    () => (A_RFa as number) < RFa_n.lo,
  );
  const sympatheticExcess = resolvePattern(
    F_LFa != null,
    () => (F_LFa as number) > LFa_n.hi,
  );
  const sympatheticWithdrawal = resolvePattern(
    F_LFa != null && A_LFa != null,
    () => (F_LFa as number) < (A_LFa as number) * 0.9,
  );
  // A composite pattern is only assessable when BOTH of its inputs were.
  const maskedSW = resolvePattern(
    parasympatheticExcess !== null && sympatheticWithdrawal !== null,
    () => parasympatheticExcess === true && sympatheticWithdrawal === true,
  );
  const preSyncopeRisk = resolvePattern(
    D_LFa != null && F_LFa != null,
    () => (F_LFa as number) > (D_LFa as number) * 0.9, // stand peak ≈ valsalva
  );
  // Orthostatic hypotension requires real BASELINE AND STANDING cuff BP, and a
  // genuine drop between them. Without both arms it is NOT ASSESSABLE (null) —
  // it used to be reported as `false`, i.e. "no orthostatic hypotension".
  const orthostaticHypotension = resolvePattern(
    orthostaticBpAssessable,
    () =>
      ((A.SBP as number) - (F.SBP as number)) >= 20 ||
      ((A.DBP as number) - (F.DBP as number)) >= 10,
  );
  const vasovagalRisk = resolvePattern(
    F_RFa != null && F_LFa != null,
    () => (F_RFa as number) > (F_LFa as number),
  );
  const advancedAutonomicDysfunction = resolvePattern(
    parasympatheticWithdrawal !== null && sympatheticWithdrawal !== null,
    () => parasympatheticWithdrawal === true && sympatheticWithdrawal === true,
  );
  const CAN = resolvePattern(
    advancedAutonomicDysfunction !== null && ratios.eiRatio.classification !== null,
    () =>
      advancedAutonomicDysfunction === true &&
      ratios.eiRatio.classification?.severity === "Abnormal",
  );

  const patterns: DysfunctionPatterns = {
    parasympatheticDominance, parasympatheticExcess, parasympatheticWithdrawal,
    sympatheticExcess, sympatheticWithdrawal, maskedSW,
    advancedAutonomicDysfunction, CAN, POTS, orthostaticHypotension,
    vasovagalRisk, preSyncopeRisk, bradycardia, highFRF,
  };

  // Build Colombo phase findings (EXACTLY in the PDF narrative style)
  const phaseFindings: PhaseFinding[] = [];
  const baselineFindings: string[] = [];
  if (bradycardia) baselineFindings.push(`Low HR (possible Bradycardia) — ${A.meanHR} bpm${data.baselineSystolicBP ? ` and ${A.SBP && A.SBP >= 90 && A.SBP <= 120 ? "Normal" : A.SBP && A.SBP < 90 ? "Low" : "Borderline"} BP` : ""}`);
  else baselineFindings.push(`Normal HR and ${data.baselineSystolicBP ? "Normal" : "unreported"} BP`);
  // Spectral (LFa/RFa/SB) modulation findings are only emitted when the
  // proprietary aggregates are clinically available. Otherwise we state, once,
  // that they were not assessed — never a fabricated Normal/Low classification.
  // Per-phase classification: only classify a phase's spectral value when THAT
  // phase actually carries it (non-null). The global spectralAvailable gate is
  // necessary but NOT sufficient — with baseline-only vendor metrics it is true
  // while phases B–F are still null.
  const lfaA = classifyOrNull(sLFa(A), LFa_n.lo, LFa_n.hi);
  const rfaA = classifyOrNull(sRFa(A), RFa_n.lo, RFa_n.hi);
  if (spectralAvailable && (lfaA || rfaA)) {
    if (lfaA) {
      if (lfaA.label === "Borderline Low") baselineFindings.push("Borderline low sympathetic modulation (LFa)");
      else if (lfaA.severity === "Normal") baselineFindings.push("Normal sympathetic modulation (LFa)");
      else baselineFindings.push(`${lfaA.label} sympathetic modulation (LFa)`);
    }
    if (rfaA) {
      if (rfaA.severity === "Normal") baselineFindings.push("Normal parasympathetic modulation (RFa)");
      else baselineFindings.push(`${rfaA.label} parasympathetic modulation (RFa)`);
    }
    if (parasympatheticDominance) {
      // Describe the low ratio by its driver (generic) — reduced sympathetic
      // modulation vs genuine parasympathetic excess — WITHOUT asserting
      // unsupported daily-life symptoms (those require captured symptoms).
      const driver = classifyLowSbDriver(sLFa(A) as number, sRFa(A) as number);
      baselineFindings.push(
        driver === "parasympathetic-excess" || driver === "mixed"
          ? "Low sympathovagal balance (SB = LFa/RFa) with elevated RFa — genuinely high parasympathetic (vagal) activity. Interpret with the patient's symptoms and history."
          : "Low sympathovagal balance (SB = LFa/RFa) driven by low/low-normal LFa with normal RFa — a relative parasympathetic dominance (reduced sympathetic modulation), not parasympathetic excess. Interpret with the patient's symptoms and history.",
      );
    }
  } else {
    baselineFindings.push(
      spectralEstimated
        ? "Sympathetic/parasympathetic spectral measures (LFa/RFa/SB) not assessed clinically" + EST_CLAUSE + ". Clinician review of the signed vendor report is required for vendor-reported spectral interpretation."
        : "Sympathetic/parasympathetic spectral measures (LFa/RFa/SB) not assessed — not established for this recording. Clinician review of the vendor report is required for spectral interpretation.",
    );
  }
  phaseFindings.push({ phase: "INITIAL BASELINE", indication: "Indication of balance in the patient's Autonomic Nervous System (ANS) and protection of the heart", findings: baselineFindings });

  const dbFindings: string[] = [];
  // Per-phase-null-safe: lfaD/rfaD/lfaF are null unless THAT phase carries a
  // usable spectral value, so neither the findings below nor the impression
  // counting can treat a missing value as "Abnormal". (Under baseline-only
  // vendor metrics these are null even though spectralAvailable is true.)
  const lfaD = classifyOrNull(sLFa(D), LFa_n.lo, LFa_n.hi);
  const rfaD = classifyOrNull(sRFa(D), RFa_n.lo, RFa_n.hi);
  const lfaF = classifyOrNull(sfLFa(F), LFa_n.lo, LFa_n.hi);
  // "DB RFa low" is only a real finding when B's RFa was actually captured.
  const dbSpectralAssessed = B_RFa != null;
  const valsalvaSpectralAssessed = lfaD != null || rfaD != null;
  if (spectralAvailable && (dbSpectralAssessed || valsalvaSpectralAssessed || highFRF)) {
    if (highFRF) {
      dbFindings.push(`NOTE: Fundamental Respiratory Frequency (FRF) is high during DB (${(B.FRF as number).toFixed(2)} Hz; Normal: 0.09–0.15) which may artificially reduce the parasympathetic measure. High FRF may be associated with upper respiratory or pulmonary disorder and anxiety. Consider treating the patient and retesting to obtain the true interpretation for the DB phase.`);
    }
    if (dbSpectralAssessed) {
      if (dbRFaLow) dbFindings.push("Low parasympathetic response (RFa) to DB suggesting possible autonomic dysfunction");
      else dbFindings.push("Normal parasympathetic response (RFa) to DB");
    }
    if (lfaD) dbFindings.push(`${lfaD.severity === "Normal" ? "Normal" : lfaD.label} sympathetic response (LFa) to Valsalva`);
    if (rfaD) dbFindings.push(`${rfaD.severity === "Normal" ? "Normal" : rfaD.label} parasympathetic response (RFa) to Valsalva`);
    if (!dbSpectralAssessed && !valsalvaSpectralAssessed) {
      dbFindings.push("Spectral responses to Deep Breathing and Valsalva (LFa/RFa) not assessed for these phases — the vendor report supplied baseline values only.");
    }
  } else {
    dbFindings.push(
      spectralEstimated
        ? "Spectral responses to Deep Breathing and Valsalva (LFa/RFa) not assessed clinically" + EST_CLAUSE + "."
        : "Spectral responses to Deep Breathing and Valsalva (LFa/RFa) not assessed — not established for this recording.",
    );
  }
  // The E/I ratio is the cardiovagal Ewing measure of the Deep-Breathing phase —
  // ECG-derived and always computed, so it is a SUPPORTED observation reported
  // here regardless of spectral availability (never suppressed with the spectral
  // aggregates). The Valsalva ratio is likewise the Ewing measure of the Valsalva
  // phase.
  {
    const ei = ratios.eiRatio;
    const val = ratios.valsalvaRatio;
    // A null ratio is reported as NOT PRESENT — never as a normal finding.
    dbFindings.push(
      ei.value == null || ei.classification == null
        ? "E/I ratio not present in this file — deep-breathing cardiovagal response not assessed."
        : `${ei.classification.severity === "Normal" ? "Normal" : ei.classification.label} E/I ratio (deep-breathing cardiovagal response) = ${ei.value.toFixed(2)} (${ei.normal})`,
    );
    dbFindings.push(
      val.value == null || val.classification == null
        ? "Valsalva ratio not present in this file — Valsalva cardiovagal response not assessed."
        : `${val.classification.severity === "Normal" ? "Normal" : val.classification.label} Valsalva ratio (cardiovagal response) = ${val.value.toFixed(2)} (${val.normal})`,
    );
  }
  phaseFindings.push({ phase: "DEEP BREATHING (DB) AND VALSALVA RESPONSES", indication: "Detection of early signs of autonomic dysfunction and chronic disease", findings: dbFindings });

  const standFindings: string[] = [];
  // Standing spectral findings require the STAND phase's own spectral values —
  // gated on standSpectralAvailable (true only when F's provenance is
  // clinically interpretable), NOT the global spectralAvailable (which is true
  // for a baseline-only vendor override while F stays null). lfaF is per-phase
  // null-safe. preSyncope/vasovagal/parasympatheticExcess already derive from
  // sfLFa/sfRFa which enforce the same gate.
  if (standSpectralAvailable && lfaF) {
    standFindings.push(`${lfaF.severity === "Normal" ? "Normal" : lfaF.label} sympathetic response (LFa) to stand`);
    if (preSyncopeRisk) standFindings.push('A higher peak sympathetic response (LFa) to stand compared to the response during Valsalva suggesting a possible risk of pre-syncope [Check "HR" and "Trends" plot and EKG Report to rule out ectopy]');
    if (vasovagalRisk) standFindings.push("Relatively higher parasympathetic activation (RFa) compared to sympathetic activation (LFa) throughout the test suggesting risk of possible vasovagal pre-syncope");
    if (parasympatheticExcess) standFindings.push("High parasympathetic activation (RFa) indicating excess parasympathetic activity ** [Check for symptoms such as unstable BP and dizziness]");
  } else {
    standFindings.push(
      spectralEstimated
        ? "Spectral response to standing (LFa/RFa) not assessed clinically" + EST_CLAUSE + "."
        : "Spectral response to standing (LFa/RFa) not assessed — not established for this recording.",
    );
  }
  // HR response to standing. The HR delta itself IS ECG-derived, but grading it
  // as "Normal" vs "Insufficient" is an orthostatic judgment that requires
  // standing blood-pressure context (an insufficient HR rise is only abnormal
  // alongside a BP drop / symptoms). The .ans has no standing BP, so WITHOUT
  // that evidence we report the measured delta as a neutral OBSERVATION and say
  // the orthostatic adequacy is not assessed — never assert "Insufficient".
  // POTS (>=30 bpm rise) is a validated HR-ONLY criterion and is retained.
  if (hrDelta == null) {
    standFindings.push(
      "Heart-rate change on standing not assessed — a usable resting and standing beat series was not available on this recording.",
    );
  } else if (POTS === true) {
    standFindings.push(`Excessive HR rise of ${hrDelta} bpm on standing — meets the POTS heart-rate criterion (≥30 bpm); correlate with symptoms and standing BP.`);
  } else if (orthostaticBpAssessable) {
    // Standing BP is available (paired vendor/measured) → an adequacy verdict is supported.
    if (hrDelta >= 10) standFindings.push(`Normal HR response to standing (Δ+${hrDelta} bpm).`);
    else standFindings.push(`Blunted HR response to standing (Δ${hrDelta >= 0 ? "+" : ""}${hrDelta} bpm) with the available orthostatic BP.`);
  } else {
    standFindings.push(`Heart-rate change on standing: Δ${hrDelta >= 0 ? "+" : ""}${hrDelta} bpm (observed). Orthostatic adequacy not assessed — standing blood pressure was not recorded in this .ans; correlate with a cuff BP / the vendor report.`);
  }
  phaseFindings.push({ phase: "STAND RESPONSES", indication: "Indication of proper autonomic coordination and possible causes of dizziness", findings: standFindings });

  // Overall impression — Colombo PDF counting rule.
  // Only strict abnormalities to DB / Valsalva / Stand challenges count here.
  // PE on stand is noted separately as a pattern (may mask SW) but does not
  // increment the challenge count unless stand LFa is also abnormal.
  const dbAbnormal = dbRFaLow || (rfaD?.severity === "Abnormal");
  const valsalvaAbnormal = (lfaD?.severity === "Abnormal" && lfaD?.label === "Low");
  const standAbnormalSpectral = (lfaF?.severity === "Abnormal" && lfaF?.label === "Low") || preSyncopeRisk;
  const standAbnormal = standAbnormalSpectral || POTS || orthostaticHypotension;
  const challenges: string[] = [];
  if (dbAbnormal) challenges.push("the parasympathetic response (RFa) during DB is low");
  if (valsalvaAbnormal) challenges.push("the sympathetic response (LFa) during Valsalva is abnormal");
  if (standAbnormal) challenges.push("the response to standing is abnormal");
  const abnormalChallengeCount = challenges.length;
  // A challenge is ASSESSED only when its spectral input (or, for stand, HR/BP)
  // was actually captured. With baseline-only vendor metrics, none of the DB /
  // Valsalva / stand spectral responses are assessed, so the dysfunction-grading
  // ladder below must NOT run — it would read the absence of abnormalities as
  // "normal autonomic function" or (worse, via the old null-classify bug)
  // fabricate "advanced autonomic dysfunction". standSpectralAvailable / POTS /
  // orthostaticBpAssessable make the stand challenge assessable on HR/BP alone.
  const dbChallengeAssessed = dbSpectralAssessed;
  const valsalvaChallengeAssessed = valsalvaSpectralAssessed;
  // The dysfunction-grading ladder is a spectral + orthostatic-BP construct; it
  // runs only when at least one of those challenge measures was actually
  // captured. HR-only findings (POTS / bradycardia) are surfaced in the
  // supported-observations text via hrNote regardless.
  const anyChallengeAssessed =
    dbChallengeAssessed || valsalvaChallengeAssessed || standSpectralAvailable || orthostaticBpAssessable;
  let overall: string;
  if (!spectralAvailable || !anyChallengeAssessed) {
    // With only ECG-derived HR + Ewing ratios, we can only report those
    // supported observations — never an autonomic-dysfunction grading that
    // depends on spectral challenge responses.
    const abnormalRatios: string[] = [];
    if (ratios.eiRatio.classification?.severity === "Abnormal") abnormalRatios.push("E/I ratio");
    if (ratios.valsalvaRatio.classification?.severity === "Abnormal") abnormalRatios.push("Valsalva ratio");
    if (ratios.thirtyFifteenRatio.classification?.severity === "Abnormal") abnormalRatios.push("30:15 ratio");
    const hrNote = POTS === true
      ? ` Heart-rate rise on standing (${hrDelta} bpm) meets the POTS threshold and warrants clinician review.`
      : bradycardia === true
        ? ` Resting heart rate is low (${A.meanHR} bpm).`
        : "";
    overall = abnormalRatios.length === 0
      ? `Supported observations only: cardiovagal Ewing ratios are within normal limits and heart rate/phase timing were ECG-derived.${hrNote} Spectral (sympathetic/parasympathetic) and blood-pressure measures were not assessed and require clinician review of the vendor report — no autonomic-neuropathy or sympathovagal interpretation can be made from this recording.`
      : `Supported observations only: ${abnormalRatios.join(", ")} outside normal limits on the cardiovagal Ewing ratios.${hrNote} Spectral and blood-pressure measures were not assessed and require clinician review — no autonomic-neuropathy or sympathovagal interpretation can be made from this recording.`;
  } else if (abnormalChallengeCount === 0) overall = "No significant abnormalities in autonomic challenges — normal autonomic function.";
  else if (abnormalChallengeCount === 1) overall = `Abnormal responses to autonomic challenges (DB, Valsalva, or standing) suggest autonomic dysfunction. Since only ${challenges[0]}, mild autonomic dysfunction is possible.`;
  else if (abnormalChallengeCount === 2) overall = "Abnormal responses to multiple autonomic challenges suggest moderate autonomic dysfunction.";
  else overall = "Abnormal responses across all autonomic challenges suggest advanced autonomic dysfunction.";

  // Clinician DISCUSSION TOPICS — NON-PRESCRIPTIVE.
  //
  // SAFETY: this tool must NOT emit automatic, individualized medication or
  // supplement recommendations with dosages from an uploaded test alone (that
  // would be prescribing without a licensed clinician). We therefore surface
  // pattern-relevant TOPICS a clinician may consider, with NO dose/frequency and
  // NO "take this" framing. Every card states that any therapy requires a
  // licensed clinician's assessment. Named agents/classes appear only as
  // "topics a clinician may discuss", never as instructions to the patient.
  const therapies: TherapyRecommendation[] = [];
  const contraindications: string[] = [];

  const CLINICIAN_ONLY = "Any therapy — including supplements, lifestyle programs, and medications — requires assessment and a prescription/plan from a licensed clinician who has reviewed the full history. This report does not prescribe or recommend a dose.";

  // Still gate on spectral availability: when spectral/BP are not assessable we
  // cannot even suggest relevant topics tied to those measures.
  const canDiscussTopics = spectralAvailable;
  if (!canDiscussTopics) {
    therapies.push({
      category: "Clinician review",
      intervention: "Insufficient data for treatment topics — clinician review required",
      rationale:
        "The proprietary spectral measures (LFa/RFa/SB) and continuous blood pressure were not assessable from this recording, so no autonomic pattern can be characterized here. " +
        CLINICIAN_ONLY,
      priority: "primary",
    });
  }

  // Genuine parasympathetic excess (RFa elevated) — discussion topic only.
  if (canDiscussTopics && parasympatheticExcess) {
    therapies.push({
      category: "Discussion topic",
      intervention: "Discuss parasympathetic-excess management with your clinician",
      rationale:
        "The standing spectral pattern is consistent with elevated parasympathetic activity. A clinician may discuss options (which can include lifestyle measures or, at their discretion, medication). " +
        CLINICIAN_ONLY,
      priority: "primary",
    });
  }

  // Low sympathovagal balance at rest (relative parasympathetic dominance) —
  // discussion topic only, no target-and-medicate instruction.
  if (canDiscussTopics && parasympatheticDominance) {
    therapies.push({
      category: "Discussion topic",
      intervention: "Discuss the low resting sympathovagal balance with your clinician",
      rationale:
        "Resting sympathovagal balance is below the usual range, reflecting reduced sympathetic modulation rather than parasympathetic excess. Whether anything should be done, and what, is a clinical decision. " +
        CLINICIAN_ONLY,
      priority: "primary",
    });
  }

  // Neuroprotective / antioxidant discussion (e.g. alpha-lipoic acid) — TOPIC
  // ONLY, NO DOSE. Named as something a clinician may discuss for autonomic
  // findings; explicitly not a recommendation or dosage from this tool.
  const neuroTopicCandidate = canDiscussTopics && (advancedAutonomicDysfunction || parasympatheticWithdrawal
    || parasympatheticExcess || sympatheticWithdrawal || sympatheticExcess
    || parasympatheticDominance);
  if (neuroTopicCandidate) {
    therapies.push({
      category: "Discussion topic",
      intervention: "Ask your clinician whether neuroprotective/antioxidant support is appropriate",
      rationale:
        "For autonomic findings, some clinicians discuss neuroprotective/antioxidant approaches (e.g. alpha-lipoic acid). Appropriateness, product, and dose — if any — are decisions for a licensed clinician who has reviewed your history and blood pressure. " +
        CLINICIAN_ONLY,
      priority: "secondary",
    });
  }

  // Orthostatic-symptom lifestyle discussion (hydration / salt) — TOPIC ONLY,
  // NO DOSE. Only when an orthostatic/syncope pattern is genuinely present.
  if (canDiscussTopics && (POTS || orthostaticHypotension || preSyncopeRisk || vasovagalRisk)) {
    therapies.push({
      category: "Discussion topic",
      intervention: "Discuss orthostatic-symptom strategies with your clinician",
      rationale:
        "The pattern can be associated with orthostatic symptoms. Fluid/salt and other measures are sometimes discussed, but the plan (and any limits, e.g. blood pressure or cardiac/renal considerations) must come from a licensed clinician. " +
        CLINICIAN_ONLY,
      priority: "primary",
    });
  }

  // Graded-activity discussion (PE or SE) — TOPIC ONLY, NO PRESCRIPTION.
  if (canDiscussTopics && (parasympatheticExcess || sympatheticExcess)) {
    therapies.push({
      category: "Discussion topic",
      intervention: "Discuss a graded, low-intensity activity plan with your clinician",
      rationale:
        "Gentle graded activity is sometimes used to help retrain autonomic responses. Any program should be designed with a licensed clinician appropriate to your fitness and symptoms. " +
        CLINICIAN_ONLY,
      priority: "secondary",
    });
  }

  // Default when nothing flags.
  if (therapies.length === 0) {
    therapies.push({
      category: "Monitoring",
      intervention: "No specific concern flagged from this test",
      rationale:
        "No pattern above required a discussion topic. Continue routine care. " + CLINICIAN_ONLY,
      priority: "optional",
    });
  }

  // Follow-up
  let retestInterval = "6 months";
  let followUpRationale = "Re-test in 6 months to follow up.";
  if (parasympatheticExcess || parasympatheticWithdrawal || sympatheticExcess || sympatheticWithdrawal) {
    retestInterval = "3 months";
    followUpRationale = "If therapy is added or changed, re-test in 3 months to check response to therapy. Otherwise re-test in 6 months.";
  }

  // Wellness
  // Wellness runs on the CLINICALLY-GATED copy: a waveform-derived estimate must
  // never contribute to (or unlock) the composite index. When spectral is only
  // estimated the sympathovagal sub-domain stays `available: false`, its weight
  // is NOT redistributed, and the composite is withheld as not-scorable.
  const breakdown = computeWellness(data, phaseEventsClinical, patterns);
  // NO SCORE when the composite is not scorable. `Math.round(null)` used to be
  // impossible to reach because `final` was always a number; now the absence is
  // explicit and propagates to wellnessScore / wellnessTier as null.
  const score = breakdown.final == null ? null : Math.round(breakdown.final);
  const tier = tierFromScore(score);
  if (breakdown.scorability.scorable === false) {
    const hasSupportedDiscussionTopic = therapies.some(
      (recommendation) => recommendation.category === "Discussion topic",
    );
    if (!hasSupportedDiscussionTopic) {
      therapies.splice(0, therapies.length, {
        category: "Monitoring",
        intervention: "Insufficient data for automated intervention recommendation — clinician review required",
        rationale:
          "The study is not scorable because essential inputs are missing or unusable. Review the measurable observations, missing domains, acquisition quality, and any attached vendor findings with the treating clinician before deciding care or retest timing. " +
          CLINICIAN_ONLY,
        priority: "optional",
      });
    }
    retestInterval = "Clinician-directed";
    followUpRationale =
      "Retest timing cannot be determined from an unscorable study. The treating clinician should choose whether and when to repeat testing after reviewing acquisition quality, symptoms, history, and any attached vendor report.";
  }

  let riskLevel = spectralAvailable ? "Normal" : "Not assessed — spectral/BP data unavailable";
  if (advancedAutonomicDysfunction) riskLevel = "High — Advanced Autonomic Dysfunction";
  else if (CAN) riskLevel = "High — Cardiovascular Autonomic Neuropathy";
  else if (POTS) riskLevel = "Moderate — POTS (HR-based; requires clinician review)";
  else if (preSyncopeRisk || orthostaticHypotension) riskLevel = "Moderate — Pre-syncope/Orthostatic";
  else if (parasympatheticExcess || sympatheticExcess || parasympatheticDominance) riskLevel = "Mild — Autonomic Imbalance";
  else if (highFRF || dbRFaLow) riskLevel = "Low — Borderline Findings";

  // Energy level is a spectral-derived qualitative label — only assert it when
  // spectral is available. Otherwise default to a neutral "Moderate" without an
  // interpretive claim (the UI shows "Not assessed" copy alongside).
  const energyLevel: ANSReport["energyLevel"] =
    !spectralAvailable ? "Moderate" :
    (parasympatheticDominance && bradycardia) ? "Low" :
    (parasympatheticExcess || sympatheticExcess) ? "Moderate" : "High";

  // Driver-aware balance interpretation. A low SB with normal RFa reflects
  // REDUCED SYMPATHETIC MODULATION (relative parasympathetic dominance), not a
  // "prolonged rest-and-digest state" and not an excess — and it asserts NO
  // symptoms (those require captured symptoms).
  const balanceInterpretation = (): string => {
    if (parasympatheticDominance) {
      const driver = classifyLowSbDriver(sLFa(A) as number, sRFa(A) as number);
      if (driver === "parasympathetic-excess" || driver === "mixed") {
        return "Relatively parasympathetic-leaning balance with genuinely elevated parasympathetic (vagal) activity. This is a measurement pattern — discuss its meaning with your clinician.";
      }
      return "Relative parasympathetic dominance: the low sympathovagal balance reflects reduced sympathetic modulation, with parasympathetic (vagal) activity within normal limits. This is a measurement pattern, not an excess — discuss its meaning with your clinician.";
    }
    if (parasympatheticExcess) {
      return "Parasympathetic activity rose on standing when it would normally step down. This is a measurement pattern — discuss its meaning with your clinician.";
    }
    return "Balanced sympathovagal tone.";
  };
  const autonomicBalance = spectralAvailable
    ? {
        parasympathetic: A.RFa as number,
        sympathetic: A.LFa as number,
        balance: A.SB as number,
        available: true,
        interpretation: balanceInterpretation(),
      }
    : {
        // Never coerce missing spectral to 0 / a 0-100 split. The UI renders
        // "Not assessed" from these nulls.
        parasympathetic: null,
        sympathetic: null,
        balance: null,
        available: false,
        interpretation: spectralEstimated
          ? "Sympathetic vs parasympathetic balance not assessed clinically" + EST_CLAUSE + ". Clinician review of the signed vendor report is required for a vendor-reported balance."
          : "Sympathetic vs parasympathetic balance not assessed — the spectral measures (LFa/RFa/SB) were not established for this recording. Clinician review of the vendor report is required.",
      };

  const clinicalFlags: string[] = [];
  if (highFRF === true && B.FRF != null) clinicalFlags.push(`High FRF during DB (${B.FRF.toFixed(2)} Hz) — recommend retest with relaxed breathing`);
  if (data.ectopicBeats > 0) clinicalFlags.push(`${data.ectopicBeats} possible ectopic beat(s) detected`);
  if (bradycardia === true) clinicalFlags.push(`Bradycardia: resting HR ${A.meanHR} bpm`);
  if (parasympatheticDominance === true) clinicalFlags.push(`Parasympathetic dominance: SB = ${A.SB}`);
  if (!spectralAvailable) {
    clinicalFlags.push(
      spectralEstimated
        ? "Spectral measures (LFa/RFa/SB) shown for this recording are HumanOS estimates computed from the raw waveform — they are NOT vendor-reported, have NOT been validated against PhysioPS output, and do not drive any clinical conclusion or score here. Continuous BP was not recorded. Clinician review of the signed vendor report is required for vendor values."
        : "Spectral measures (LFa/RFa/SB) and continuous BP not assessed — not reproducible from this recording; clinician review of the vendor report required.",
    );
  }

  // --- Watch items — ONLY from abnormal MEASURED/verified fields --------------
  // Never watch a value that is already normal, a field that was not read, or
  // symptoms the test did not capture. Each item corresponds to a genuinely
  // out-of-range measured signal (or an assessed orthostatic finding).
  const monitorParameters: string[] = [];
  if (spectralAvailable) {
    const rfaAbnormal = A.RFa != null && (A.RFa < RFa_n.lo || A.RFa > RFa_n.hi);
    const lfaAbnormal = A.LFa != null && (A.LFa < LFa_n.lo || A.LFa > LFa_n.hi);
    const sbAbnormal = A.SB != null && (A.SB < SB_n.lo || A.SB > SB_n.hi);
    if (rfaAbnormal) monitorParameters.push("Parasympathetic activity (RFa) trending toward the normal range");
    if (lfaAbnormal) monitorParameters.push("Sympathetic modulation (LFa) trending toward the normal range");
    if (sbAbnormal) monitorParameters.push("Sympathovagal balance (SB) trending toward the normal range (0.4–3.0)");
    // FRF only when it was actually READ and is out of range (never when unread).
    if (highFRF === true && B.FRF != null && B.FRF > 0) {
      monitorParameters.push(`FRF during deep breathing (currently ${B.FRF.toFixed(2)} Hz; normal ${COLOMBO_NORMS.FRF.lo}–${COLOMBO_NORMS.FRF.hi} Hz)`);
    }
  }
  // Orthostatic tolerance only when an orthostatic finding was actually assessed
  // and abnormal (requires real standing BP; see orthostaticBpAssessable).
  if (orthostaticBpAssessable && orthostaticHypotension) {
    monitorParameters.push("Orthostatic tolerance (blood-pressure response to standing)");
  }
  if (bradycardia) {
    monitorParameters.push(`Resting heart rate (currently ${A.meanHR} bpm)`);
  }
  // No abnormal measured signal → nothing to watch (honest empty list; the UI
  // hides the section). We do NOT invent generic watch items or symptom claims.

  const bodySystemImpact = computeBodyImpact(patterns, phaseEventsClinical, { spectralAvailable, bpAvailable });

  // Multi-Parameter Graphical data for clinician view. Guarded in try/catch
  // because trend computation is the most expensive and newest code path
  // — if it fails we still want the rest of the report to render.
  let multiParameter: MultiParameterGraphical | undefined;
  try {
    multiParameter = computeMultiParameterGraphical(data, phaseEventsRaw);
  } catch (e) {
    console.error("Multi-parameter graphical computation failed:", e);
    multiParameter = undefined;
  }

  // -- Path B: Colombo indication detection -----------------------------
  const indications = detectIndicationsLocal(phaseEventsClinical, multiParameter, {
    standSpectralAvailable,
    standBpAvailable,
  });

  return {
    patientData: data,
    wellnessScore: score,
    wellnessTier: tier,
    wellnessBreakdown: breakdown,
    riskLevel,
    energyLevel,
    autonomicBalance,
    phaseEvents,
    ratios,
    phaseFindings,
    dysfunctionPatterns: patterns,
    therapyRecommendations: therapies,
    contraindications,
    followUp: {
      retestInterval, rationale: followUpRationale,
      // Watch items are generated ONLY from ABNORMAL measured/verified fields.
      // We never tell the clinician to watch a value that is already normal
      // (e.g. RFa within band), a field that was NOT READ (e.g. FRF unavailable),
      // or symptoms the test never captured. Built above as `monitorParameters`.
      monitorParameters,
    },
    bodySystemImpact,
    clinicalFlags,
    overallImpression: overall,
    samplingRate,
    spectralAvailable,
    spectralSource,
    spectralEstimation: {
      present: spectralEstimated,
      method: spectralEstimated ? "morlet_cwt_bpm2" : null,
      confidence: spectralEstimateConfidence,
      warnings: spectralEstimateWarnings,
      disclosure: spectralEstimated
        ? ESTIMATED_SPECTRAL_NOTE
        : "No waveform-derived spectral estimate was produced for this recording.",
    },
    bpAvailable,
    // CONSISTENT with the per-phase values (previously null here while six
    // per-phase FRF numbers were populated) and explicitly marked ESTIMATED, so
    // no surface can present it as a measured fact.
    respiratoryFrequency: A.FRF,
    respiratory: {
      frequencyHz: A.FRF,
      validation: A.FRF == null ? "unavailable" : "estimated",
      note:
        A.FRF == null
          ? "Respiratory frequency could not be estimated from this recording."
          : "Estimated from the R-peak amplitude envelope (ECG-derived respiration). This is an " +
            "estimate, not a validated spirometric or vendor-reported measurement, and matches the " +
            "per-phase FRF values in phaseEvents.",
    },
    ecgQuality: data.ecgQuality,
    rPeakCount: phaseEvents.reduce(
      (n, p) => n + (p.meanHR == null ? 0 : Math.round(p.meanHR * p.durationSec / 60)),
      0,
    ),
    generatedAt: new Date().toISOString(),
    multiParameter,
    indications,
  };
}

/**
 * Deterministic clinical snapshot of a report: the full object with the
 * non-deterministic ENVELOPE METADATA (`generatedAt`, and the embedded
 * `patientData` / AnsStudy `parsedAt` if present) stripped out. Two runs on the
 * same input bytes produce byte-identical snapshots. Use this for golden-master
 * comparisons and any content hash — never hash the raw report, whose
 * `generatedAt` changes every call.
 */
export function clinicalSnapshot(report: ANSReport): Omit<ANSReport, "generatedAt"> {
  const { generatedAt: _generatedAt, ...rest } = report;
  // Strip parsedAt from any embedded ansStudy-like object without disturbing
  // the clinical fields.
  const anyRest = rest as Record<string, unknown>;
  if (anyRest.ansStudy && typeof anyRest.ansStudy === "object") {
    const { parsedAt: _p, ...study } = anyRest.ansStudy as Record<string, unknown>;
    anyRest.ansStudy = study;
  }
  return rest;
}

// ---- Handler ----------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { buffer: fileBuffer, fileName } = await parseMultipart(req);
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    // SINGLE CANONICAL PATH: the deterministic, provenance-gated api/_ans
    // engine (parseStudy) is the ONLY parser for both /api/parse and
    // /api/upload. We translate the normalized AnsStudy back into the legacy
    // ParsedANSData shape (ansStudyToLegacy) so the Colombo scoring layer is
    // untouched. There is no heuristic-parser fallback: the previous fallback
    // fabricated per-patient values (isJillShah) and demographic defaults, so
    // an honest hard failure is preferred over silently degraded data.
    let patientData;
    let ansStudy: ReturnType<typeof parseStudy>;
    try {
      ansStudy = parseStudy({ buffer: fileBuffer, fileName: fileName ?? "upload.ans" });
      patientData = ansStudyToLegacy(ansStudy, fileBuffer);
    } catch (err: any) {
      console.error("[ans-parser] canonical parse failed:", err?.message ?? err);
      return res.status(422).json({
        success: false,
        error:
          "Could not parse the uploaded .ans file. The file may be corrupt or in an unsupported format.",
        detail: err?.message ?? String(err),
      });
    }
    // Optional paired vendor-PDF metrics: passed as a JSON header so the custom
    // single-part multipart parser above is untouched. Malformed input is
    // ignored (report falls back to the honest "Not assessed" gate).
    //
    // SAFETY (BLOCKER 2): vendor metrics are the sole trigger for the full
    // spectral/BP interpretation pathway, so they are applied ONLY after the
    // vendor PDF's identity (patient name + study date, DOB when present) is
    // reconciled server-side against the parsed .ans. The client cannot be
    // trusted to enforce this. A mismatch — or a payload that omits identity —
    // drops the metrics and records an explicit warning; it NEVER silently
    // overrides one patient's study with another's vendor numbers.
    let vendorMetrics: VendorReportedMetrics | undefined;
    const vendorWarnings: string[] = [];
    let vendorReconciliation: VendorReconciliationStatus | undefined;
    const vmHeader = req.headers["x-vendor-metrics"];
    if (typeof vmHeader === "string" && vmHeader.trim()) {
      try {
        const parsed = JSON.parse(vmHeader);
        const pick = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
        const candidate: VendorReportedMetrics = {
          LFa: pick(parsed.LFa),
          RFa: pick(parsed.RFa),
          SB: pick(parsed.SB),
          SBP: pick(parsed.SBP),
          DBP: pick(parsed.DBP),
        };
        const hasAnyMetric = Object.values(candidate).some((v) => v !== undefined);
        const numericTotal = Object.keys(candidate).length;
        const numericRead = Object.values(candidate).filter((v) => v !== undefined).length;
        // Vendor documents supplied for cross-document conflict detection. The
        // caller may pass their extracted text; we never fetch or guess.
        const vendorDocs: VendorDocumentText[] = Array.isArray(parsed.documents)
          ? (parsed.documents as unknown[])
              .map((d) => d as { source?: unknown; text?: unknown })
              .filter((d) => typeof d.text === "string")
              .map((d) => ({
                source: typeof d.source === "string" ? d.source : "vendor document",
                text: d.text as string,
              }))
          : [];
        const vendorConflicts = detectVendorConflicts(vendorDocs);
        if (!hasAnyMetric) {
          // ATTACHED BUT NUMERICALLY UNREADABLE. This is NOT the same as "no
          // vendor PDF" and must not be reported as a low-confidence match.
          vendorReconciliation = {
            status: "unreadable_numerics",
            numericFields: { read: 0, total: numericTotal },
            conflicts: vendorConflicts.length ? vendorConflicts : undefined,
            reason:
              "A vendor payload was attached but no numeric field could be read from it. " +
              "Nothing was inferred; the report reflects the uploaded .ans only.",
          };
          vendorWarnings.push(
            `0 of ${numericTotal} numeric vendor fields could be read — vendor values were not applied.`,
          );
        }
        if (hasAnyMetric) {
          // Identity may be nested (`identity`) or flat on the payload.
          const idIn = parsed.identity ?? {
            patientName: parsed.patientName,
            testDate: parsed.testDate,
            dob: parsed.dob,
          };
          const recon = reconcileVendorIdentity(
            {
              patientName: typeof idIn?.patientName === "string" ? idIn.patientName : null,
              testDate: typeof idIn?.testDate === "string" ? idIn.testDate : null,
              dob: typeof idIn?.dob === "string" ? idIn.dob : null,
            },
            {
              firstName: patientData.firstName,
              lastName: patientData.lastName,
              testDate: patientData.testDate,
              dob: patientData.dobString,
            },
          );
          if (recon.ok) {
            vendorMetrics = candidate;
            vendorReconciliation = {
              // A cross-document disagreement is its own state: the clinician
              // must see both vendor recommendations rather than have one
              // silently chosen (the audit's 3-vs-6-month retest defect).
              status: vendorConflicts.length > 0 ? "conflicting_recommendations" : "matched",
              matchedName: `${patientData.firstName} ${patientData.lastName}`.trim(),
              matchedDate: patientData.testDate,
              checks: recon.checks,
              numericFields: { read: numericRead, total: numericTotal },
              conflicts: vendorConflicts.length ? vendorConflicts : undefined,
            };
            if (vendorConflicts.length > 0) {
              for (const c of vendorConflicts) vendorWarnings.push(c.message);
            }
          } else {
            vendorWarnings.push(recon.reason ?? "Vendor report identity could not be reconciled with the uploaded .ans; vendor values were not applied.");
            vendorReconciliation = {
              status: "mismatch",
              checks: recon.checks,
              reason: recon.reason,
              numericFields: { read: numericRead, total: numericTotal },
              conflicts: vendorConflicts.length ? vendorConflicts : undefined,
            };
            console.warn("[upload] vendor identity reconciliation FAILED:", recon.reason);
          }
        }
      } catch {
        console.warn("[upload] ignoring malformed x-vendor-metrics header");
        vendorWarnings.push("The paired vendor-metrics payload was malformed and was ignored.");
        vendorReconciliation = { status: "malformed" };
      }
    }
    const report = generateColomboReport(patientData, vendorMetrics);
    if (vendorWarnings.length > 0) {
      (report as { vendorReconciliationWarnings?: string[] }).vendorReconciliationWarnings = vendorWarnings;
    }
    if (vendorReconciliation) {
      (report as { vendorReconciliation?: typeof vendorReconciliation }).vendorReconciliation = vendorReconciliation;
    } else {
      // NO VENDOR PDF is an explicit state, not the absence of information: the
      // UI must be able to distinguish it from "attached but unreadable".
      (report as { vendorReconciliation?: VendorReconciliationStatus }).vendorReconciliation = {
        status: "no_vendor_pdf",
        reason:
          "No vendor PDF was supplied with this upload, so no vendor-reported value was available " +
          "to compare against. The proprietary spectral aggregates remain not assessed.",
      };
    }
    // Send only a preview of the raw ECG to the client — the full waveform
    // stays server-side (we'd blow past the Vercel payload limit otherwise).
    // The Multi-Parameter Graphical and Colombo analysis have already run
    // on the full waveform at this point, so the report is complete.
    const ECG_PREVIEW_SAMPLES = 5000;
    const wirePatient = {
      ...patientData,
      ecgData: patientData.ecgData.slice(0, ECG_PREVIEW_SAMPLES),
    };
    // Attach the normalized AnsStudy (minus the heavy ECG preview) so the
    // frontend can show extraction provenance/warnings. The full ECG stays
    // in `patientData.ecgData` (preview-trimmed above).
    const ansStudyForWire = ansStudy
      ? {
          ...ansStudy,
          ecg: { ...ansStudy.ecg, preview: ansStudy.ecg.preview.slice(0, 1000) },
        }
      : undefined;
    // PR2 — Deterministic scoring layer. Runs only when we have a normalized
    // AnsStudy; legacy-fallback uploads skip it (the legacy ParsedANSData does
    // not carry the provenance/confidence the scoring layer needs).
    let diagnosticSummary: ReturnType<typeof computeDiagnosticSummary> | undefined;
    if (ansStudy) {
      try {
        // Single-evaluation-engine reconciliation (S2-1/S2-2): backfill any
        // AnsStudy fields the text parser left MISSING from the ECG-computed
        // report, so the certainty engine scores the same numbers shown
        // everywhere else. Parser-extracted values are never overwritten.
        const reconciledStudy = reconcileStudyWithReport(ansStudy, report);
        diagnosticSummary = computeDiagnosticSummary(reconciledStudy);
        // Cross-source: when the paired vendor report establishes normal RFa + low
        // SB driven by low LFa, invalidate the estimate-based deterministic
        // parasympathetic-withdrawal hypothesis so the clinician EVIDENCE panel
        // and the patient view cannot contradict for the same metrics.
        if (vendorMetrics) {
          diagnosticSummary = reconcilePhenotypesWithVendor(diagnosticSummary, {
            LFa: vendorMetrics.LFa,
            RFa: vendorMetrics.RFa,
            SB: vendorMetrics.SB,
          });
        }
      } catch (err: any) {
        console.warn(
          "[ans-scoring] computeDiagnosticSummary failed:",
          err?.message ?? err,
        );
        diagnosticSummary = undefined;
      }
    }
    // Embed on the report for back-compat consumers that only look at
    // `result.report`, AND surface at the top level for new consumers.
    const reportWithSummary = diagnosticSummary
      ? { ...report, diagnosticSummary }
      : report;
    return res.status(200).json({
      success: true,
      patientData: wirePatient,
      report: reportWithSummary,
      ansStudy: ansStudyForWire,
      diagnosticSummary,
    });
  } catch (error: any) {
    console.error("Error processing file:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process ANS file",
    });
  }
}
