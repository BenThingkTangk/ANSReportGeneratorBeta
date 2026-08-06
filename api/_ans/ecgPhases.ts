/**
 * ECG-derived phase segmentation for the parse-only (`/api/parse`) path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Colombo / PhysioPS `.ans` files are **raw ECG waveform** exports. They do NOT
 * contain per-phase ASCII tables (no "Baseline HR = ...", no "Stand BP = ...").
 * The only ASCII in the header is demographics + the three Ewing ratios + an
 * ectopy note. Consequently the ASCII sectionizer can only ever find headings
 * that happen to appear as prose (e.g. the word "Valsalva" inside
 * "Valsalva Ratio = 1.43"), which produced the FINAL-QA defect:
 *   SECTIONS DETECTED: 1, and only a spurious "valsalva" phase.
 *
 * The six protocol phases must therefore be **derived generically from the raw
 * ECG signal**, exactly the way the report path (`/api/upload`) already does.
 * This module provides that derivation for `parseStudy` so the parse-review UI
 * exposes all four clinical phase blocks (baseline / deep breathing / valsalva /
 * stand) with a generically-computed heart rate + timing.
 *
 * PROVENANCE & SAFETY (hard rules preserved)
 * ------------------------------------------
 *   - Heart rate IS generically derivable from R-peaks -> emitted as
 *     `source: "computed"` (binary_int16-derived) with an honest confidence.
 *   - LFa / RFa / SB are ESTIMATED generically from the R-R series by
 *     `./spectral.ts` (Morlet band power in bpm-squared over
 *     respiration-adaptive bands) and emitted as `source: "computed"` with a
 *     confidence < 1 and an explicit "HumanOS estimate, not vendor-reported"
 *     warning on every field. The VENDOR's own aggregates use an undisclosed
 *     wavelet + calibration, so these values are NOT claimed to reproduce them
 *     and must never be presented as vendor-reported or PhysioPS-validated.
 *     When the calculation is genuinely impossible the field stays `missing`.
 *     NEVER fabricated, NEVER substituted by identity/hash, NEVER scaled by a
 *     constant fitted to a particular patient's report.
 *   - Blood pressure is not stored per-phase in the `.ans` -> stays missing.
 *   - No patient/file/fingerprint-specific branching. Pure function of the
 *     buffer + protocol fractions.
 */

import type {
  ProvField,
  PhaseBlock,
  BloodPressure,
} from "../../shared/ansStudy.js";
import { missingField } from "../../shared/ansStudy.js";
import type { SamplingProbe } from "./parseBinary.js";
import {
  estimatePhaseSpectral,
  estimateRespiratoryFrequencyFromPeaks,
  ESTIMATED_SPECTRAL_NOTE,
  ESTIMATED_SB_NOTE,
} from "./spectral.js";

// Canonical Colombo 6-phase protocol (durations in seconds). The recording is
// scaled to these fractions since the raw file carries no phase markers.
export interface ProtocolPhase {
  /** Clinical phase block this maps onto in AnsStudy. */
  block: "baseline" | "deep_breathing" | "valsalva" | "stand";
  label: string;
  durSec: number;
}

export const PROTOCOL_PHASES: ProtocolPhase[] = [
  { block: "baseline", label: "Baseline (A)", durSec: 300 },
  { block: "deep_breathing", label: "Deep Breathing (B)", durSec: 60 },
  { block: "baseline", label: "Baseline (C)", durSec: 60 },
  { block: "valsalva", label: "Valsalva (D)", durSec: 95 },
  { block: "baseline", label: "Baseline (E)", durSec: 150 },
  { block: "stand", label: "Stand (F)", durSec: 330 },
];

export interface DerivedPhaseTiming {
  block: ProtocolPhase["block"];
  label: string;
  startSec: number;
  endSec: number;
}

/** Segment a recording of `totalSec` into the six protocol phases by fraction. */
export function segmentProtocol(totalSec: number): DerivedPhaseTiming[] {
  const protoTotal = PROTOCOL_PHASES.reduce((a, p) => a + p.durSec, 0);
  const scale = totalSec > 0 ? totalSec / protoTotal : 0;
  const out: DerivedPhaseTiming[] = [];
  let t = 0;
  for (const p of PROTOCOL_PHASES) {
    const dur = p.durSec * scale;
    out.push({ block: p.block, label: p.label, startSec: t, endSec: t + dur });
    t += dur;
  }
  return out;
}

// ---------------------------------------------------------------------------
// R-peak detection (self-contained Pan-Tompkins-style feature + adaptive gate)
// ---------------------------------------------------------------------------

export interface RPeakResult {
  indices: number[];
  rrIntervalsMs: number[];
}

export function detectRPeaks(
  ecg: ArrayLike<number>,
  samplingRate: number,
): RPeakResult {
  const n = ecg.length;
  if (n < samplingRate * 2) return { indices: [], rrIntervalsMs: [] };

  const feat = new Float64Array(n);
  for (let i = 2; i < n - 2; i++) {
    const d = (2 * ecg[i + 1] + ecg[i + 2] - ecg[i - 2] - 2 * ecg[i - 1]) / 8;
    feat[i] = d * d;
  }

  const winN = Math.max(5, Math.floor(samplingRate * 0.15));
  const integ = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += feat[i];
    if (i >= winN) sum -= feat[i - winN];
    integ[i] = sum / winN;
  }

  const positive: number[] = [];
  for (let i = 0; i < n; i++) if (integ[i] > 0) positive.push(integ[i]);
  positive.sort((a, b) => a - b);
  const thresh = positive.length
    ? positive[Math.floor(positive.length * 0.975)] * 0.4
    : 0;

  const refractoryN = Math.floor(samplingRate * 0.25);
  const peaks: number[] = [];
  let lastPeak = -refractoryN;
  for (let i = 1; i < n - 1; i++) {
    if (
      integ[i] > thresh &&
      integ[i] > integ[i - 1] &&
      integ[i] >= integ[i + 1] &&
      i - lastPeak > refractoryN
    ) {
      const search = Math.floor(samplingRate * 0.06);
      let best = i;
      let bestVal = ecg[i];
      for (let j = Math.max(0, i - search); j < Math.min(n, i + search); j++) {
        if (ecg[j] > bestVal) {
          bestVal = ecg[j];
          best = j;
        }
      }
      peaks.push(best);
      lastPeak = best;
    }
  }

  const rrIntervalsMs: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = ((peaks[i] - peaks[i - 1]) / samplingRate) * 1000;
    if (ms > 300 && ms < 2000) rrIntervalsMs.push(ms);
  }
  return { indices: peaks, rrIntervalsMs };
}

// ---------------------------------------------------------------------------
// Per-phase heart-rate computation
// ---------------------------------------------------------------------------

function computedHr(
  value: number,
  samplingProbeOffset: number,
  beats: number,
  confidence: number,
): ProvField<number> {
  return {
    value,
    unit: "bpm",
    provenance: {
      source: "binary_int16",
      offset: samplingProbeOffset,
      matchedLabel: "ecg_derived_mean_hr",
      confidence,
      warnings: [
        `Heart rate computed from ${beats} ECG-derived R-R intervals (no ASCII phase table in file).`,
      ],
    },
  };
}

function emptyBp(): BloodPressure {
  return {
    sbp: missingField<number>("BP not stored per-phase in .ans"),
    dbp: missingField<number>("BP not stored per-phase in .ans"),
    map: missingField<number>("MAP not stored per-phase in .ans"),
  };
}

/**
 * Build a PhaseBlock for one clinical block from the ECG segment(s) that fall
 * inside it. `segments` are the protocol timing windows mapped to this block
 * (baseline maps to three windows A/C/E; the rest map to one).
 *
 * HR is computed generically. Vendor spectral aggregates stay missing.
 */
export function buildEcgDerivedPhase(
  ecg: Int16Array,
  sampling: SamplingProbe,
  block: ProtocolPhase["block"],
  segments: DerivedPhaseTiming[],
): PhaseBlock {
  const fs = sampling.samplingRateHz;
  const mine = segments.filter((s) => s.block === block);
  if (mine.length === 0) {
    return {
      present: false,
      startSec: missingField<number>("phase not in protocol"),
      endSec: missingField<number>("phase not in protocol"),
      heartRate: missingField<number>("phase not in protocol"),
      bp: emptyBp(),
      lfa: missingField<number>("phase not in protocol"),
      rfa: missingField<number>("phase not in protocol"),
      sb: missingField<number>("phase not in protocol"),
      notes: [],
    };
  }

  // CANONICAL BASELINE = the FIRST baseline window (A) only.
  //
  // The parse payload used to pool A + C + E for the baseline block while the
  // report engine used Baseline-A alone. The same response therefore published a
  // resting HR of 64 (pooled) and 63 (A-only), and consequently a stand delta of
  // both 8 and 9 bpm. One definition now serves both: the resting reference is
  // the initial baseline window, exactly as the report engine and the vendor
  // protocol treat it. The later baseline windows (C/E) are recovery periods
  // between challenges and are reported as their own phases, not averaged into
  // "resting".
  const windows = block === "baseline" ? [mine[0]] : mine;

  // Collect R-R intervals (and the R-peak envelope, for the respiration
  // estimate) across every window that maps to this block.
  const allRr: number[] = [];
  const peakIdx: number[] = [];
  const peakAmp: number[] = [];
  for (const seg of windows) {
    const i0 = Math.max(0, Math.floor(seg.startSec * fs));
    const i1 = Math.min(ecg.length, Math.floor(seg.endSec * fs));
    if (i1 - i0 < fs * 2) continue;
    const slice = ecg.subarray(i0, i1);
    const { rrIntervalsMs, indices } = detectRPeaks(slice, fs);
    for (const rr of rrIntervalsMs) allRr.push(rr);
    for (const idx of indices) {
      peakIdx.push(i0 + idx);
      peakAmp.push(ecg[i0 + idx]);
    }
  }

  const startSecVal = Math.min(...windows.map((s) => s.startSec));
  const endSecVal = Math.max(...windows.map((s) => s.endSec));
  const startSec: ProvField<number> = {
    value: Math.round(startSecVal * 10) / 10,
    unit: "s",
    provenance: {
      source: "computed",
      matchedLabel: "protocol_fraction",
      confidence: 0.6,
      warnings: ["Phase timing derived from protocol fractions, not file markers."],
    },
  };
  const endSec: ProvField<number> = {
    value: Math.round(endSecVal * 10) / 10,
    unit: "s",
    provenance: {
      source: "computed",
      matchedLabel: "protocol_fraction",
      confidence: 0.6,
    },
  };

  let heartRate: ProvField<number>;
  if (allRr.length >= 4) {
    const meanRr = allRr.reduce((a, b) => a + b, 0) / allRr.length;
    const bpm = Math.round(60000 / meanRr);
    // Confidence scales with beat count (more beats -> steadier estimate),
    // capped at 0.85 because there are no in-file phase markers.
    const conf = Math.min(0.85, 0.5 + allRr.length / 400);
    heartRate = computedHr(
      bpm,
      sampling.dataStartOffset,
      allRr.length,
      Math.round(conf * 100) / 100,
    );
  } else {
    heartRate = missingField<number>(
      "Fewer than 4 usable R-R intervals in this phase window.",
    );
  }

  const label = mine.map((s) => s.label).join(" + ");

  // --- Generic waveform-derived spectral estimate ----------------------------
  const frf = estimateRespiratoryFrequencyFromPeaks(peakIdx, peakAmp, fs);
  const est = estimatePhaseSpectral({
    rrIntervalsMs: allRr,
    respFreqHz: frf,
    pacedBreathing: block === "deep_breathing",
  });
  const estimateWarnings = [ESTIMATED_SPECTRAL_NOTE, ...est.warnings];
  const estField = (
    value: number | null,
    name: "LFa" | "RFa" | "SB",
    note: string,
  ): ProvField<number> =>
    value == null
      ? missingField<number>(
          `${name} could not be estimated from the raw ECG for this phase: ` +
            (est.warnings[0] ?? "insufficient usable R-R data.") +
            " A vendor-reported value, if any, exists only in the signed PDF.",
        )
      : {
          value,
          unit: name === "SB" ? "ratio" : "bpm^2",
          provenance: {
            source: "computed",
            offset: sampling.dataStartOffset,
            matchedLabel: `humanos_estimated_${name.toLowerCase()}`,
            // Capped well below 1: an unvalidated approximation of a
            // proprietary aggregate can never be a high-confidence field.
            confidence: est.confidence,
            warnings: [note, ...estimateWarnings.slice(1)],
          },
        };

  return {
    present: true,
    startSec,
    endSec,
    heartRate,
    bp: emptyBp(),
    // HumanOS ESTIMATES with explicit computed provenance — never presented as
    // vendor-reported, never validated against PhysioPS output.
    lfa: estField(est.lfa, "LFa", ESTIMATED_SPECTRAL_NOTE),
    rfa: estField(est.rfa, "RFa", ESTIMATED_SPECTRAL_NOTE),
    sb: estField(est.sb, "SB", ESTIMATED_SB_NOTE),
    notes: [
      `ECG-derived phase (${label}); HR computed from raw waveform.`,
      est.lfa == null && est.rfa == null
        ? "LFa/RFa could not be estimated from this phase's waveform; the vendor's own values exist only in the signed PDF."
        : `LFa/RFa/SB are HumanOS estimates computed from ${est.beats} R-R intervals ` +
          `(Morlet band power, bpm^2, ${est.bands.bandSource} bands ` +
          `sympathetic ${est.bands.lfLo}-${est.bands.lfHi} Hz / respiratory ${est.bands.hfLo.toFixed(2)}-${est.bands.hfHi.toFixed(2)} Hz), ` +
          "not vendor-reported values and not validated against PhysioPS output.",
    ],
  };
}

export interface EcgDerivedPhases {
  baseline: PhaseBlock;
  deepBreathing: PhaseBlock;
  valsalva: PhaseBlock;
  stand: PhaseBlock;
  timings: DerivedPhaseTiming[];
  totalSec: number;
}

/**
 * Top-level: derive all four clinical phase blocks from the raw ECG.
 * Pure function of (ecg, sampling). No file/patient-specific branching.
 */
export function deriveEcgPhases(
  ecg: Int16Array,
  sampling: SamplingProbe,
): EcgDerivedPhases {
  const totalSec = sampling.dataPointCount * sampling.samplingInterval;
  const timings = segmentProtocol(totalSec);
  return {
    baseline: buildEcgDerivedPhase(ecg, sampling, "baseline", timings),
    deepBreathing: buildEcgDerivedPhase(ecg, sampling, "deep_breathing", timings),
    valsalva: buildEcgDerivedPhase(ecg, sampling, "valsalva", timings),
    stand: buildEcgDerivedPhase(ecg, sampling, "stand", timings),
    timings,
    totalSec,
  };
}
