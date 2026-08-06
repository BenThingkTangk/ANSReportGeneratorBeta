/**
 * ESTIMATE-VS-VENDOR COMPARISON — Jill study, vendor PhysioPS page 2.
 *
 * The supplied scanned vendor page carries the only NUMERIC per-phase LFa / RFa
 * / ratio grid available in this repo. This spec uses it to do the one honest
 * thing that can be done with it: QUANTIFY how far the HumanOS waveform
 * estimates are from the vendor's printed numbers, and lock in that the engine
 * is not fitted toward them.
 *
 * WHAT THIS SPEC DELIBERATELY DOES NOT DO
 *  - It does not assert parity, agreement, or any tolerance that a tuned
 *    constant could satisfy.
 *  - It does not read the oracle anywhere in the engine; only this test does.
 *  - It fails if the engine source acquires a patient/filename/vendor-fitted
 *    constant.
 *
 * The measurable quantities that ARE shared with the vendor (mean heart rate and
 * the Ewing time-domain ratios) are asserted tightly, because those the pipeline
 * genuinely reproduces. The spectral aggregates are asserted to be reported with
 * estimate provenance and a printed error table — nothing more.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseANSFile, generateColomboReport } from "../../upload.js";
import {
  compareSpectralToVendor,
  formatComparison,
  COMPARISON_DISCLOSURE,
  type VendorPhaseRow,
} from "../spectralVendorComparison.js";

/**
 * Strip // and block comments so the anti-hardcode assertions below inspect
 * EXECUTABLE code only. Comments that document the removal of the old
 * patient-fitted constants are legitimate history and must stay readable.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const FIXTURES = path.join(process.cwd(), "api/_ans/__tests__/fixtures");
const ORACLE = JSON.parse(
  readFileSync(path.join(FIXTURES, "jill_vendor_oracle.json"), "utf-8"),
) as {
  protocolPhases: Record<string, VendorPhaseRow & { _doc?: string }>;
  timeDomainRatios: { eiRatio: number; valsalvaRatio: number; thirtyFifteenRatio: number };
  engineContract: { mustNever: string[]; mustAlways: string[] };
};

function vendorGrid(): Record<string, VendorPhaseRow> {
  const { _doc, ...rows } = ORACLE.protocolPhases as Record<string, VendorPhaseRow>;
  return rows;
}

let cached: ReturnType<typeof generateColomboReport> | null = null;
function jill() {
  if (!cached) {
    const buf = readFileSync(path.join(FIXTURES, "jill_deid.ans"));
    cached = generateColomboReport(parseANSFile(buf, "jill_deid.ans"));
  }
  return cached;
}

describe("Jill vendor oracle — transcription integrity", () => {
  it("carries the vendor page-2 grid exactly as printed", () => {
    // If anyone 'adjusts' a vendor number to make the engine look better, this
    // fails. The oracle is a fixed external fact, not a tunable.
    expect(vendorGrid()).toEqual({
      "Baseline-A": { duration: "05:00", meanHR: 56, rangeHR: 13, FRF: 0.15, LFa: 0.91, RFa: 5.13, ratio: 0.18 },
      "DeepBreathing-B": { duration: "01:00", meanHR: 55, rangeHR: 16, FRF: 0.2, LFa: 7.58, RFa: 2.88, ratio: 2.63 },
      "Baseline-C": { duration: "01:00", meanHR: 57, rangeHR: 14, FRF: 0.17, LFa: 2.06, RFa: 3.71, ratio: 0.55 },
      "Valsalva-D": { duration: "01:35", meanHR: 58, rangeHR: 19, FRF: 0.16, LFa: 21.11, RFa: 2.93, ratio: 7.2 },
      "Baseline-E": { duration: "02:30", meanHR: 58, rangeHR: 27, FRF: 0.15, LFa: 1.02, RFa: 3.89, ratio: 0.26 },
      "Stand-F": { duration: "05:30", meanHR: 64, rangeHR: 25, FRF: 0.16, LFa: 2.62, RFa: 6.55, ratio: 0.4 },
    });
    expect(ORACLE.timeDomainRatios).toMatchObject({ eiRatio: 1.21, valsalvaRatio: 1.43, thirtyFifteenRatio: 1.4 });
  });

  it("is never loaded by runtime code", () => {
    const engineFiles = [
      "api/upload.ts",
      "api/_ans/spectral.ts",
      "api/_ans/signalQuality.ts",
      "api/_ans/ecgPhases.ts",
      "api/_ans/spectralVendorComparison.ts",
    ];
    for (const f of engineFiles) {
      const raw = readFileSync(path.join(process.cwd(), f), "utf-8");
      const src = codeOnly(raw);
      expect(raw).not.toContain("jill_vendor_oracle");
      // No identifier or string literal keyed to this patient. (Historical
      // comments that DOCUMENT the removal of the old `isJillShah` hardcode are
      // allowed and are guarded separately by realFixtureGoldenMaster.spec.ts.)
      expect(src).not.toMatch(/\bisJill\w*\s*[=(:]/);
      expect(src).not.toMatch(/["'`]\s*jill/i);
    }
  });
});

describe("Jill — quantities the pipeline genuinely reproduces", () => {
  it("mean heart rate per phase matches the vendor within 3 bpm", () => {
    const grid = vendorGrid();
    for (const p of jill().phaseEvents) {
      const v = grid[p.phase];
      expect(v?.meanHR).toBeTypeOf("number");
      expect(p.meanHR).not.toBeNull();
      expect(Math.abs((p.meanHR as number) - (v!.meanHR as number))).toBeLessThanOrEqual(3);
    }
  });

  it("the Ewing time-domain ratios match the vendor page", () => {
    const r = jill();
    expect(r.ratios.eiRatio.value).toBeCloseTo(ORACLE.timeDomainRatios.eiRatio, 2);
    expect(r.ratios.valsalvaRatio.value).toBeCloseTo(ORACLE.timeDomainRatios.valsalvaRatio, 2);
    expect(r.ratios.thirtyFifteenRatio.value).toBeCloseTo(ORACLE.timeDomainRatios.thirtyFifteenRatio, 2);
  });
});

describe("Jill — spectral estimates are reported as errors, never as parity", () => {
  it("publishes estimate provenance, not vendor provenance", () => {
    const r = jill();
    expect(r.spectralAvailable).toBe(false);
    expect(r.spectralSource).toBe("humanos_estimated");
    for (const p of r.phaseEvents) {
      for (const key of ["LFa", "RFa", "SB"] as const) {
        const prov = p.provenance?.[key];
        expect(prov?.method).not.toBe("vendor_reported");
        if (p[key] != null) {
          expect(prov?.method).toBe("computed");
          expect(prov?.validation).toBe("estimated");
        }
      }
    }
  });

  it("emits an explicit per-phase error table with the no-parity disclosure", () => {
    const r = jill();
    const rows = r.phaseEvents.map((p) => ({
      phase: p.phase,
      meanHR: p.meanHR,
      rangeHR: p.rangeHR,
      FRF: p.FRF,
      LFa: p.LFa,
      RFa: p.RFa,
      SB: p.SB,
    }));
    const summary = compareSpectralToVendor(rows, vendorGrid());
    const text = formatComparison(summary);

    // Printed so the comparison is visible in CI output, as required.
    // eslint-disable-next-line no-console
    console.log("\n" + text + "\n");

    expect(summary.disclosure).toBe(COMPARISON_DISCLOSURE);
    expect(text).toContain("NOT PARITY");
    expect(summary.phases).toHaveLength(6);

    // Every comparable metric produced a signed error and a relative error.
    for (const p of summary.phases) {
      for (const m of p.metrics) {
        if (m.vendor != null && m.estimate != null) {
          expect(m.absoluteError).not.toBeNull();
          expect(Number.isFinite(m.absoluteError as number)).toBe(true);
        }
      }
    }

    // The spectral disagreement is LARGE. These lower bounds exist so that any
    // future change which starts claiming (or quietly engineering) agreement
    // must update this test deliberately and justify it with a validation study
    // rather than a fitted constant.
    expect(summary.medianRelativeError.LFa!).toBeGreaterThan(0.5);
    expect(summary.medianRelativeError.SB!).toBeGreaterThan(0.5);
    expect(summary.medianRelativeError.RFa!).toBeGreaterThan(0.2);
    // Mean heart rate, by contrast, agrees closely — the pipeline reproduces
    // what is actually measurable from the waveform.
    expect(summary.medianRelativeError.meanHR!).toBeLessThan(0.05);
  });

  it("records that the resting sympathovagal direction disagrees with the vendor", () => {
    const summary = compareSpectralToVendor(
      jill().phaseEvents.map((p) => ({ phase: p.phase, SB: p.SB })),
      vendorGrid(),
    );
    const baseline = summary.phases.find((p) => p.phase === "Baseline-A")!;
    const sb = baseline.metrics.find((m) => m.metric === "SB")!;
    expect(sb.vendor).toBe(0.18);
    expect(sb.estimate).not.toBeNull();
    // Vendor: respiratory-dominant at rest (ratio < 1). HumanOS estimate is
    // sympathetic-dominant (> 1). The direction disagrees, and the payload must
    // never present the estimate as a clinical balance finding.
    expect(sb.directionAgrees).toBe(false);
    expect(jill().autonomicBalance.available).toBe(false);
    expect(jill().autonomicBalance.balance).toBeNull();
  });

  it("has no constant fitted to any patient, vendor page or filename", () => {
    const engineFiles = ["api/upload.ts", "api/_ans/spectral.ts", "api/_ans/signalQuality.ts"];
    for (const f of engineFiles) {
      const src = codeOnly(readFileSync(path.join(process.cwd(), f), "utf-8"));
      expect(src).not.toMatch(/const\s+SCALE\s*=/);
      // No revived output multiplier: the constant may only appear inside a
      // comment that records its removal, never in an expression.
      expect(src).not.toMatch(/[*/]\s*0\.0018/);
      expect(src).not.toMatch(/=\s*0\.0018/);
      expect(src).not.toMatch(/isJillShah|isAlexPare/);
      expect(src).not.toMatch(/fileName\s*===\s*["'`]/);
    }
  });

  it("the comparison module is a pure reporter and is not wired into the engine", () => {
    for (const f of ["api/upload.ts", "api/_ans/spectral.ts", "api/_ans/ecgPhases.ts"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf-8");
      expect(src).not.toContain("spectralVendorComparison");
    }
    const src = readFileSync(path.join(process.cwd(), "api/_ans/spectralVendorComparison.ts"), "utf-8");
    // A reporter must not produce a correction factor of any kind.
    expect(src).not.toMatch(/correctionFactor|calibrat(e|ion)Constant|applyGain/);
  });
});
