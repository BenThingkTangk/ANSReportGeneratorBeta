/**
 * Regression suite for the RESTORED generic waveform spectral engine
 * (`api/_ans/spectral.ts`) and its integration into the canonical
 * parser → report pipeline.
 *
 * BACKGROUND. A beta build computed LFa/RFa/SB/FRF and rolling trends from the
 * raw .ans waveform, but it did so alongside patient-specific hardcodes AND a
 * calibration constant (`SCALE = 0.0018`) curve-fitted so ONE patient's
 * estimates matched ONE vendor PDF. The clean-up commit removed the hardcodes
 * and the whole engine, after which the pipeline blanket-nulled every spectral
 * output for every file — losing genuinely computable physiology.
 *
 * This suite pins the corrected contract:
 *   1. An arbitrary, non-hardcoded .ans with a usable waveform yields NON-NULL
 *      waveform-derived spectral values and rolling trends.
 *   2. No patient-specific hardcode exists: values track the WAVEFORM, and are
 *      invariant to name / DOB / sex / filename.
 *   3. A missing or unusable waveform still yields nulls (no fabrication).
 *   4. Provenance and uncertainty are surfaced on every estimate.
 *   5. Estimates never claim vendor parity and never unlock clinical scoring.
 *   6. The estimator is numerically correct on signals with a known spectrum
 *      (this is what makes it an engine rather than a plausible-looking number),
 *      while its documented broadband bias is asserted rather than hidden.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticAns } from "./buildSyntheticAns.js";
import { parseANSFile, generateColomboReport } from "../../upload.js";
import {
  FIXED_LF_BAND,
  FIXED_HF_BAND,
  RESAMPLE_FS,
  respirationAdaptiveBands,
  interpolateRRtoBpm,
  morletBandPower,
  morletBandPowerSeries,
  estimatePhaseSpectral,
  MIN_BEATS_FOR_SPECTRAL,
} from "../spectral.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

// ---------------------------------------------------------------------------
// Synthetic waveform generator (deterministic, patient-agnostic)
// ---------------------------------------------------------------------------
const FS = 250; // Hz — matches the vendor's 0.004 s sampling interval

/**
 * Build an ECG whose R-R series is modulated by two sinusoids of KNOWN
 * frequency and amplitude, so the expected band powers are known analytically.
 * Nothing here is patient-derived: the caller states the physiology.
 */
function syntheticEcg(opts: {
  durationSec: number;
  meanHrBpm: number;
  lfHz: number;
  lfAmpBpm: number;
  hfHz: number;
  hfAmpBpm: number;
}): { samples: Float64Array; rrMs: number[] } {
  const { durationSec, meanHrBpm, lfHz, lfAmpBpm, hfHz, hfAmpBpm } = opts;
  const n = Math.round(durationSec * FS);
  const samples = new Float64Array(n);
  const rrMs: number[] = [];

  let t = 0;
  const beatTimes: number[] = [];
  while (t < durationSec) {
    beatTimes.push(t);
    const bpm =
      meanHrBpm +
      lfAmpBpm * Math.sin(2 * Math.PI * lfHz * t) +
      hfAmpBpm * Math.sin(2 * Math.PI * hfHz * t);
    const rr = 60 / Math.max(30, bpm);
    rrMs.push(rr * 1000);
    t += rr;
  }
  rrMs.pop(); // the final interval runs past the record

  // Narrow triangular QRS complexes at each beat time + a slow baseline so the
  // detector sees a realistic morphology rather than a delta train.
  for (const bt of beatTimes) {
    const c = Math.round(bt * FS);
    for (let k = -6; k <= 6; k++) {
      const i = c + k;
      if (i < 0 || i >= n) continue;
      samples[i] += 1400 * Math.max(0, 1 - Math.abs(k) / 6);
    }
  }
  for (let i = 0; i < n; i++) samples[i] += 60 * Math.sin((2 * Math.PI * 0.25 * i) / FS);
  return { samples, rrMs };
}

/** A generic study long enough for all six protocol phases (~20 min). */
function genericStudy(overrides: Partial<Parameters<typeof buildSyntheticAns>[0]> = {}) {
  const { samples } = syntheticEcg({
    durationSec: 1200,
    meanHrBpm: 68,
    lfHz: 0.1,
    lfAmpBpm: 3,
    hfHz: 0.25,
    hfAmpBpm: 4,
  });
  return buildSyntheticAns({
    lastName: "Zzzz",
    firstName: "Qqqq",
    dobIso: "1970-01-01",
    sex: "Male",
    samplingInterval: 1 / FS,
    ecgSamples: samples,
    ...overrides,
  });
}

// ===========================================================================
// PROOF 6 — numerical correctness of the estimator itself
// ===========================================================================
describe("spectral engine — numerical correctness on known spectra", () => {
  it("recovers the analytic power of a pure sinusoid inside each band", () => {
    const fs = RESAMPLE_FS;
    const n = 600 * fs;
    for (const { f, amp, lo, hi } of [
      { f: 0.1, amp: 2, lo: FIXED_LF_BAND.lo, hi: FIXED_LF_BAND.hi },
      { f: 0.25, amp: 3, lo: FIXED_HF_BAND.lo, hi: FIXED_HF_BAND.hi },
    ]) {
      const x: number[] = [];
      for (let i = 0; i < n; i++) x.push(amp * Math.sin((2 * Math.PI * f * i) / fs));
      const p = morletBandPower(x, fs, lo, hi, 5);
      expect(p).not.toBeNull();
      // Variance of A·sin is A²/2.
      const expected = (amp * amp) / 2;
      expect(Math.abs((p as number) - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("does not leak power across band edges", () => {
    const fs = RESAMPLE_FS;
    const x: number[] = [];
    for (let i = 0; i < 600 * fs; i++) x.push(3 * Math.sin((2 * Math.PI * 0.25 * i) / fs));
    const lf = morletBandPower(x, fs, FIXED_LF_BAND.lo, FIXED_LF_BAND.hi, 5) as number;
    // A 0.25 Hz tone must contribute essentially nothing to the 0.04-0.15 band.
    expect(lf).toBeLessThan(0.01);
  });

  it("DOCUMENTED LIMITATION: broadband band power is only accurate to ~±15%", () => {
    // Gaussian wavelets have soft band edges, so a white-noise input does not
    // integrate to the ideal rectangular-band answer: the narrow sympathetic
    // band over-reads (edge leakage inward) while the wide respiratory band
    // under-reads (leakage outward past 0.4 Hz). Measured on this deterministic
    // realisation: sympathetic ≈ +12%, respiratory ≈ -5%.
    //
    // THIS IS THE CALIBRATION LIMIT of the engine and the reason its outputs are
    // published as `estimated` and never as vendor parity. The bounds below pin
    // the bias so a future change cannot silently make it worse — they are NOT a
    // claim of agreement with PhysioPS, which uses an undisclosed algorithm.
    const fs = RESAMPLE_FS;
    const n = 900 * fs;
    let a = 88675123;
    const u = () => {
      a ^= a << 13;
      a ^= a >>> 17;
      a ^= a << 5;
      return (a >>> 0) / 4294967296;
    };
    const x: number[] = [];
    for (let i = 0; i < n; i++) {
      const u1 = Math.max(1e-12, u());
      const u2 = u();
      x.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    }
    const mean = x.reduce((s2, v) => s2 + v, 0) / n;
    const variance = x.reduce((s2, v) => s2 + (v - mean) ** 2, 0) / n;
    const nyq = fs / 2;
    for (const b of [FIXED_LF_BAND, FIXED_HF_BAND]) {
      const p = morletBandPower(x, fs, b.lo, b.hi, 5) as number;
      const ideal = (variance * (b.hi - b.lo)) / nyq;
      const ratio = p / ideal;
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it("band selection is respiration-adaptive and never zero-width", () => {
    for (const frf of [null, 0.05, 0.09, 0.12, 0.15, 0.2, 0.3, 0.45]) {
      for (const paced of [true, false]) {
        const b = respirationAdaptiveBands(frf, { pacedBreathing: paced });
        expect(b.lfHi).toBeGreaterThan(b.lfLo);
        expect(b.hfHi).toBeGreaterThan(b.hfLo);
        expect(b.lfLo).toBeGreaterThanOrEqual(0.04);
        expect(b.hfHi).toBeLessThanOrEqual(0.6);
        expect(b.hfLo).toBeGreaterThanOrEqual(b.lfLo);
      }
    }
    // FRF null → published fixed edges, never an invented centre frequency.
    const fallback = respirationAdaptiveBands(null, { pacedBreathing: false });
    expect(fallback.bandSource).toBe("fixed_standard");
    expect(fallback.lfLo).toBe(FIXED_LF_BAND.lo);
    expect(fallback.hfHi).toBe(FIXED_HF_BAND.hi);
  });

  it("rolling series tracks a change in modulation depth over time", () => {
    const fs = RESAMPLE_FS;
    const x: number[] = [];
    const n = 600 * fs;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const amp = t < 300 ? 1 : 4; // step up the 0.25 Hz modulation
      x.push(amp * Math.sin(2 * Math.PI * 0.25 * t));
    }
    const series = morletBandPowerSeries(x, fs, FIXED_HF_BAND.lo, FIXED_HF_BAND.hi, {
      windowSec: 120,
      stepSec: 10,
    });
    expect(series.v.length).toBeGreaterThan(5);
    expect(series.t.length).toBe(series.v.length);
    const first = series.v[0];
    const last = series.v[series.v.length - 1];
    expect(first).toBeGreaterThan(0);
    // Power scales with amplitude²: 4² / 1² = 16×.
    expect(last / first).toBeGreaterThan(8);
  });
});

// ===========================================================================
// PROOF 1 + 4 — arbitrary usable waveform → non-null, labelled estimates
// ===========================================================================
describe("PROOF 1 — arbitrary non-hardcoded .ans with a usable waveform gets non-null spectral output", () => {
  it("estimatePhaseSpectral returns finite LFa/RFa/SB for a modulated R-R series", () => {
    const { rrMs } = syntheticEcg({
      durationSec: 300,
      meanHrBpm: 70,
      lfHz: 0.1,
      lfAmpBpm: 3,
      hfHz: 0.25,
      hfAmpBpm: 4,
    });
    const est = estimatePhaseSpectral({ rrIntervalsMs: rrMs, respFreqHz: 0.25 });
    expect(est.lfa).not.toBeNull();
    expect(est.rfa).not.toBeNull();
    expect(est.sb).not.toBeNull();
    expect(est.lfa as number).toBeGreaterThan(0);
    expect(est.rfa as number).toBeGreaterThan(0);
    // The injected respiratory modulation is the larger one → SB < 1.
    expect(est.sb as number).toBeLessThan(1);
    expect(est.beats).toBeGreaterThan(MIN_BEATS_FOR_SPECTRAL);
    expect(est.bands.bandSource).toBe("respiration_adaptive");
  });

  it("the full parse → report pipeline publishes per-phase estimates and rolling trends", () => {
    const data = parseANSFile(genericStudy(), "arbitrary-study.ans");
    const report = generateColomboReport(data);

    const withSpectral = report.phaseEvents.filter((p) => p.LFa !== null && p.RFa !== null);
    expect(withSpectral.length).toBeGreaterThan(0);
    for (const p of withSpectral) {
      expect(Number.isFinite(p.LFa as number)).toBe(true);
      expect(Number.isFinite(p.RFa as number)).toBe(true);
      expect(p.FRF).not.toBeNull();
    }
    // Rolling trends are restored (the beta's lfaRfaTrendsFromEcg behaviour).
    expect(report.multiParameter?.lfaTrend.v.length ?? 0).toBeGreaterThan(0);
    expect(report.multiParameter?.rfaTrend.v.length ?? 0).toBeGreaterThan(0);
    expect(report.multiParameter?.lfaTrend.t.length).toBe(report.multiParameter?.lfaTrend.v.length);
    expect(report.spectralEstimation.present).toBe(true);
  });

  it("real de-identified fixtures also produce estimates (no blanket-null regression)", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const report = generateColomboReport(parseANSFile(readFileSync(fixture(fn)), fn));
      const any = report.phaseEvents.some((p) => p.LFa !== null || p.RFa !== null);
      expect(any, `${fn} produced no spectral estimate at all`).toBe(true);
      expect(report.multiParameter?.lfaTrend.v.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("PROOF 4 — provenance and uncertainty are surfaced on every estimate", () => {
  it("each estimated phase value carries computed/estimated provenance + a disclosure warning", () => {
    const report = generateColomboReport(parseANSFile(genericStudy(), "arbitrary-study.ans"));
    let checked = 0;
    for (const p of report.phaseEvents) {
      for (const key of ["LFa", "RFa", "SB"] as const) {
        const prov = p.provenance?.[key];
        expect(prov).toBeTruthy();
        if (p[key] === null) {
          expect(["unavailable", "computed"]).toContain(prov!.method);
          continue;
        }
        checked++;
        expect(prov!.method).toBe("computed");
        expect(prov!.validation).toBe("estimated");
        // Tier P = proprietary / not independently validated.
        expect(prov!.tier).toBe("P");
        expect(prov!.note ?? "").toMatch(
          /NOT a vendor-reported value|not been validated against PhysioPS|not validated against PhysioPS/i,
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("study-level disclosure names the method and its confidence", () => {
    const report = generateColomboReport(parseANSFile(genericStudy(), "arbitrary-study.ans"));
    expect(report.spectralSource).toBe("humanos_estimated");
    expect(report.spectralEstimation.method).toBe("morlet_cwt_bpm2");
    expect(report.spectralEstimation.confidence as number).toBeGreaterThan(0);
    expect(report.spectralEstimation.confidence as number).toBeLessThanOrEqual(0.6);
    // The disclosure is unconditional: an estimate is ALWAYS labelled as an
    // estimate and as not vendor-validated, whatever the signal quality.
    expect(report.spectralEstimation.disclosure).toMatch(/estimate/i);
    expect(report.spectralEstimation.disclosure).toMatch(/not.*(validated|vendor)/i);
    expect(Array.isArray(report.spectralEstimation.warnings)).toBe(true);
  });

  it("a CLEAN synthetic recording produces no quality warnings (removed RMSSD>SDNN gate)", () => {
    // REGRESSION: this synthetic series is respiratory-dominant, so its
    // beat-to-beat variability exceeds its overall variability (lag-1
    // autocorrelation < 0.5). The removed gate called that "physiologically
    // impossible" and attached a warning. A clean recording must now come back
    // with an empty warning list; warnings are reserved for measured defects
    // (see the artifact test below).
    const report = generateColomboReport(parseANSFile(genericStudy(), "arbitrary-study.ans"));
    expect(report.spectralEstimation.warnings).toEqual([]);
    for (const p of report.phaseEvents) {
      if (p.hrvQuality?.rmssdSdnnRatio != null && p.hrvQuality.rmssdSdnnRatio > 1) {
        expect(p.hrvReliable).toBe(true);
        expect(p.hrvUnreliableReasons ?? []).toEqual([]);
      }
    }
  });

  it("quality artifacts lower confidence and add warnings instead of nulling the outputs", () => {
    const { rrMs } = syntheticEcg({
      durationSec: 300,
      meanHrBpm: 70,
      lfHz: 0.1,
      lfAmpBpm: 3,
      hfHz: 0.25,
      hfAmpBpm: 4,
    });
    const clean = estimatePhaseSpectral({ rrIntervalsMs: rrMs, respFreqHz: 0.25 });
    const dirty = estimatePhaseSpectral({
      rrIntervalsMs: rrMs,
      respFreqHz: 0.25,
      rejectedArtifactBeats: 7,
      rejectedArtifactIntervals: 9,
      signalQualityFailed: true,
    });
    // Values survive (the measurable trend is preserved)...
    expect(dirty.lfa).not.toBeNull();
    expect(dirty.rfa).not.toBeNull();
    // ...but the uncertainty is explicit and strictly worse.
    expect(dirty.confidence).toBeLessThan(clean.confidence);
    expect(dirty.warnings.length).toBeGreaterThan(clean.warnings.length);
    expect(dirty.warnings.join(" ")).toMatch(/artifact/i);
  });
});

// ===========================================================================
// PROOF 3 — genuinely impossible calculations stay null
// ===========================================================================
describe("PROOF 3 — missing or invalid waveform stays null (nothing is fabricated)", () => {
  it("too few intervals → all nulls, zero confidence, explicit reason", () => {
    const est = estimatePhaseSpectral({ rrIntervalsMs: [900, 910, 890, 905], respFreqHz: 0.25 });
    expect(est.lfa).toBeNull();
    expect(est.rfa).toBeNull();
    expect(est.sb).toBeNull();
    expect(est.confidence).toBe(0);
    expect(est.warnings.join(" ")).toMatch(/Fewer than/i);
  });

  it("non-finite / non-physiologic intervals are not silently coerced", () => {
    const bad = [NaN, Infinity, -500, 0, 1e9, NaN, 800, NaN, 810, NaN, 790, NaN];
    const est = estimatePhaseSpectral({ rrIntervalsMs: bad, respFreqHz: null });
    expect(est.lfa === null || Number.isFinite(est.lfa)).toBe(true);
    expect(est.rfa === null || Number.isFinite(est.rfa)).toBe(true);
    expect(est.sb === null || Number.isFinite(est.sb)).toBe(true);
    expect(interpolateRRtoBpm(bad).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("a file with NO waveform yields null spectral everywhere", () => {
    const noEcg = buildSyntheticAns({ samplingInterval: 0, sampleCount: 0 });
    const report = generateColomboReport(parseANSFile(noEcg, "no-waveform.ans"));
    for (const p of report.phaseEvents) {
      expect(p.LFa).toBeNull();
      expect(p.RFa).toBeNull();
      expect(p.SB).toBeNull();
      expect(p.provenance?.LFa.method).toBe("unavailable");
    }
    expect(report.multiParameter?.lfaTrend.v.length ?? 0).toBe(0);
    expect(report.spectralAvailable).toBe(false);
  });

  it("a flat (unmodulated) waveform reports zero-power, not an invented value", () => {
    // Constant 60 bpm: there IS no variability, so band power is legitimately
    // ~0 and the ratio is withheld rather than exploding.
    const { samples } = syntheticEcg({
      durationSec: 900,
      meanHrBpm: 60,
      lfHz: 0.1,
      lfAmpBpm: 0,
      hfHz: 0.25,
      hfAmpBpm: 0,
    });
    const report = generateColomboReport(
      parseANSFile(
        buildSyntheticAns({ samplingInterval: 1 / FS, ecgSamples: samples }),
        "flat.ans",
      ),
    );
    for (const p of report.phaseEvents) {
      if (p.LFa !== null) expect(p.LFa as number).toBeLessThan(0.5);
      if (p.RFa !== null) expect(p.RFa as number).toBeLessThan(0.5);
    }
  });
});

// ===========================================================================
// PROOF 2 — no patient-specific hardcoding
// ===========================================================================
describe("PROOF 2 — estimates depend on the WAVEFORM only, never on identity", () => {
  it("identity, sex, DOB and filename do not change any spectral value", () => {
    const { samples } = syntheticEcg({
      durationSec: 1200,
      meanHrBpm: 68,
      lfHz: 0.1,
      lfAmpBpm: 3,
      hfHz: 0.25,
      hfAmpBpm: 4,
    });
    const mk = (o: Record<string, unknown>, fn: string) =>
      generateColomboReport(
        parseANSFile(
          buildSyntheticAns({ samplingInterval: 1 / FS, ecgSamples: samples, ...o }),
          fn,
        ),
      ).phaseEvents.map((p) => [p.LFa, p.RFa, p.SB]);

    const a = mk({ lastName: "Zzzz", firstName: "Qqqq", sex: "Male" }, "a.ans");
    const b = mk({ lastName: "Shah", firstName: "Jill", sex: "Female" }, "Shah-Jill.ans");
    const c = mk({ lastName: "Pare", firstName: "Alex", sex: "Male" }, "Pare-Alex.ans");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("changing the modulation DOES change the estimate (the engine is real)", () => {
    const mk = (hfAmpBpm: number) => {
      const { rrMs } = syntheticEcg({
        durationSec: 300,
        meanHrBpm: 70,
        lfHz: 0.1,
        lfAmpBpm: 3,
        hfHz: 0.25,
        hfAmpBpm,
      });
      return estimatePhaseSpectral({ rrIntervalsMs: rrMs, respFreqHz: 0.25 });
    };
    const low = mk(1);
    const high = mk(5);
    expect((high.rfa as number) / (low.rfa as number)).toBeGreaterThan(4);
    // LFa is unchanged by respiratory-band modulation (band separation works).
    expect(Math.abs((high.lfa as number) - (low.lfa as number)) / (low.lfa as number))
      .toBeLessThan(0.5);
  });

  it("no per-patient literal or fitted constant exists in the engine source", () => {
    const src = readFileSync(path.join(__dirname, "..", "spectral.ts"), "utf-8");
    expect(src).not.toMatch(/jill|shah|alex|pare/i);
    expect(src).not.toMatch(/^\s*(?:const|let|var)\s+SCALE\s*=/m);
    // No filename keying: the engine must never branch on a file name. Strip
    // comments first so prose about the `.ans` format cannot trip the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/fileName|\.ans["'`]/i);
    expect(code).not.toMatch(/patient|name/i);
  });
});

// ===========================================================================
// PROOF 5 — estimates never claim vendor parity and never unlock scoring
// ===========================================================================
describe("PROOF 5 — an estimate is never a vendor value and never a clinical finding", () => {
  it("no estimated field claims vendor provenance, and the clinical gate stays shut", () => {
    const report = generateColomboReport(parseANSFile(genericStudy(), "arbitrary-study.ans"));
    for (const p of report.phaseEvents) {
      for (const key of ["LFa", "RFa", "SB", "FRF"] as const) {
        expect(p.provenance?.[key].method).not.toBe("vendor_reported");
        expect(p.provenance?.[key].method).not.toBe("derived_from_vendor");
      }
    }
    expect(report.spectralAvailable).toBe(false);
    expect(report.autonomicBalance.available).toBe(false);
    expect(report.wellnessScore).toBeNull();
    expect(report.wellnessBreakdown.sympathovagalBalance.available).toBe(false);
    expect(report.wellnessBreakdown.sympathovagalBalance.weight).toBe(0);
  });

  it("no spectral narrative finding is emitted from an estimate", () => {
    const report = generateColomboReport(parseANSFile(genericStudy(), "arbitrary-study.ans"));
    const text = [
      ...report.phaseFindings.flatMap((p) => p.findings),
      report.overallImpression,
    ].join("  ");
    expect(text).not.toMatch(/(Low|High|Abnormal|Normal) sympathetic modulation \(LFa\)/i);
    expect(text).not.toMatch(/(Low|High|Abnormal|Normal) parasympathetic response \(RFa\)/i);
    expect(text).toMatch(/not assessed/i);
  });

  it("a paired vendor value outranks the estimate for the phase it covers", () => {
    const data = parseANSFile(genericStudy(), "arbitrary-study.ans");
    const estimated = generateColomboReport(data).phaseEvents[0].LFa;
    const vendored = generateColomboReport(data, { LFa: 1.5, RFa: 2.5, SB: 0.6 });
    expect(vendored.phaseEvents[0].LFa).toBe(1.5);
    expect(vendored.phaseEvents[0].provenance?.LFa.method).toBe("vendor_reported");
    expect(vendored.phaseEvents[0].LFa).not.toBe(estimated);
    expect(vendored.spectralSource).not.toBe("humanos_estimated");
    // ...and phases the vendor did not cover keep estimate-tier provenance.
    expect(vendored.phaseEvents[5].provenance?.LFa.method).not.toBe("vendor_reported");
  });
});
