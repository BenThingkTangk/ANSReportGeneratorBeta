/**
 * spectral — GENERIC waveform-derived spectral engine (HumanOS estimates).
 *
 * WHY THIS MODULE EXISTS
 * ---------------------
 * The `.ans` export is a raw int16 ECG waveform. The vendor (P&S / PhysioPS)
 * prints per-phase LFa / RFa / SB aggregates in its signed PDF but does not
 * store them in the file, and its wavelet implementation + calibration are
 * undisclosed. A previous beta build DID compute these quantities generically
 * from the waveform, but multiplied the result by an empirical constant
 * (`SCALE = 0.0018`) that had been curve-fit to a single patient's report, and
 * published the output as if it were a measurement. Commit 74bdde7 removed
 * both that constant AND the whole generic engine, after which every
 * waveform-derived spectral value in production became `null` — including the
 * ones that are legitimately computable from an R-R series with standard,
 * published signal processing.
 *
 * This module restores the generic engine WITHOUT the patient-fit calibration:
 *
 *   1. R-R intervals -> instantaneous heart rate in **bpm** (60000/RR).
 *      The vendor reports LFa/RFa in bpm², so the unit conversion is done on
 *      the SIGNAL, physically, instead of by a fitted output multiplier.
 *   2. Uniform resampling at 4 Hz + linear detrend (standard HRV practice).
 *   3. Morlet continuous-wavelet band power with an ANALYTIC, unit-preserving
 *      normalisation (derived below, no free parameters). Feeding it a bpm
 *      series therefore yields bpm² directly.
 *   4. Respiration-adaptive band edges (Colombo-style dynamic bands) when a
 *      fundamental respiratory frequency (FRF) could be estimated, falling
 *      back to the fixed Task-Force LF/HF band edges when it could not.
 *
 * PROVENANCE — NON-NEGOTIABLE
 * ---------------------------
 * Everything this module returns is an **estimate computed by HumanOS**. It is
 * never vendor-reported, and it is NOT asserted to reproduce PhysioPS numbers.
 * Callers must tag these values `computedProvenance(..., { validated: false })`
 * so `mayInterpretClinically()` keeps them out of diagnostic / treatment logic
 * until a validation study against paired vendor reports is performed. They are
 * publishable as clearly-labelled estimates, charts and trends.
 *
 * NO patient-specific, filename-specific, demographic or vendor-value input is
 * read anywhere in this file. Every function is a pure function of the sample
 * array and the sampling rate.
 *
 * ANALYTIC NORMALISATION (why there is no SCALE constant)
 * ------------------------------------------------------
 * With envelope g(t) = exp(-t²/2σ²), σ = Q/(2πf), the discrete transform
 *
 *     W(f,τ) = Δt · Σ_i x_i · g(t_i-τ) · exp(-i2πf(t_i-τ))
 *
 * is a linear filter with |G(ν)|² = 2πσ² · exp(-4π²σ²(ν-f)²). For a real
 * signal the complex exponential only picks up the positive-frequency half, so
 * E|W(f)|² = S₂(f)·σ√π with S₂ the TWO-sided density; the one-sided band power
 * is therefore
 *
 *     P_band = 2 · Σ_f  ⟨|W(f,τ)|²⟩_τ / (σ(f)·√π) · Δf
 *
 * which recovers exactly A²/2 (the variance) for a sinusoid of amplitude A
 * inside the band, and σ²·Δf/(f_Nyquist) for white noise. `morletBandPower`
 * implements that identity; the synthetic round-trip tests in
 * `__tests__/spectralEngine.spec.ts` assert both cases. The factor 2 is a
 * two-sided→one-sided density conversion, not a fitted calibration.
 * References: Task Force of ESC/NASPE 1996 (band definitions, resampling);
 * Torrence & Compo 1998 (wavelet normalisation).
 */

/** Standard Task-Force fixed band edges (fallback when FRF is unknown). */
export const FIXED_LF_BAND = { lo: 0.04, hi: 0.15 } as const;
export const FIXED_HF_BAND = { lo: 0.15, hi: 0.4 } as const;

/** Uniform resampling rate for the R-R derived series (Hz). */
export const RESAMPLE_FS = 4;

export interface SpectralBands {
  lfLo: number;
  lfHi: number;
  hfLo: number;
  hfHi: number;
  /** How the band edges were chosen. */
  bandSource: "respiration_adaptive" | "fixed_standard";
  /** Respiratory frequency the adaptive bands were built from (Hz), if any. */
  respFreqHz: number | null;
}

/**
 * Respiration-adaptive ("dynamic") band edges.
 *
 * The parasympathetic (RFa) band is centred on the measured respiratory
 * frequency (±0.15 Hz, floored at 0.04 Hz); the sympathetic (LFa) band runs
 * from 0.04 Hz up to the bottom of the respiratory band, capped at 0.15 Hz so
 * a very slow breather cannot swallow the whole LF range.
 *
 * When no respiratory frequency could be estimated we DO NOT invent one (the
 * old code silently substituted 0.2 Hz): we fall back to the fixed published
 * band edges and say so via `bandSource`.
 */
export function respirationAdaptiveBands(
  respFreqHz: number | null,
  opts: { pacedBreathing?: boolean } = {},
): SpectralBands {
  const fixed: SpectralBands = {
    lfLo: FIXED_LF_BAND.lo,
    lfHi: FIXED_LF_BAND.hi,
    hfLo: FIXED_HF_BAND.lo,
    hfHi: FIXED_HF_BAND.hi,
    bandSource: "fixed_standard",
    respFreqHz: respFreqHz != null && Number.isFinite(respFreqHz) && respFreqHz > 0 ? respFreqHz : null,
  };
  if (respFreqHz == null || !Number.isFinite(respFreqHz) || respFreqHz <= 0) {
    return { ...fixed, respFreqHz: null };
  }

  if (respFreqHz >= FIXED_HF_BAND.lo) {
    // Normal / fast breathing: widen the respiratory band around the measured
    // frequency but never let it descend into the LF range, and leave the LF
    // band at its published edges.
    return {
      lfLo: FIXED_LF_BAND.lo,
      lfHi: FIXED_LF_BAND.hi,
      hfLo: Math.max(FIXED_HF_BAND.lo, respFreqHz - 0.15),
      hfHi: Math.min(0.6, respFreqHz + 0.15),
      bandSource: "respiration_adaptive",
      respFreqHz,
    };
  }

  // Respiration BELOW 0.15 Hz (slower than 9 breaths/min) sits inside the
  // classical LF band, so the two bands cannot both keep their published edges.
  //
  //  * During PACED deep breathing that is expected and the whole point of the
  //    manoeuvre, so we track respiration with a narrow (+/-0.04 Hz) band and
  //    keep whatever LF range is left below it.
  //  * During SPONTANEOUS breathing a sub-0.15 Hz estimate is more often an
  //    envelope-tracking artefact than a real 9-breath/min resting pattern, so
  //    we do NOT reshape the bands on the strength of it: we fall back to the
  //    published fixed edges and record `bandSource: "fixed_standard"` so the
  //    caller can warn that respiration may contaminate the LF band.
  if (!opts.pacedBreathing) return fixed;

  const hfLo = Math.max(0.05, respFreqHz - 0.04);
  const hfHi = respFreqHz + 0.04;
  const lfHi = Math.min(FIXED_LF_BAND.hi, hfLo);
  return {
    lfLo: FIXED_LF_BAND.lo,
    lfHi,
    hfLo,
    hfHi,
    bandSource: "respiration_adaptive",
    respFreqHz,
  };
}

/**
 * Resample an R-R interval list onto a uniform grid, expressed as
 * INSTANTANEOUS HEART RATE IN BPM, then remove the linear trend.
 *
 * Returning bpm (not ms) is what makes the band powers come out in bpm² — the
 * unit the vendor reports — without any fitted output scaling. Linear (rather
 * than mean-only) detrending keeps very-low-frequency drift out of the LF band.
 *
 * Returns [] when there are too few intervals to resample.
 */
/**
 * Physiologic bounds for a usable R-R interval (ms). 240 ms = 250 bpm, 3000 ms =
 * 20 bpm. Anything outside is a detection artefact, not a heartbeat.
 */
export const MIN_RR_MS = 240;
export const MAX_RR_MS = 3000;

/** Keep only finite, physiologically possible intervals. Never coerce. */
export function usableRrIntervals(rrMs: number[]): number[] {
  return rrMs.filter((v) => Number.isFinite(v) && v >= MIN_RR_MS && v <= MAX_RR_MS);
}

export function interpolateRRtoBpm(rrIn: number[], targetFs: number = RESAMPLE_FS): number[] {
  // Guard at the boundary: a NaN / Infinity / negative / absurd interval would
  // otherwise poison the cumulative time base (and could throw on the array
  // allocation below). Dropping them is the honest behaviour — the resulting
  // series is non-contiguous, which is what lowers the reported confidence.
  const rrMs = usableRrIntervals(rrIn);
  if (rrMs.length < 4 || targetFs <= 0) return [];

  // Beat times: the i-th interval ends at cumulative time t[i+1].
  const times: number[] = [0];
  for (let i = 0; i < rrMs.length; i++) times.push(times[i] + rrMs[i] / 1000);
  const duration = times[times.length - 1];
  const n = Math.floor(duration * targetFs);
  if (!Number.isFinite(n) || n < 8) return [];

  // Instantaneous HR sample associated with each beat time (step-wise pairs).
  const bpmAt: number[] = rrMs.map((rr) => 60000 / rr);

  const out = new Array<number>(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / targetFs;
    while (k < rrMs.length - 1 && times[k + 1] < t) k++;
    const t0 = times[k];
    const t1 = times[k + 1];
    const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const v0 = bpmAt[k];
    const v1 = k + 1 < bpmAt.length ? bpmAt[k + 1] : v0;
    out[i] = v0 + Math.min(1, Math.max(0, frac)) * (v1 - v0);
  }

  return detrendLinear(out);
}

/**
 * Resample beat times + R-R intervals onto a uniform bpm grid spanning
 * [0, totalSec) of RECORD time.
 *
 * Unlike `interpolateRRtoBpm` (which rebuilds its own time base by accumulating
 * intervals) this keeps every sample anchored to the position of the beat in the
 * recording, so it stays aligned with the protocol phase boundaries even when
 * artefact beats were dropped. Gaps left by dropped beats are bridged linearly,
 * which is standard practice but does attenuate variability across the gap.
 */
export function resampleBeatsToBpmGrid(
  beatTimesSec: number[],
  rrMs: number[],
  totalSec: number,
  targetFs: number = RESAMPLE_FS,
): number[] {
  const n = Math.floor(totalSec * targetFs);
  if (beatTimesSec.length < 4 || rrMs.length !== beatTimesSec.length || n < 16) return [];
  const bpm = rrMs.map((rr) => 60000 / rr);
  const out = new Array<number>(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / targetFs;
    while (k < beatTimesSec.length - 2 && beatTimesSec[k + 1] < t) k++;
    const t0 = beatTimesSec[k];
    const t1 = beatTimesSec[k + 1];
    const frac = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    out[i] = bpm[k] + frac * (bpm[k + 1] - bpm[k]);
  }
  return out;
}

/**
 * Remove content slower than ~1/windowSec by subtracting a centred moving
 * average.
 *
 * Used for the WHOLE-RECORD rolling trend, where a single linear detrend cannot
 * remove the step changes in heart rate that the protocol itself provokes (e.g.
 * the rise on standing). Such a step is broadband and would otherwise be read
 * as a large sympathetic-band power. The default 40 s window has a cut-off near
 * 0.025 Hz, i.e. BELOW the 0.04 Hz bottom of the sympathetic band, so genuine
 * in-band content is preserved.
 */
export function highPassMovingAverage(x: number[], fs: number, windowSec = 40): number[] {
  const n = x.length;
  const w = Math.max(3, Math.round(windowSec * fs));
  if (n === 0 || n <= w) return detrendLinear(x);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const half = Math.floor(w / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = x[i] - (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/** Remove the least-squares linear trend (in place on a copy). */
export function detrendLinear(x: number[]): number[] {
  const n = x.length;
  if (n === 0) return [];
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += x[i];
    sxx += i * i;
    sxy += i * x[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - (intercept + slope * i);
  return out;
}

/**
 * Morlet continuous-wavelet band power, in the SQUARED UNITS OF THE INPUT.
 *
 * `Q` is the number of cycles in the wavelet (5 is the conventional choice and
 * the one described for the vendor's dynamic-band method). There is NO
 * empirical output multiplier: see the analytic normalisation in the file
 * header. Returns null when the segment is too short to support the band.
 */
export function morletBandPower(
  signal: number[],
  fs: number,
  fLo: number,
  fHi: number,
  Q: number = 5,
): number | null {
  const scan = scanBand(signal, fs, fLo, fHi, Q);
  if (scan == null) return null;
  let power = 0;
  for (const row of scan.rows) {
    if (row.times.length === 0) continue;
    let acc = 0;
    for (const v of row.density) acc += v;
    power += (acc / row.density.length) * scan.df;
  }
  return power > 0 ? power : 0;
}

/** Number of frequency bins per band. Fine enough for a narrow adaptive band. */
const N_FREQ_BINS = 24;

interface BandScanRow {
  f: number;
  /** Centre times (s) whose 3σ support lay fully inside the record. */
  times: number[];
  /** One-sided spectral density at each centre time (input-units² per Hz). */
  density: number[];
}
interface BandScan {
  rows: BandScanRow[];
  df: number;
}

/**
 * Single Morlet CWT pass over `signal` for every frequency bin of one band.
 *
 * Cost control (this is the hot path — a full study is ~1000 s at 4 Hz and the
 * rolling trends re-use this ONE pass instead of re-transforming every window):
 * the centre spacing is tied to the wavelet width (σ/4, floored at one sample),
 * because neighbouring coefficients closer than that are almost perfectly
 * correlated and add cost without adding information.
 *
 * Returns null when the record cannot support the band's lowest frequency.
 */
function scanBand(
  signal: number[],
  fs: number,
  fLo: number,
  fHi: number,
  Q: number,
): BandScan | null {
  const N = signal.length;
  if (N < 16 || fLo >= fHi || fLo <= 0 || fs <= 0) return null;

  // A wavelet at the band's lowest frequency needs ~2σ of record on each side
  // of at least one evaluation point; otherwise the estimate is dominated by
  // edge truncation and we decline to produce a number.
  const sigmaMax = Q / (2 * Math.PI * fLo);
  if (N / fs < 2 * sigmaMax) return null;

  const dt = 1 / fs;
  const df = (fHi - fLo) / N_FREQ_BINS;
  const rows: BandScanRow[] = [];

  for (let iF = 0; iF < N_FREQ_BINS; iF++) {
    const f = fLo + (iF + 0.5) * df;
    const sigma = Q / (2 * Math.PI * f);
    const halfWin = Math.floor(sigma * fs * 3);
    const row: BandScanRow = { f, times: [], density: [] };
    rows.push(row);
    if (halfWin < 2) continue;
    const first = halfWin;
    const last = N - halfWin - 1;
    if (last <= first) continue;
    const stepN = Math.max(1, Math.round(sigma * fs * 0.25));

    // Pre-compute the (symmetric) envelope and the complex carrier once per
    // frequency; they are identical at every centre.
    const len = 2 * halfWin + 1;
    const envCos = new Float64Array(len);
    const envSin = new Float64Array(len);
    for (let k = 0; k < len; k++) {
      const t = (k - halfWin) * dt;
      const env = Math.exp((-t * t) / (2 * sigma * sigma));
      const ph = 2 * Math.PI * f * t;
      envCos[k] = env * Math.cos(ph);
      envSin[k] = env * Math.sin(ph);
    }
    // S₂(f) = E|W|²/(σ√π); one-sided density = 2·S₂(f)
    const norm = 2 / (sigma * Math.sqrt(Math.PI));

    for (let c = first; c <= last; c += stepN) {
      let re = 0;
      let im = 0;
      const base = c - halfWin;
      for (let k = 0; k < len; k++) {
        const x = signal[base + k];
        re += x * envCos[k];
        im += x * envSin[k];
      }
      re *= dt;
      im *= dt;
      row.times.push(c * dt);
      row.density.push((re * re + im * im) * norm);
    }
  }

  return rows.some((r) => r.times.length > 0) ? { rows, df } : null;
}

export interface BandPowerSeries {
  /** Window centre times (s from the start of `signal`). */
  t: number[];
  /** Band power in each window (input-units²). */
  v: number[];
}

/**
 * Rolling band power from ONE wavelet pass over the whole signal.
 *
 * The previous beta implementation re-ran the transform for every window, which
 * with a window long enough to resolve 0.04 Hz is both slow and redundant
 * (adjacent windows overlap by >90%). Here the coefficients are computed once
 * and averaged inside each window, which is both faster and edge-consistent.
 *
 * Windows containing no valid coefficient for any frequency bin are omitted
 * rather than reported as zero.
 */
export function morletBandPowerSeries(
  signal: number[],
  fs: number,
  fLo: number,
  fHi: number,
  opts: { windowSec: number; stepSec: number; Q?: number },
): BandPowerSeries {
  const { windowSec, stepSec, Q = 5 } = opts;
  const out: BandPowerSeries = { t: [], v: [] };
  const scan = scanBand(signal, fs, fLo, fHi, Q);
  if (scan == null || windowSec <= 0 || stepSec <= 0) return out;

  const totalSec = signal.length / fs;
  // Per-row cursor so the whole thing stays O(coefficients) across all windows.
  const cursor = new Array<number>(scan.rows.length).fill(0);

  for (let start = 0; start + windowSec <= totalSec + 1e-9; start += stepSec) {
    const end = start + windowSec;
    let power = 0;
    let usedRows = 0;
    for (let r = 0; r < scan.rows.length; r++) {
      const row = scan.rows[r];
      if (row.times.length === 0) continue;
      while (cursor[r] > 0 && row.times[cursor[r] - 1] >= start) cursor[r]--;
      while (cursor[r] < row.times.length && row.times[cursor[r]] < start) cursor[r]++;
      let acc = 0;
      let n = 0;
      for (let i = cursor[r]; i < row.times.length && row.times[i] <= end; i++) {
        acc += row.density[i];
        n++;
      }
      if (n === 0) continue;
      power += (acc / n) * scan.df;
      usedRows++;
    }
    if (usedRows === 0) continue;
    out.t.push(start + windowSec / 2);
    out.v.push(power);
  }
  return out;
}

export interface PhaseSpectralEstimate {
  /** Sympathetic-band power estimate (bpm²) — HumanOS estimate, not vendor. */
  lfa: number | null;
  /** Respiratory/parasympathetic-band power estimate (bpm²). */
  rfa: number | null
  /** LFa/RFa ratio ("sympathovagal balance") of the two estimates. */
  sb: number | null;
  /** Band edges actually used. */
  bands: SpectralBands;
  /** 0..1 self-assessed confidence in the estimate (never a clinical gate). */
  confidence: number;
  /** Human-readable reasons the estimate is uncertain (may be empty). */
  warnings: string[];
  /** Number of R-R intervals the estimate was built from. */
  beats: number;
}

export interface PhaseSpectralInput {
  rrIntervalsMs: number[];
  /** Estimated fundamental respiratory frequency for this segment (Hz) or null. */
  respFreqHz: number | null;
  /** Artifact beats/intervals already excluded upstream (drives confidence). */
  rejectedArtifactBeats?: number;
  rejectedArtifactIntervals?: number;
  /** True when the segment's variability metrics failed the plausibility gate. */
  variabilityImplausible?: boolean;
  /**
   * True for a PACED breathing manoeuvre (the protocol's deep-breathing phase),
   * where a respiratory frequency below 0.15 Hz is expected rather than
   * suspicious. Generic protocol property — not patient-specific.
   */
  pacedBreathing?: boolean;
  fs?: number;
  Q?: number;
}

/**
 * ECG-Derived Respiration (EDR): fundamental respiratory frequency (Hz) from
 * R-peak amplitude modulation (chest expansion modulates QRS amplitude).
 *
 * Moved here from the report engine so the canonical parser and the report
 * pipeline share ONE implementation instead of drifting apart.
 *
 * NO FABRICATED DEFAULT: the pre-removal code returned 0.2 Hz whenever the
 * envelope was too short to analyse, publishing an invented respiratory rate as
 * a measurement. Insufficient data returns null.
 */
export function estimateRespiratoryFrequencyFromPeaks(
  rPeakIndices: number[],
  rPeakAmplitudes: number[],
  samplingRate: number,
  fs: number = RESAMPLE_FS,
): number | null {
  if (rPeakIndices.length < 8 || rPeakAmplitudes.length !== rPeakIndices.length) return null;

  const duration = (rPeakIndices[rPeakIndices.length - 1] - rPeakIndices[0]) / samplingRate;
  const n = Math.max(16, Math.floor(duration * fs));
  if (n < 16 || !Number.isFinite(n)) return null;

  const t0 = rPeakIndices[0] / samplingRate;
  const resampled = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fs;
    while (k < rPeakIndices.length - 2 && rPeakIndices[k + 1] / samplingRate < t) k++;
    const tlo = rPeakIndices[k] / samplingRate;
    const thi = rPeakIndices[k + 1] / samplingRate;
    const frac = Math.min(1, Math.max(0, (t - tlo) / Math.max(1e-6, thi - tlo)));
    resampled[i] = rPeakAmplitudes[k] + frac * (rPeakAmplitudes[k + 1] - rPeakAmplitudes[k]);
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += resampled[i];
  mean /= n;
  for (let i = 0; i < n; i++) resampled[i] -= mean;

  // Goertzel-style scan of the physiological respiratory band.
  let bestFreq: number | null = null;
  let bestPower = 0;
  for (let f = 0.08; f <= 0.45 + 1e-9; f += 0.005) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const ph = 2 * Math.PI * f * (i / fs);
      re += resampled[i] * Math.cos(ph);
      im += resampled[i] * Math.sin(ph);
    }
    const power = (re * re + im * im) / n;
    if (power > bestPower) {
      bestPower = power;
      bestFreq = f;
    }
  }
  return bestFreq == null ? null : Math.round(bestFreq * 1000) / 1000;
}

/** Minimum usable intervals before a band-power estimate is attempted. */
export const MIN_BEATS_FOR_SPECTRAL = 12;

/**
 * Estimate LFa / RFa / SB for one segment from its R-R series.
 *
 * Returns nulls ONLY when the computation is genuinely impossible (too few
 * usable intervals, or a segment too short to support the lowest band
 * frequency). Quality problems that merely degrade the estimate lower
 * `confidence` and add `warnings` — they do not blank the outputs, because the
 * raw measurable trend remains useful even when a composite clinical score has
 * to be withheld.
 */
export function estimatePhaseSpectral(input: PhaseSpectralInput): PhaseSpectralEstimate {
  const {
    rrIntervalsMs,
    respFreqHz,
    rejectedArtifactBeats = 0,
    rejectedArtifactIntervals = 0,
    variabilityImplausible = false,
    pacedBreathing = false,
    fs = RESAMPLE_FS,
    Q = 5,
  } = input;

  const bands = respirationAdaptiveBands(respFreqHz, { pacedBreathing });
  const warnings: string[] = [];
  // Count only intervals that CAN carry information; an unusable interval must
  // not inflate the beat count that gates the estimate.
  const usable = usableRrIntervals(rrIntervalsMs);
  const beats = usable.length;
  if (beats < rrIntervalsMs.length) {
    warnings.push(
      `${rrIntervalsMs.length - beats} non-physiologic R-R interval(s) were excluded before spectral estimation.`,
    );
  }

  if (beats < MIN_BEATS_FOR_SPECTRAL) {
    return {
      lfa: null,
      rfa: null,
      sb: null,
      bands,
      confidence: 0,
      warnings: [
        ...warnings,
        `Fewer than ${MIN_BEATS_FOR_SPECTRAL} usable R-R intervals (${beats}) — band power cannot be estimated.`,
      ],
      beats,
    };
  }

  const series = interpolateRRtoBpm(usable, fs);
  if (series.length < 16) {
    return {
      lfa: null,
      rfa: null,
      sb: null,
      bands,
      confidence: 0,
      warnings: [...warnings, "Resampled R-R series too short for spectral estimation."],
      beats,
    };
  }

  const lfaRaw = morletBandPower(series, fs, bands.lfLo, bands.lfHi, Q);
  const rfaRaw = morletBandPower(series, fs, bands.hfLo, bands.hfHi, Q);

  if (lfaRaw == null && rfaRaw == null) {
    return {
      lfa: null,
      rfa: null,
      sb: null,
      bands,
      confidence: 0,
      warnings: [
        ...warnings,
        "Segment is shorter than the wavelet support required by the lowest band frequency — band power cannot be estimated.",
      ],
      beats,
    };
  }

  // ---- confidence + uncertainty (never a substitute for the clinical gate) --
  let confidence = 0.6; // ceiling for an unvalidated proprietary approximation
  if (bands.bandSource === "fixed_standard") {
    confidence -= 0.15;
    warnings.push(
      bands.respFreqHz == null
        ? "Respiratory frequency could not be estimated for this segment, so the published fixed band edges (sympathetic 0.04-0.15 Hz, respiratory 0.15-0.40 Hz) were used instead of respiration-adaptive edges."
        : `Estimated respiratory frequency (${bands.respFreqHz.toFixed(2)} Hz) falls inside the sympathetic band, so fixed standard band edges were used; respiration may contribute to the LFa estimate for this segment.`,
    );
  }
  const durationSec = series.length / fs;
  if (durationSec < 60) {
    confidence -= 0.1;
    warnings.push(
      `Segment is ${Math.round(durationSec)} s; short segments widen the uncertainty of the sympathetic-band (LFa) estimate, whose slowest rhythms need about two minutes to resolve.`,
    );
  }
  if (rejectedArtifactBeats > 0 || rejectedArtifactIntervals > 0) {
    confidence -= 0.1;
    warnings.push(
      `${rejectedArtifactBeats} artifact beat(s) and ${rejectedArtifactIntervals} artifact-spanning interval(s) were excluded before spectral estimation; the remaining series is non-contiguous, which biases band power.`,
    );
  }
  if (variabilityImplausible) {
    confidence -= 0.2;
    warnings.push(
      "Beat-to-beat variability exceeded overall variability in this segment (R-peak mis-detection signature), so the band powers are reported as low-confidence estimates only.",
    );
  }
  if (bands.lfHi - bands.lfLo < 0.03) {
    confidence -= 0.1;
    warnings.push(
      `Respiration-adaptive sympathetic band is only ${(bands.lfHi - bands.lfLo).toFixed(3)} Hz wide, which limits the resolution of the LFa estimate.`,
    );
  }
  confidence = Math.max(0.05, Math.round(confidence * 100) / 100);

  const lfa = lfaRaw == null ? null : Math.round(lfaRaw * 100) / 100;
  const rfa = rfaRaw == null ? null : Math.round(rfaRaw * 100) / 100;
  // A ratio of two estimates is only meaningful when the denominator is
  // resolvable; a near-zero RFa would produce an explosive, meaningless SB.
  const sb =
    lfa != null && rfa != null && rfa >= 0.01 ? Math.round((lfa / rfa) * 100) / 100 : null;
  if (lfa != null && rfa != null && sb == null) {
    warnings.push(
      "Respiratory-band power is at or below the resolution floor, so the LFa/RFa ratio is not reported for this segment.",
    );
  }

  return { lfa, rfa, sb, bands, confidence, warnings, beats };
}

/** Standard note attached to every waveform-derived spectral value. */
export const ESTIMATED_SPECTRAL_NOTE =
  "Estimated by HumanOS from the raw ECG-derived R-R series (Morlet wavelet band power in bpm-squared, respiration-adaptive bands). This is NOT a vendor-reported value and has not been validated against PhysioPS output; do not read it as vendor parity.";

export const ESTIMATED_SB_NOTE =
  "Ratio of the two HumanOS band-power estimates (LFa/RFa). Estimated, not vendor-reported, and not validated against PhysioPS output.";

export const ESTIMATED_FRF_NOTE =
  "Fundamental respiratory frequency estimated by HumanOS from the R-peak amplitude envelope (ECG-derived respiration).";
