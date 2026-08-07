import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBinaryHeader } from "../parseBinary.ts";
import { parseVendorStoredAnalysis } from "../vendorStored.ts";
import { resolveTrendMapping } from "../vendorTrendMapping.ts";
import {
  buildVendorVisualization,
  trendSeriesForRole,
  unavailableVisualization,
} from "../vendorVisualization.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, "fixtures", name);
const FIXTURES = ["jill_deid.ans", "pare_deid.ans"] as const;

function load(name: string) {
  const bytes = readFileSync(fixture(name));
  const binary = parseBinaryHeader(bytes);
  expect(binary.sampling).toBeTruthy();
  const stored = parseVendorStoredAnalysis(bytes, binary.sampling!, { collectSeries: true });
  expect(stored.series).toBeTruthy();
  return { bytes, stored, series: stored.series! };
}

/** Reorder the stored trend payloads in place; counts are identical per file. */
function permuteTrendArrays(bytes: Buffer, order: number[]): Buffer {
  const { series } = load("jill_deid.ans");
  void series;
  const binary = parseBinaryHeader(bytes);
  const stored = parseVendorStoredAnalysis(bytes, binary.sampling!, { collectSeries: true });
  const channels = stored.series!.trends.channels;
  const lengths = new Set(channels.map((channel) => channel.values.length));
  expect(lengths.size).toBe(1);
  const byteLength = channels[0].values.length * 4;
  const clone = Buffer.from(bytes);
  order.forEach((sourceIndex, targetIndex) => {
    bytes.copy(
      clone,
      channels[targetIndex].offset,
      channels[sourceIndex].offset,
      channels[sourceIndex].offset + byteLength,
    );
  });
  return clone;
}

/** Overwrite the two leading LP-strings with same-length filler. */
function anonymizeInPlace(bytes: Buffer): Buffer {
  const clone = Buffer.from(bytes);
  let offset = 0;
  for (let field = 0; field < 2; field += 1) {
    const length = clone.readUInt32BE(offset);
    clone.fill(0x58, offset + 4, offset + 4 + length); // "X"
    offset += 4 + length;
  }
  return clone;
}

describe("stored PhysioPS visualization series", () => {
  it.each(FIXTURES)("%s exposes every stored series verbatim", (name) => {
    const { bytes, series } = load(name);

    expect(series.heartRate.dtSec).toBeCloseTo(0.25, 9);
    // The vendor writes the breathing array at the same 4 Hz rate. Sample
    // counts can differ by a few samples at the tail, so the invariant is the
    // shared rate and a near-equal length, not byte-identical counts.
    expect(series.breathing.dtSec).toBe(series.heartRate.dtSec);
    expect(
      Math.abs(series.breathing.values.length - series.heartRate.values.length),
    ).toBeLessThanOrEqual(16);
    expect(series.trends.dtSec).toBeCloseTo(4, 9);
    expect(series.trends.channels).toHaveLength(11);

    // Values must equal a direct read at the declared offsets - no smoothing.
    for (const channel of series.trends.channels) {
      expect(channel.values[0]).toBe(bytes.readFloatBE(channel.offset));
      const last = channel.values.length - 1;
      expect(channel.values[last]).toBe(bytes.readFloatBE(channel.offset + last * 4));
    }
    expect(series.heartRate.values[0]).toBe(bytes.readFloatBE(series.heartRate.offset));
    expect(series.spectrogram.values.length).toBe(
      series.spectrogram.rows * series.spectrogram.cols,
    );
    expect(series.spectrogram.values[0]).toBe(
      bytes.readFloatBE(series.spectrogram.valuesOffset),
    );
    expect(series.spectrogram.cols).toBeGreaterThan(1);
    expect(series.spectrogram.freqStepHz).toBeGreaterThan(0);
  });

  it("does not materialize series unless explicitly requested", () => {
    const bytes = readFileSync(fixture("jill_deid.ans"));
    const binary = parseBinaryHeader(bytes);
    const scalarOnly = parseVendorStoredAnalysis(bytes, binary.sampling!);
    expect(scalarOnly.series).toBeUndefined();
    expect(scalarOnly.phases).toHaveLength(6);
  });
});

describe("trend index-to-metric resolution", () => {
  it.each(FIXTURES)("%s resolves the clinical channels from in-file evidence", (name) => {
    const { stored, series } = load(name);
    const mapping = resolveTrendMapping(series, stored.phases);

    expect(mapping.clinicalChannelsResolved).toBe(true);
    const roles = mapping.channels.map((channel) => channel.role);
    expect(roles).toContain("lfa_bpm2");
    expect(roles).toContain("rfa_bpm2");
    expect(roles).toContain("lfa_rfa_ratio");
    expect(roles).toContain("frf_hz");

    for (const channel of mapping.channels) {
      expect(channel.evidence.length).toBeGreaterThan(20);
      if (channel.role === "unmapped") expect(channel.method).toBe("unresolved");
      else expect(channel.method).not.toBe("unresolved");
    }
  });

  it.each(FIXTURES)("%s ratio channel is the exact pointwise LFa/RFa quotient", (name) => {
    const { stored, series } = load(name);
    const mapping = resolveTrendMapping(series, stored.phases);
    const indexOf = (role: string) =>
      mapping.channels.find((channel) => channel.role === role)!.index;
    const lfa = series.trends.channels[indexOf("lfa_bpm2")].values;
    const rfa = series.trends.channels[indexOf("rfa_bpm2")].values;
    const ratio = series.trends.channels[indexOf("lfa_rfa_ratio")].values;

    let agreeing = 0;
    let comparable = 0;
    for (let index = 0; index < ratio.length; index += 1) {
      if (rfa[index] === 0 || ratio[index] === 0) continue;
      comparable += 1;
      if (Math.abs(lfa[index] / rfa[index] - ratio[index]) / ratio[index] <= 1e-3) agreeing += 1;
    }
    expect(comparable).toBeGreaterThan(50);
    expect(agreeing / comparable).toBeGreaterThan(0.99);
  });

  it.each(FIXTURES)("%s FRF channel stays inside the physiological band", (name) => {
    const { stored, series } = load(name);
    const mapping = resolveTrendMapping(series, stored.phases);
    const frfIndex = mapping.channels.find((channel) => channel.role === "frf_hz")!.index;
    for (const value of series.trends.channels[frfIndex].values) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("follows the arrays when the stored trend order is permuted", () => {
    const bytes = readFileSync(fixture("jill_deid.ans"));
    const original = load("jill_deid.ans");
    const baseline = resolveTrendMapping(original.series, original.stored.phases);

    // Reverse the stored order: role assignment must move with the data.
    const order = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const permuted = permuteTrendArrays(bytes, order);
    const binary = parseBinaryHeader(permuted);
    const storedPermuted = parseVendorStoredAnalysis(permuted, binary.sampling!, {
      collectSeries: true,
    });
    const mapping = resolveTrendMapping(storedPermuted.series!, storedPermuted.phases);

    expect(mapping.clinicalChannelsResolved).toBe(true);
    for (const role of ["lfa_bpm2", "rfa_bpm2", "lfa_rfa_ratio", "frf_hz"] as const) {
      const before = baseline.channels.find((channel) => channel.role === role)!.index;
      const after = mapping.channels.find((channel) => channel.role === role)!.index;
      expect(after).toBe(order.indexOf(before));
    }
  });

  it("is independent of patient identity bytes", () => {
    const bytes = readFileSync(fixture("pare_deid.ans"));
    const original = load("pare_deid.ans");
    const anonymized = anonymizeInPlace(bytes);
    const binary = parseBinaryHeader(anonymized);
    const stored = parseVendorStoredAnalysis(anonymized, binary.sampling!, {
      collectSeries: true,
    });
    const mapping = resolveTrendMapping(stored.series!, stored.phases);
    const baseline = resolveTrendMapping(original.series, original.stored.phases);

    expect(mapping.channels.map((channel) => channel.role)).toEqual(
      baseline.channels.map((channel) => channel.role),
    );
    expect(stored.series!.spectrogram.values).toEqual(original.series.spectrogram.values);
  });

  it("labels nothing when the trend arrays carry no invariant", () => {
    const original = load("jill_deid.ans");
    const scrambled = {
      ...original.series,
      trends: {
        ...original.series.trends,
        channels: original.series.trends.channels.map((channel) => ({
          ...channel,
          values: channel.values.map((_, index) => 1 + ((index * 7919) % 97) / 10),
        })),
      },
    };
    const mapping = resolveTrendMapping(scrambled, original.stored.phases);
    expect(mapping.clinicalChannelsResolved).toBe(false);
    expect(mapping.channels.every((channel) => channel.role === "unmapped")).toBe(true);
    expect(mapping.warnings.join(" ")).toMatch(/could not|closely enough/i);
  });
});

describe("visualization payload", () => {
  it.each(FIXTURES)("%s transports the spectrogram byte-exactly", (name) => {
    const { stored, series } = load(name);
    const visualization = buildVendorVisualization(series, stored.phases, stored.waveletName);

    expect(visualization.source).toBe("ans_stored");
    const payload = visualization.spectrogram!;
    expect(payload.source).toBe("ans_stored");
    expect(payload.strideFactor).toBe(1);
    expect(payload.wavelet).toBe(stored.waveletName);

    const decoded = Buffer.from(payload.values, "base64");
    expect(decoded.byteLength).toBe(payload.rows * payload.cols * 4);
    for (let index = 0; index < decoded.byteLength / 4; index += 1) {
      expect(decoded.readFloatBE(index * 4)).toBe(series.spectrogram.values[index]);
    }
  });

  it.each(FIXTURES)("%s exposes plotted trend series with stored values", (name) => {
    const { stored, series } = load(name);
    const visualization = buildVendorVisualization(series, stored.phases, stored.waveletName);
    const lfa = trendSeriesForRole(visualization, "lfa_bpm2");
    const rfa = trendSeriesForRole(visualization, "rfa_bpm2");

    expect(lfa).toBeTruthy();
    expect(rfa).toBeTruthy();
    expect(lfa!.strideFactor).toBe(1);
    expect(lfa!.unit).toBe("bpm^2");
    expect(lfa!.t[0]).toBe(0);
    expect(lfa!.t[1]).toBeCloseTo(series.trends.dtSec, 6);

    const lfaIndex = visualization.trend.channels.find(
      (channel) => channel.role === "lfa_bpm2",
    )!.index;
    expect(lfa!.v).toEqual(series.trends.channels[lfaIndex].values);
    expect(trendSeriesForRole(visualization, "unmapped")).toBeNull();
  });

  it.each(FIXTURES)("%s carries the stored 4 Hz heart-rate and breathing series", (name) => {
    const { stored, series } = load(name);
    const visualization = buildVendorVisualization(series, stored.phases, stored.waveletName);
    expect(visualization.heartRate!.unit).toBe("bpm");
    expect(visualization.heartRate!.storedSampleCount).toBe(series.heartRate.values.length);
    expect(visualization.heartRate!.v[0]).toBe(series.heartRate.values[0]);
    expect(visualization.breathing!.unit).toBe("sensor units");
    // Striding must sample the stored array, never resample or interpolate it.
    const stride = visualization.heartRate!.strideFactor;
    expect(visualization.heartRate!.v[3]).toBe(series.heartRate.values[3 * stride]);
  });

  it("emits an explicit unavailable payload rather than a fabricated one", () => {
    const payload = unavailableVisualization("no stored analysis block");
    expect(payload.source).toBe("unavailable");
    expect(payload.spectrogram).toBeNull();
    expect(payload.heartRate).toBeNull();
    expect(payload.trend.channels).toEqual([]);
    expect(payload.reason).toContain("no stored analysis block");
  });
});

describe("malformed and truncated files", () => {
  it("refuses a file truncated inside the spectrogram", () => {
    const { bytes, series } = load("jill_deid.ans");
    const truncated = bytes.subarray(0, series.spectrogram.valuesOffset + 64);
    const binary = parseBinaryHeader(truncated);
    expect(() =>
      parseVendorStoredAnalysis(truncated, binary.sampling!, { collectSeries: true }),
    ).toThrow(/exceeds file bounds|truncated/i);
  });

  it("refuses an implausible stored spectrogram shape", () => {
    const { bytes, series } = load("pare_deid.ans");
    const corrupted = Buffer.from(bytes);
    corrupted.writeUInt32BE(9_999_999, series.spectrogram.headerOffset + 32);
    const binary = parseBinaryHeader(corrupted);
    expect(() =>
      parseVendorStoredAnalysis(corrupted, binary.sampling!, { collectSeries: true }),
    ).toThrow(/spectrogram shape|exceeds file bounds/i);
  });

  it("refuses a file whose trend block was truncated", () => {
    const { bytes, series } = load("pare_deid.ans");
    const truncated = bytes.subarray(0, series.trends.channels[5].offset + 16);
    const binary = parseBinaryHeader(truncated);
    expect(() =>
      parseVendorStoredAnalysis(truncated, binary.sampling!, { collectSeries: true }),
    ).toThrow();
  });

  it("marks a declared-but-empty spectrogram malformed instead of dropping it", () => {
    const { stored, series } = load("jill_deid.ans");
    const broken = {
      ...series,
      spectrogram: { ...series.spectrogram, values: new Float32Array(0) },
    };
    const visualization = buildVendorVisualization(broken, stored.phases, stored.waveletName);
    expect(visualization.spectrogram!.source).toBe("malformed");
    expect(visualization.spectrogram!.values).toBe("");
    expect(visualization.spectrogram!.reason).toMatch(/declared/i);
  });
});
