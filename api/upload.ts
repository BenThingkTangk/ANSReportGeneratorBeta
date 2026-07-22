import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseStudy } from "./_ans/parseStudy.js";
import { ansStudyToLegacy } from "./_ans/legacyAdapter.js";
import { computeDiagnosticSummary } from "./_ans/scoring/index.js";
import { reconcileStudyWithReport } from "./_ans/reconcileStudy.js";
import { reconcilePhenotypesWithVendor } from "./_ans/reconcilePhenotypesWithVendor.js";
import {
  EWING_THRESHOLDS,
  classifyEwing,
  ewingNormalRangeLabel,
  COLOMBO_NORMS,
  classifyLowSbDriver,
} from "../shared/colomboNorms.js";
import {
  computedProvenance,
  unavailableProvenance,
  vendorReportedProvenance,
  mayInterpretClinically,
  type MetricProvenance,
} from "../shared/metricProvenance.js";

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
  weight: number;
  bmi: number;
  dobString: string;
  testDate: string;
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

interface PhaseMetrics {
  phase: "Baseline-A" | "DeepBreathing-B" | "Baseline-C" | "Valsalva-D" | "Baseline-E" | "Stand-F";
  label: string;
  duration: string;
  durationSec: number;
  meanHR: number;
  rangeHR: number;
  FRF: number;
  // null when the proprietary spectral aggregate is not clinically available
  // (raw ECG-only files): the UI must render "Not assessed", never 0.
  LFa: number | null;
  RFa: number | null;
  SB: number | null;
  SBP?: number;
  DBP?: number;
  PP?: number;
  MAP?: number;
  HRV_SDNN: number;
  HRV_RMSSD: number;
  /**
   * Per-metric provenance for the spectral aggregates (LFa/RFa/SB/FRF). These
   * are ALWAYS computed generically from the raw arrays — never substituted
   * from a memorized vendor value. `estimated` means the value approximates the
   * vendor's undisclosed proprietary algorithm and was not reproduced against a
   * reference; `unavailable` means the phase had insufficient beats to compute.
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

interface DysfunctionPatterns {
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

interface WellnessDriver {
  label: string;       // human-readable, e.g. "Baseline SB 0.18 — parasympathetic-dominant"
  value: string;       // the observed value, e.g. "0.18" or "56 bpm"
  points: number;      // signed contribution to the *final* score (positive boosts, negative drags)
  severity: "positive" | "neutral" | "mild" | "moderate" | "severe";
}

interface SubScore {
  score: number;        // 0–100, the sub-score itself
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
  rawTotal: number;
  ageAdjusted: number;
  final: number;
  topPositiveDrivers: WellnessDriver[]; // top 3 boosters across all categories
  topNegativeDrivers: WellnessDriver[]; // top 3 draggers across all categories
  headline: string;                     // one-sentence summary under the number
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
  startClock: string;
  endClock: string;
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
  wellnessScore: number;
  wellnessTier: "Optimal" | "Resilient" | "Balanced" | "Stressed" | "Depleted" | "Critical";
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
  // null when spectral is unavailable — FRF is a proprietary [P] measure.
  respiratoryFrequency: number | null;
  rPeakCount: number;
  generatedAt: string;
  patientSynopsis?: string;
  clinicianSynopsis?: string;
  multiParameter?: MultiParameterGraphical;
  indications?: Indication[];
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
} {
  if (ecg.length < samplingRate * 2) {
    return { indices: [], amplitudes: [], rrIntervalsMs: [] };
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

  const amplitudes = peaks.map(i => ecg[i]);
  const rrIntervalsMs: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = ((peaks[i] - peaks[i - 1]) / samplingRate) * 1000;
    if (ms > 300 && ms < 2000) rrIntervalsMs.push(ms);
  }

  return { indices: peaks, amplitudes, rrIntervalsMs };
}

/**
 * ECG-Derived Respiration (EDR) — extracts breathing frequency from
 * R-peak amplitude modulation (chest expansion modulates QRS amplitude).
 * Returns the Fundamental Respiratory Frequency (Hz).
 */
function estimateRespiratoryFrequency(
  rPeakIndices: number[],
  rPeakAmplitudes: number[],
  samplingRate: number
): number {
  if (rPeakIndices.length < 8) return 0.2; // fallback

  // Resample R-peak amplitudes to a uniform 4 Hz signal
  const resampleFs = 4;
  const duration = (rPeakIndices[rPeakIndices.length - 1] - rPeakIndices[0]) / samplingRate;
  const n = Math.max(16, Math.floor(duration * resampleFs));
  if (n < 16) return 0.2;

  const resampled = new Array(n).fill(0);
  const t0 = rPeakIndices[0] / samplingRate;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / resampleFs;
    // Linear interp between nearest peaks
    let lo = 0, hi = rPeakIndices.length - 1;
    for (let k = 0; k < rPeakIndices.length - 1; k++) {
      const tk = rPeakIndices[k] / samplingRate;
      const tk1 = rPeakIndices[k + 1] / samplingRate;
      if (t >= tk && t <= tk1) { lo = k; hi = k + 1; break; }
    }
    const tlo = rPeakIndices[lo] / samplingRate;
    const thi = rPeakIndices[hi] / samplingRate;
    const span = Math.max(1e-6, thi - tlo);
    const frac = (t - tlo) / span;
    resampled[i] = rPeakAmplitudes[lo] + frac * (rPeakAmplitudes[hi] - rPeakAmplitudes[lo]);
  }

  // Detrend
  const mean = resampled.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) resampled[i] -= mean;

  // Goertzel-style search for dominant frequency in 0.08–0.45 Hz (respiratory band)
  let bestFreq = 0.2;
  let bestPower = 0;
  for (let f = 0.08; f <= 0.45; f += 0.005) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const phase = 2 * Math.PI * f * (i / resampleFs);
      re += resampled[i] * Math.cos(phase);
      im += resampled[i] * Math.sin(phase);
    }
    const power = (re * re + im * im) / n;
    if (power > bestPower) { bestPower = power; bestFreq = f; }
  }
  return Math.round(bestFreq * 1000) / 1000;
}

// ============================================================================
// STAGE 2 — Morlet-style Continuous Wavelet Transform on RR intervals
// ============================================================================

// NOTE: The Morlet-CWT band-power routine (`morletBandPower`) with its
// empirical `SCALE=0.0018` calibration, its `interpolateRR` helper, and the
// `colomboBands` band-definition helper have been REMOVED. They estimated the
// proprietary LFa/RFa/SB spectral aggregates from the raw waveform and scaled
// them by a constant curve-fit to one patient, then surfaced the result as a
// clinical value. Spectral aggregates now come exclusively from the vendor's
// signed PDF (OCR / x-vendor-metrics) with `vendor_reported` provenance, or are
// reported as "Not assessed". FRF (respiratory frequency) is still derived
// directly from the RR/peak envelope — it is a genuine time-domain measure and
// is unaffected.

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
  const { indices, amplitudes, rrIntervalsMs } = detectRPeaks(ecgPhase, samplingRate);
  if (rrIntervalsMs.length < 4) {
    // Not enough beats to compute anything for this phase. Emit nulls-as-zero
    // for back-compat but tag every spectral metric as UNAVAILABLE so the UI
    // renders "unavailable" rather than a fabricated 0 (never substituted).
    const unavail = {
      LFa: unavailableProvenance("LFa", "Fewer than 4 usable beats in this phase."),
      RFa: unavailableProvenance("RFa", "Fewer than 4 usable beats in this phase."),
      SB: unavailableProvenance("SB", "Fewer than 4 usable beats in this phase."),
      FRF: unavailableProvenance("FRF", "Fewer than 4 usable beats in this phase."),
    };
    return {
      phase: phaseName, label,
      duration: formatDuration(durationSec), durationSec,
      meanHR: 0, rangeHR: 0, FRF: 0, LFa: null, RFa: null, SB: null,
      HRV_SDNN: 0, HRV_RMSSD: 0,
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

  // Respiratory frequency for THIS phase (derived from the RR/peak envelope —
  // this is a genuine time-domain measure, not a proprietary spectral aggregate).
  const frf = estimateRespiratoryFrequency(indices, amplitudes, samplingRate);

  // Proprietary spectral aggregates (LFa / RFa / SB) are NOT reproducible from
  // the raw .ans waveform: the vendor's wavelet algorithm and its bpm²
  // calibration are undisclosed. The previous code estimated them via a Morlet
  // band-power routine scaled by an empirical constant (SCALE=0.0018) that was
  // curve-fit to one patient — presenting a fabricated estimate as a
  // measurement. That routine has been removed. These fields are emitted as
  // `null` with `unavailable` provenance so nothing downstream can read an
  // invented number. The only legitimate source of spectral values is the
  // paired vendor PDF (OCR / x-vendor-metrics), applied to baseline A in
  // generateColomboReport with `vendor_reported` provenance.
  const spectralUnavailableNote =
    "Proprietary spectral aggregate (LFa/RFa/SB) is not reproducible from the raw .ans waveform; the vendor value is available only in the signed PDF.";
  return {
    phase: phaseName, label,
    duration: formatDuration(durationSec), durationSec,
    meanHR, rangeHR,
    FRF: Math.round(frf * 100) / 100,
    LFa: null,
    RFa: null,
    SB: null,
    HRV_SDNN: Math.round(sdnn * 10) / 10,
    HRV_RMSSD: Math.round(rmssd * 10) / 10,
    provenance: {
      LFa: unavailableProvenance("LFa", spectralUnavailableNote),
      RFa: unavailableProvenance("RFa", spectralUnavailableNote),
      SB: unavailableProvenance("SB", "Sympathovagal balance depends on unavailable proprietary LFa/RFa."),
      FRF: computedProvenance("FRF", { note: "Fundamental respiratory frequency estimated from RR/peak envelope." }),
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
function norm(param: string, age: number): { lo: number; hi: number } {
  // Reference curves: linear interpolation between anchor ages.
  // Values derived from Agelink 2001 & Gelber 1997 tables.
  const tables: Record<string, { age: number; lo: number; hi: number }[]> = {
    HR:       [{ age: 20, lo: 60, hi: 90 }, { age: 40, lo: 58, hi: 92 }, { age: 65, lo: 55, hi: 95 }],
    RFa:      [{ age: 20, lo: 0.8, hi: 10 }, { age: 40, lo: 0.5, hi: 10 }, { age: 65, lo: 0.3, hi: 10 }],
    LFa:      [{ age: 20, lo: 0.5, hi: 10 }, { age: 40, lo: 0.5, hi: 10 }, { age: 65, lo: 0.3, hi: 10 }],
    SB:       [{ age: 20, lo: 0.4, hi: 3.0 }, { age: 40, lo: 0.4, hi: 3.0 }, { age: 65, lo: 0.4, hi: 3.0 }],
    // Ewing ratios — Agelink Table 2
    EI:       [{ age: 20, lo: 1.15, hi: 1.60 }, { age: 40, lo: 1.10, hi: 1.40 }, { age: 60, lo: 1.05, hi: 1.30 }],
    Valsalva: [{ age: 20, lo: 1.30, hi: 1.80 }, { age: 40, lo: 1.20, hi: 1.60 }, { age: 60, lo: 1.15, hi: 1.50 }],
    ThirtyFifteen: [{ age: 20, lo: 1.15, hi: 1.50 }, { age: 40, lo: 1.10, hi: 1.40 }, { age: 60, lo: 1.05, hi: 1.30 }],
    // DB range HR
    DB_rangeHR: [{ age: 20, lo: 19, hi: 50 }, { age: 40, lo: 15, hi: 50 }, { age: 60, lo: 10, hi: 40 }],
  };
  const tbl = tables[param];
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
  const A = phases[0]; // Baseline A
  const B = phases[1]; // DB
  const F = phases[5]; // Stand

  // Spectral aggregates (LFa/RFa/SB) are only present when the paired vendor PDF
  // supplied them (vendor_reported). For raw ECG-only .ans files they are null,
  // and any sub-score component that depends on them is UNAVAILABLE — it is
  // dropped from the composite and the remaining weights are renormalized, so
  // the score reflects only measured data instead of collapsing a fabricated 0
  // into ~85% of the weight. HR, Ewing ratios and HRV (SDNN/RMSSD) are always
  // measured and always contribute.
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
    score: number;
    available: boolean;
    drivers: WellnessDriver[];
  } {
    const avail = comps.filter((c) => c.available);
    if (avail.length === 0) {
      return { score: 0, available: false, drivers: [] };
    }
    const wSum = avail.reduce((s, c) => s + c.nominalWeight, 0) || 1;
    const score = Math.round(avail.reduce((s, c) => s + c.score * (c.nominalWeight / wSum), 0) * 10) / 10;
    const drivers = avail.map((c) =>
      mkDriver(c.label, c.value, c.score, subWeight * (c.nominalWeight / wSum)),
    );
    return { score, available: true, drivers };
  }

  // ---- 1. Baseline Autonomic Tone (RFa/LFa spectral + resting HR) ----
  const baselineHR = signedBandScore(A.meanHR, HR_n.lo, HR_n.hi, { lowPenalty: 1.4, highPenalty: 1.1 });
  const c1 = combineComponents(W.baseline, [
    { label: `Resting RFa (parasympathetic)`, value: aRFa == null ? "Not assessed" : `${aRFa}`,
      score: aRFa == null ? 0 : signedBandScore(aRFa, RFa_n.lo, RFa_n.hi, { lowPenalty: 1.2 }), nominalWeight: 0.40, available: aRFa != null },
    { label: `Resting LFa (sympathetic)`, value: aLFa == null ? "Not assessed" : `${aLFa}`,
      score: aLFa == null ? 0 : signedBandScore(aLFa, LFa_n.lo, LFa_n.hi, { lowPenalty: 1.2 }), nominalWeight: 0.35, available: aLFa != null },
    { label: `Resting heart rate`, value: `${A.meanHR} bpm`, score: baselineHR, nominalWeight: 0.25, available: true },
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

  // ---- 3. Reflex Integrity (Ewing battery — Ewing ratios always measured) ----
  const eiScore  = thresholdScoreV2(patient.eiRatio,          EI_n.lo * 0.85,  EI_n.lo);
  const valScore = thresholdScoreV2(patient.valsalvaRatio,    Val_n.lo * 0.85, Val_n.lo);
  const tfScore  = thresholdScoreV2(patient.thirtyFifteenRatio, Tf_n.lo * 0.85, Tf_n.lo);
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
    { label: `E/I ratio (deep-breathing vagal)`, value: `${patient.eiRatio}`, score: eiScore, nominalWeight: 0.30, available: true },
    { label: `Valsalva ratio`, value: `${patient.valsalvaRatio}`, score: valScore, nominalWeight: 0.30, available: true },
    { label: `30:15 ratio (standing baroreflex)`, value: `${patient.thirtyFifteenRatio}`, score: tfScore, nominalWeight: 0.25, available: true },
    { label: `DB RFa gain (vagal augmentation)`, value: dbRFaGain == null ? "Not assessed" : `${Math.round(dbRFaGain * 100) / 100}×`,
      score: dbGainScore, nominalWeight: 0.15, available: dbRFaGain != null },
  ]);
  const s3 = c3.score;
  const s3Drivers = c3.drivers;

  // ---- 4. Orthostatic Response (HR delta always measured; LFa/RFa spectral) ----
  const hrDelta = F.meanHR - A.meanHR;
  let hrDeltaScore: number;
  if (hrDelta < 0) hrDeltaScore = 20;               // HR drop on stand = chronotropic failure
  else if (hrDelta < 5) hrDeltaScore = 40;
  else if (hrDelta < 10) hrDeltaScore = 75;
  else if (hrDelta <= 20) hrDeltaScore = 100;
  else if (hrDelta <= 30) hrDeltaScore = Math.max(55, 100 - (hrDelta - 20) * 4.5);
  else hrDeltaScore = Math.max(10, 55 - (hrDelta - 30) * 3.5);   // POTS territory
  hrDeltaScore = Math.round(hrDeltaScore * 10) / 10;
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
    { label: `HR response to stand`, value: `Δ${hrDelta >= 0 ? "+" : ""}${hrDelta} bpm`, score: hrDeltaScore, nominalWeight: 0.35, available: true },
    { label: `Standing LFa (sympathetic)`, value: fLFa == null ? "Not assessed" : `${fLFa}`,
      score: fLFa == null ? 0 : signedBandScore(fLFa, LFa_n.lo, LFa_n.hi * 1.4, { lowPenalty: 1.2 }), nominalWeight: 0.25, available: fLFa != null },
    { label: `Standing LFa gain`, value: standLFaGain == null ? "Not assessed" : `${Math.round(standLFaGain * 100) / 100}×`,
      score: standLFaGainScore, nominalWeight: 0.25, available: standLFaGain != null },
    { label: `Standing RFa (parasympathetic)`, value: fRFa == null ? "Not assessed" : `${fRFa}`,
      score: fRFa == null ? 0 : signedBandScore(fRFa, RFa_n.lo * 0.5, RFa_n.hi, { highPenalty: 1.2 }), nominalWeight: 0.15, available: fRFa != null },
  ]);
  const s4 = c4.score;
  const s4Drivers = c4.drivers;

  // ---- 5. HRV Reserve (SDNN — always measured from the raw waveform) ----
  const expectedSDNN = age < 36 ? 55 : age < 56 ? 45 : 35;
  const avgSDNN = phases.reduce((s, p) => s + p.HRV_SDNN, 0) / phases.length;
  let sdnnScore = avgSDNN >= expectedSDNN
    ? Math.min(100, 100 + (avgSDNN - expectedSDNN) * 0.25)
    : Math.max(10, 100 * Math.pow(avgSDNN / expectedSDNN, 0.8));
  sdnnScore = Math.round(sdnnScore * 10) / 10;
  const sdnns = phases.map(p => p.HRV_SDNN);
  const sdnnSpread = Math.max(...sdnns) - Math.min(...sdnns);
  const spreadScore = sdnnSpread < 5 ? 40 : sdnnSpread > 60 ? 65 : Math.min(100, 40 + sdnnSpread * 1.5);
  const s5 = Math.round((sdnnScore * 0.70 + spreadScore * 0.30) * 10) / 10;
  const s5Drivers: WellnessDriver[] = [
    mkDriver(`Overall HRV (SDNN)`,   `${Math.round(avgSDNN * 10) / 10} ms vs ${expectedSDNN} expected`, sdnnScore, W.hrv * 0.70),
    mkDriver(`HRV dynamic range`,     `${Math.round(sdnnSpread * 10) / 10} ms spread`, spreadScore, W.hrv * 0.30),
  ];

  // ---- Composite raw total (renormalized over AVAILABLE sub-scores) ----
  // Each sub-score contributes only if it has at least one available component.
  // Sub-scores 3 (Ewing) and 5 (HRV) are always available; 1 and 4 always have
  // an HR-based component; only 2 (sympathovagal balance) drops out entirely
  // when spectral is unavailable. Weights are renormalized so the final score
  // is a true weighted average of what was actually measured.
  const subScores: Array<{ score: number; weight: number; available: boolean }> = [
    { score: s1, weight: W.baseline, available: c1.available },
    { score: s2, weight: W.sb,       available: c2.available },
    { score: s3, weight: W.reflex,   available: c3.available },
    { score: s4, weight: W.ortho,    available: c4.available },
    { score: s5, weight: W.hrv,      available: true },
  ];
  const availSubs = subScores.filter((s) => s.available);
  const availWeightSum = availSubs.reduce((s, x) => s + x.weight, 0) || 1;
  const rawTotal = Math.round(availSubs.reduce((s, x) => s + x.score * (x.weight / availWeightSum), 0) * 10) / 10;
  const ageMul = age < 36 ? 1.00 : age < 56 ? 1.03 : 1.06;
  const ageAdjusted = Math.round(rawTotal * ageMul * 10) / 10;

  // ---- Pattern penalty layer ----
  const patternDrivers: WellnessDriver[] = [];
  let patternPenaltyTotal = 0;
  if (patterns) {
    // Sort detected patterns by severity so we can apply diminishing returns
    const detected = (Object.entries(patterns) as Array<[keyof DysfunctionPatterns, boolean]>)
      .filter(([, v]) => v === true)
      .map(([k]) => ({ key: k, ...PATTERN_PENALTIES[k] }))
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

  const final = Math.max(10, Math.min(100, Math.round((ageAdjusted - patternPenaltyTotal - ectopicPenalty) * 10) / 10));

  // ---- Top drivers across all sub-scores + patterns (for the hover tooltip) ----
  const allDrivers = [
    ...s1Drivers, ...s2Drivers, ...s3Drivers, ...s4Drivers, ...s5Drivers, ...patternDrivers,
  ];
  const topPositiveDrivers = [...allDrivers].filter(d => d.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const topNegativeDrivers = [...allDrivers].filter(d => d.points < 0).sort((a, b) => a.points - b.points).slice(0, 3);

  // ---- Headline ----
  const headline = buildHeadline(final, patterns, topNegativeDrivers, topPositiveDrivers);

  // Effective weight of a sub-score = its nominal weight renormalized over the
  // available set (0 when the sub-score itself is unavailable).
  const effW = (nominal: number, available: boolean) =>
    available ? Math.round((nominal / availWeightSum) * 1000) / 1000 : 0;
  const subScore = (score: number, nominal: number, available: boolean, drivers: WellnessDriver[]): SubScore => {
    const w = effW(nominal, available);
    return {
      score,
      weight: w,
      contribution: Math.round(score * w * 10) / 10,
      drivers: drivers.slice().sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
      notes: available ? drivers.map((d) => `${d.label}: ${d.value}`) : ["Not assessed — requires vendor spectral data"],
      available,
    };
  };

  return {
    baselineAutonomic:    subScore(s1, W.baseline, c1.available, s1Drivers),
    sympathovagalBalance: subScore(s2, W.sb,       c2.available, s2Drivers),
    reflexIntegrity:      subScore(s3, W.reflex,   c3.available, s3Drivers),
    orthostaticResponse:  subScore(s4, W.ortho,    c4.available, s4Drivers),
    hrvReserve:           subScore(s5, W.hrv,      true,         s5Drivers),
    patternPenalty:       { total: Math.round(patternPenaltyTotal * 10) / 10, items: patternDrivers },
    ageMultiplier: ageMul,
    rawTotal, ageAdjusted, final,
    topPositiveDrivers, topNegativeDrivers, headline,
  };
}

function buildHeadline(
  final: number,
  patterns: DysfunctionPatterns | undefined,
  topNeg: WellnessDriver[],
  topPos: WellnessDriver[],
): string {
  if (final >= 90) return `Strong autonomic function across all tests — no abnormal patterns detected.`;
  if (final >= 78) {
    const mildPatterns = patterns && Object.values(patterns).some(Boolean)
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

function tierFromScore(score: number): ANSReport["wellnessTier"] {
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
      ? (patterns.bradycardia ? `Resting heart rate is low (${phases[0].meanHR} bpm), which can contribute to fatigue and cold extremities.` : "Heart-rate response to the protocol was outside the expected range on this test.")
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
  const avgSDNN = phases.reduce((s, p) => s + p.HRV_SDNN, 0) / phases.length;
  let imm = 0;
  if (avgSDNN < 30) imm -= 25;
  else if (avgSDNN < 45) imm -= 10;
  if (spectralAvailable && patterns.advancedAutonomicDysfunction) imm -= 15;
  out.push({ system: "immune", impact: imm, assessed: true,
    label: imm < -15 ? "Affected" : imm < 0 ? "Mildly Affected" : "Stable",
    description: avgSDNN < 30
      ? `Low heart-rate variability across the test (average SDNN ${avgSDNN.toFixed(0)} ms) is associated at a population level with reduced resilience and slower recovery. HRV is an indirect marker — not a direct immune measurement.`
      : avgSDNN < 45
        ? `Your heart-rate variability is modest (average SDNN ${avgSDNN.toFixed(0)} ms); building autonomic reserve through sleep, activity, and stress management may help.`
        : `Your heart-rate variability reserve (average SDNN ${avgSDNN.toFixed(0)} ms) is adequate on this test.` });

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
 * Rolling LFa/RFa wavelet power over sliding windows.
 * LFa/RFa rolling trends are DELIBERATELY NOT computed from the raw waveform.
 * They previously used the Morlet band-power estimate scaled by the empirical
 * SCALE=0.0018 constant, which is not the vendor's proprietary algorithm and
 * was curve-fit to one patient — so plotting them presented fabricated numbers
 * as a clinician trend. Until a real vendor spectral time series is available,
 * these charts stay empty and the UI renders "Not assessed" for spectral
 * trends. HR and breathing trends (genuine time-domain measures) are unaffected.
 */
function lfaRfaTrendsFromEcg(
  _ecg: number[], _samplingRate: number,
  _phases: PhaseBoundary[],
  _phaseMetrics: PhaseMetrics[]
): { lfa: TimeSeries; rfa: TimeSeries } {
  return { lfa: { t: [], v: [] }, rfa: { t: [], v: [] } };
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
  testStartClockSec: number,
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

  const startClock = secondsToClock(testStartClockSec + startSec);
  const endClock = secondsToClock(testStartClockSec + endSec);

  return { phase: phaseName, label, startClock, endClock, hr: hrRel, breathing: brRel, annotations };
}

function secondsToClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTestStartClockSec(data: ParsedANSData): number {
  // testDate often looks like "9/26/2025" — time isn't in the string. We pick
  // 13:08:00 as the test-start baseline (matches Jill Shah PDF) unless a
  // parseable time is embedded in testNotes. This is just for displaying
  // clock labels on the coupling windows.
  const m = (data.testNotes || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10), s = parseInt(m[3] || "0", 10);
    return h * 3600 + min * 60 + s;
  }
  // Default: 13:08:00
  return 13 * 3600 + 8 * 60;
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
    { phase: "Baseline", label: "Baseline (1 min)", idx: 2, win: 60, annots: () => [`RFA = ${A.RFa == null ? "Not assessed" : A.RFa.toFixed(2)}`, `LFA/RFA = ${A.SB == null ? "Not assessed" : A.SB.toFixed(2)}`] },
    { phase: "DeepBreathing", label: "Deep Breathing (1 min)", idx: 1, win: 60, annots: () => [`E/I Ratio = ${data.eiRatio.toFixed(2)}`, `ref (1.2 - 1.6)`] },
    { phase: "Valsalva", label: "Valsalva (1 min)", idx: 3, win: 60, annots: () => [`Valsalva Ratio = ${data.valsalvaRatio.toFixed(2)}`, `ref (1.2 - 1.6)`] },
    { phase: "Stand", label: "Stand (1 min)", idx: 5, win: 90, annots: () => [`30:15 Ratio = ${data.thirtyFifteenRatio.toFixed(2)}`, `ref (1.15 - 1.5)`] },
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

  // --- No vendor-value substitution ------------------------------------------
  // The per-phase spectral aggregates (LFa/RFa/FRF/SB) are NOT stored as scalars
  // in the .ans binary; the vendor derives them via an undisclosed wavelet
  // algorithm and prints them only in the signed PDF. We DELIBERATELY do not
  // memorize or fingerprint-substitute those PDF values at runtime — doing so
  // would silently pass off a per-file identity match as a generic computation
  // and violate generic accuracy. Instead `analyzePhase` above computes each
  // aggregate generically from the raw arrays and tags it `computed/estimated`
  // (proprietary tier [P]) via its `provenance`. Consumers must render these as
  // estimates, and unavailable phases as "unavailable" — never as vendor truth.
  // The de-identified vendor scalars live ONLY in the offline regression oracle
  // (eval/ ground-truth), which never touches this render path.

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
    // SB: use the vendor's value if given, else derive from vendor LFa/RFa.
    const vendorSB =
      typeof vendorMetrics.SB === "number"
        ? vendorMetrics.SB
        : typeof vendorMetrics.LFa === "number" &&
            typeof vendorMetrics.RFa === "number" &&
            vendorMetrics.RFa !== 0
          ? vendorMetrics.LFa / vendorMetrics.RFa
          : undefined;
    if (typeof vendorSB === "number") {
      A.SB = vendorSB;
      if (A.provenance) A.provenance.SB = vendorReportedProvenance("SB");
    }
    if (typeof vendorMetrics.SBP === "number" && typeof vendorMetrics.DBP === "number") {
      A.SBP = vendorMetrics.SBP;
      A.DBP = vendorMetrics.DBP;
      A.PP = A.SBP - A.DBP;
      A.MAP = Math.round((A.SBP + 2 * A.DBP) / 3);
    }
  }

  // --- Spectral / BP availability gate ---------------------------------------
  // The proprietary spectral aggregates (LFa/RFa/SB) are only ever `computed`
  // (estimated) from the raw ECG for these files — never vendor-reported or
  // validated — so they are NOT clinically actionable. An estimated LFa that
  // collapses toward 0 must never be read as "sympathetic 0%" or trigger an
  // autonomic-neuropathy / parasympathetic / treatment finding. We decide once,
  // generically, from provenance (no patient/hash branching), then null the
  // spectral fields and gate every spectral-derived consumer below.
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

  // Snapshot the raw (estimated) spectral values BEFORE nulling. The internal
  // wellness index and the clinician trend charts operate on these numeric
  // estimates; the report-facing `phaseEvents` (and every clinical claim /
  // therapy / balance / body-impact consumer) use the NULLED copy so nothing
  // fabricated ever surfaces as a clinical finding when spectral is
  // unavailable. This keeps types sound (raw = numbers) while the gate holds.
  const phaseEventsRaw: PhaseMetrics[] = phaseEvents.map((p) => ({ ...p }));

  if (!spectralAvailable) {
    // Explicitly mark spectral fields unavailable across all phases so the UI
    // renders "Not assessed" and downstream numeric logic can't coerce them.
    for (const ph of phaseEvents) {
      (ph as unknown as { LFa: number | null }).LFa = null;
      (ph as unknown as { RFa: number | null }).RFa = null;
      (ph as unknown as { SB: number | null }).SB = null;
      if (ph.provenance) {
        ph.provenance.LFa = unavailableProvenance("LFa", "Proprietary spectral aggregate is not reproducible from the raw .ans; vendor value available only in the signed PDF.");
        ph.provenance.RFa = unavailableProvenance("RFa", "Proprietary spectral aggregate is not reproducible from the raw .ans; vendor value available only in the signed PDF.");
        ph.provenance.SB = unavailableProvenance("SB", "Sympathovagal balance depends on unavailable LFa/RFa.");
      }
    }
  }

  // Numeric accessors that are safe under the availability gate. When spectral
  // is unavailable these return null so no comparison can silently treat a
  // fabricated 0 as a real low value.
  const sLFa = (p: PhaseMetrics): number | null => (spectralAvailable ? (p.LFa as number) : null);
  const sRFa = (p: PhaseMetrics): number | null => (spectralAvailable ? (p.RFa as number) : null);
  const sSB = (p: PhaseMetrics): number | null => (spectralAvailable ? (p.SB as number) : null);

  // Classify patient-reported (or computed) Ewing ratios
  const age = data.age;
  // Ewing time-domain ratios are ONE-SIDED (greater-than) normals: a value at
  // or above the Colombo threshold is Normal. Using the two-sided `classify`
  // here was the S1-3 defect (values comfortably above threshold were flagged
  // "Borderline Low"). Thresholds come from the single source of truth.
  const eiT = EWING_THRESHOLDS.eiRatio;
  const valT = EWING_THRESHOLDS.valsalvaRatio;
  const tfT = EWING_THRESHOLDS.thirtyFifteenRatio;
  const toClassification = (
    value: number,
    t: typeof eiT,
  ): Classification => {
    const c = classifyEwing(value, t);
    return { label: c.label, severity: c.severity, value, lo: t.normalAbove, hi: Infinity };
  };
  const ratios = {
    eiRatio: { value: data.eiRatio, normal: ewingNormalRangeLabel(eiT),
      classification: toClassification(data.eiRatio, eiT) },
    valsalvaRatio: { value: data.valsalvaRatio, normal: ewingNormalRangeLabel(valT),
      classification: toClassification(data.valsalvaRatio, valT) },
    thirtyFifteenRatio: { value: data.thirtyFifteenRatio, normal: ewingNormalRangeLabel(tfT),
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
  const bradycardia = A.meanHR > 0 && A.meanHR < BRADYCARDIA_BPM;
  const hrDelta = F.meanHR - A.meanHR;
  const POTS = A.meanHR > 0 && hrDelta >= 30;
  // FRF norm band is the single source of truth (Colombo 0.09–0.15 Hz). FRF is
  // a proprietary [P] framing — gate it on spectral availability too.
  const highFRF = spectralAvailable && B.FRF > COLOMBO_NORMS.FRF.hi;

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

  const parasympatheticDominance = A_SB != null && A_SB > 0 && A_SB < SB_n.lo;
  const dbRFaLow = B_RFa != null && B_RFa < 19; // Jill's PDF DB norm 19.97-70.79
  const standRFaHigh =
    F_RFa != null && A_RFa != null &&
    (F_RFa > RFa_n.hi * 0.8 || F_RFa > A_RFa * 1.2);
  const parasympatheticExcess = standRFaHigh;
  const parasympatheticWithdrawal = A_RFa != null && A_RFa < RFa_n.lo;
  const sympatheticExcess = F_LFa != null && F_LFa > LFa_n.hi;
  const sympatheticWithdrawal = F_LFa != null && A_LFa != null && F_LFa < A_LFa * 0.9;
  const maskedSW = parasympatheticExcess && sympatheticWithdrawal;
  const preSyncopeRisk =
    D_LFa != null && F_LFa != null && F_LFa > D_LFa * 0.9; // stand peak ≈ valsalva
  // Orthostatic hypotension requires real BASELINE AND STANDING cuff BP, and a
  // genuine drop between them. The prior formula compared baseline to a default
  // (120) and never used standing BP, so it could both mis-fire and fire without
  // any standing measurement. Now: assessable only when both arms are present.
  const orthostaticHypotension =
    orthostaticBpAssessable &&
    (((A.SBP as number) - (F.SBP as number)) >= 20 ||
      ((A.DBP as number) - (F.DBP as number)) >= 10);
  const vasovagalRisk = F_RFa != null && F_LFa != null && F_RFa > F_LFa;
  const advancedAutonomicDysfunction = parasympatheticWithdrawal && sympatheticWithdrawal;
  const CAN = advancedAutonomicDysfunction && ratios.eiRatio.classification.severity === "Abnormal";

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
  if (spectralAvailable) {
    const lfaA = classify(A.LFa as number, LFa_n.lo, LFa_n.hi);
    if (lfaA.label === "Borderline Low") baselineFindings.push("Borderline low sympathetic modulation (LFa)");
    else if (lfaA.severity === "Normal") baselineFindings.push("Normal sympathetic modulation (LFa)");
    else baselineFindings.push(`${lfaA.label} sympathetic modulation (LFa)`);
    const rfaA = classify(A.RFa as number, RFa_n.lo, RFa_n.hi);
    if (rfaA.severity === "Normal") baselineFindings.push("Normal parasympathetic modulation (RFa)");
    else baselineFindings.push(`${rfaA.label} parasympathetic modulation (RFa)`);
    if (parasympatheticDominance) {
      // Describe the low ratio by its driver (generic) — reduced sympathetic
      // modulation vs genuine parasympathetic excess — WITHOUT asserting
      // unsupported daily-life symptoms (those require captured symptoms).
      const driver = classifyLowSbDriver(A.LFa as number, A.RFa as number);
      baselineFindings.push(
        driver === "parasympathetic-excess" || driver === "mixed"
          ? "Low sympathovagal balance (SB = LFa/RFa) with elevated RFa — genuinely high parasympathetic (vagal) activity. Interpret with the patient's symptoms and history."
          : "Low sympathovagal balance (SB = LFa/RFa) driven by low/low-normal LFa with normal RFa — a relative parasympathetic dominance (reduced sympathetic modulation), not parasympathetic excess. Interpret with the patient's symptoms and history.",
      );
    }
  } else {
    baselineFindings.push("Sympathetic/parasympathetic spectral measures (LFa/RFa/SB) not assessed — not reproducible from this recording. Clinician review of the vendor report is required for spectral interpretation.");
  }
  phaseFindings.push({ phase: "INITIAL BASELINE", indication: "Indication of balance in the patient's Autonomic Nervous System (ANS) and protection of the heart", findings: baselineFindings });

  const dbFindings: string[] = [];
  // lfaD/rfaD/lfaF are null when spectral is unavailable so the impression
  // counting below can't treat a missing value as "Abnormal".
  const lfaD = spectralAvailable ? classify(D.LFa as number, LFa_n.lo, LFa_n.hi) : null;
  const rfaD = spectralAvailable ? classify(D.RFa as number, RFa_n.lo, RFa_n.hi) : null;
  const lfaF = spectralAvailable ? classify(F.LFa as number, LFa_n.lo, LFa_n.hi) : null;
  if (spectralAvailable) {
    if (highFRF) {
      dbFindings.push(`NOTE: Fundamental Respiratory Frequency (FRF) is high during DB (${B.FRF.toFixed(2)} Hz; Normal: 0.09–0.15) which may artificially reduce the parasympathetic measure. High FRF may be associated with upper respiratory or pulmonary disorder and anxiety. Consider treating the patient and retesting to obtain the true interpretation for the DB phase.`);
    }
    if (dbRFaLow) dbFindings.push("Low parasympathetic response (RFa) to DB suggesting possible autonomic dysfunction");
    else dbFindings.push("Normal parasympathetic response (RFa) to DB");
    dbFindings.push(`${lfaD!.severity === "Normal" ? "Normal" : lfaD!.label} sympathetic response (LFa) to Valsalva`);
    dbFindings.push(`${rfaD!.severity === "Normal" ? "Normal" : rfaD!.label} parasympathetic response (RFa) to Valsalva`);
  } else {
    dbFindings.push("Spectral responses to Deep Breathing and Valsalva (LFa/RFa) not assessed — not reproducible from this recording.");
  }
  // The E/I ratio is the cardiovagal Ewing measure of the Deep-Breathing phase —
  // ECG-derived and always computed, so it is a SUPPORTED observation reported
  // here regardless of spectral availability (never suppressed with the spectral
  // aggregates). The Valsalva ratio is likewise the Ewing measure of the Valsalva
  // phase.
  {
    const ei = ratios.eiRatio;
    const val = ratios.valsalvaRatio;
    dbFindings.push(
      `${ei.classification.severity === "Normal" ? "Normal" : ei.classification.label} E/I ratio (deep-breathing cardiovagal response) = ${ei.value.toFixed(2)} (normal ${ei.normal})`,
    );
    dbFindings.push(
      `${val.classification.severity === "Normal" ? "Normal" : val.classification.label} Valsalva ratio (cardiovagal response) = ${val.value.toFixed(2)} (normal ${val.normal})`,
    );
  }
  phaseFindings.push({ phase: "DEEP BREATHING (DB) AND VALSALVA RESPONSES", indication: "Detection of early signs of autonomic dysfunction and chronic disease", findings: dbFindings });

  const standFindings: string[] = [];
  if (spectralAvailable) {
    standFindings.push(`${lfaF!.severity === "Normal" ? "Normal" : lfaF!.label} sympathetic response (LFa) to stand`);
    if (preSyncopeRisk) standFindings.push('A higher peak sympathetic response (LFa) to stand compared to the response during Valsalva suggesting a possible risk of pre-syncope [Check "HR" and "Trends" plot and EKG Report to rule out ectopy]');
    if (vasovagalRisk) standFindings.push("Relatively higher parasympathetic activation (RFa) compared to sympathetic activation (LFa) throughout the test suggesting risk of possible vasovagal pre-syncope");
    if (parasympatheticExcess) standFindings.push("High parasympathetic activation (RFa) indicating excess parasympathetic activity ** [Check for symptoms such as unstable BP and dizziness]");
  } else {
    standFindings.push("Spectral response to standing (LFa/RFa) not assessed — not reproducible from this recording.");
  }
  // HR response to standing IS supported (ECG-derived).
  if (hrDelta >= 10 && hrDelta <= 30) standFindings.push("Normal HR response");
  else if (hrDelta < 10) standFindings.push("Insufficient HR response to stand");
  else standFindings.push(`Excessive HR rise of ${hrDelta} bpm — POTS criteria`);
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
  let overall: string;
  if (!spectralAvailable) {
    // With only ECG-derived HR + Ewing ratios, we can only report those
    // supported observations — never an autonomic-dysfunction grading that
    // depends on spectral challenge responses.
    const abnormalRatios: string[] = [];
    if (ratios.eiRatio.classification.severity === "Abnormal") abnormalRatios.push("E/I ratio");
    if (ratios.valsalvaRatio.classification.severity === "Abnormal") abnormalRatios.push("Valsalva ratio");
    if (ratios.thirtyFifteenRatio.classification.severity === "Abnormal") abnormalRatios.push("30:15 ratio");
    const hrNote = POTS
      ? ` Heart-rate rise on standing (${hrDelta} bpm) meets the POTS threshold and warrants clinician review.`
      : bradycardia
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
  // Wellness runs on the raw numeric snapshot (estimated spectral) so the
  // composite index stays stable; it is an internal reserve score, not a
  // spectral clinical claim. All spectral CLAIMS remain gated above.
  const breakdown = computeWellness(data, phaseEventsRaw, patterns);
  const score = Math.round(breakdown.final);
  const tier = tierFromScore(score);

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
      const driver = classifyLowSbDriver(A.LFa as number, A.RFa as number);
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
        interpretation: "Sympathetic vs parasympathetic balance not assessed — the spectral measures (LFa/RFa/SB) are not reproducible from this recording. Clinician review of the vendor report is required.",
      };

  const clinicalFlags: string[] = [];
  if (highFRF) clinicalFlags.push(`High FRF during DB (${B.FRF.toFixed(2)} Hz) — recommend retest with relaxed breathing`);
  if (data.ectopicBeats > 0) clinicalFlags.push(`${data.ectopicBeats} possible ectopic beat(s) detected`);
  if (bradycardia) clinicalFlags.push(`Bradycardia: resting HR ${A.meanHR} bpm`);
  if (parasympatheticDominance) clinicalFlags.push(`Parasympathetic dominance: SB = ${A.SB}`);
  if (!spectralAvailable) clinicalFlags.push("Spectral measures (LFa/RFa/SB) and continuous BP not assessed — not reproducible from this recording; clinician review of the vendor report required.");

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
    if (highFRF && B.FRF != null && B.FRF > 0) {
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

  const bodySystemImpact = computeBodyImpact(patterns, phaseEvents, { spectralAvailable, bpAvailable });

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
  const indications = detectIndicationsLocal(phaseEvents, multiParameter, {
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
    bpAvailable,
    respiratoryFrequency: spectralAvailable ? A.FRF : null,
    rPeakCount: phaseEvents.reduce((n, p) => n + Math.round(p.meanHR * p.durationSec / 60), 0),
    generatedAt: new Date().toISOString(),
    multiParameter,
    indications,
  };
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
    let vendorMetrics: VendorReportedMetrics | undefined;
    const vmHeader = req.headers["x-vendor-metrics"];
    if (typeof vmHeader === "string" && vmHeader.trim()) {
      try {
        const parsed = JSON.parse(vmHeader);
        const pick = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
        vendorMetrics = {
          LFa: pick(parsed.LFa),
          RFa: pick(parsed.RFa),
          SB: pick(parsed.SB),
          SBP: pick(parsed.SBP),
          DBP: pick(parsed.DBP),
        };
      } catch {
        console.warn("[upload] ignoring malformed x-vendor-metrics header");
      }
    }
    const report = generateColomboReport(patientData, vendorMetrics);
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
