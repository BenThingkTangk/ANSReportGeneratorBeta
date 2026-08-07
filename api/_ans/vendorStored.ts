import type {
  BloodPressure,
  ExtractionWarning,
  PhaseBlock,
  ProvField,
} from "../../shared/ansStudy.js";
import { missingField, provField } from "../../shared/ansStudy.js";
import type { SamplingProbe } from "./parseBinary.js";

const PHASE_COUNT = 6;
const TREND_COUNT = 11;
const EMPTY_F32 = new Float32Array(0);
export const VENDOR_SUMMARY_SIGNATURE =
  "S8NddaaaaaaadaaaaaaaaNddaa0aaaadaa0aaaaa";

type SummaryItem =
  | { kind: "strings"; values: string[]; offset: number }
  | { kind: "f32"; values: number[]; offset: number }
  | { kind: "f64"; values: number[]; offset: number }
  | { kind: "empty"; values: []; offset: number };

export interface VendorPhaseMetrics {
  index: number;
  code: "A" | "B" | "C" | "D" | "E" | "F";
  label: string;
  startAbs: number;
  endAbs: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  meanHr: number;
  rangeHr: number;
  frf: number;
  lfa: number;
  rfa: number;
  ratio: number;
  systolic: number | null;
  diastolic: number | null;
  map: number | null;
  pulsePressure: number | null;
  bpReadingCount: number;
}

/** One stored, uniformly sampled series read verbatim from the .ans file. */
export interface StoredUniformSeries {
  /** Byte offset of the first stored value. */
  offset: number;
  /** Absolute LabVIEW seconds of the first sample. */
  t0Abs: number;
  /** Sample spacing in seconds. */
  dtSec: number;
  values: number[];
}

/** The stored PhysioPS wavelet spectrogram, read verbatim. */
export interface StoredSpectrogram {
  /** Byte offset of the spectrogram block header (t0). */
  headerOffset: number;
  /** Byte offset of the first float32 value. */
  valuesOffset: number;
  t0Abs: number;
  dtSec: number;
  freqStartHz: number;
  freqStepHz: number;
  /** Number of stored time slices. */
  rows: number;
  /** Number of frequency bins per time slice. */
  cols: number;
  /**
   * Row-major `rows x cols` matrix: value(timeIndex, freqIndex) lives at
   * `values[timeIndex * cols + freqIndex]`. The layout is fixed by the stored
   * row/column counts and was validated across the private corpus by the
   * continuity of each stored 150-bin slice.
   */
  values: Float32Array;
}

/**
 * Every stored series that sits between the ECG block and the six-phase
 * summary. Collected only when `parseVendorStoredAnalysis` is called with
 * `{ collectSeries: true }` so the default (scalar) path stays allocation-free.
 */
export interface VendorStoredSeries {
  /** Beat-to-beat interval series (seconds), non-uniform in time. */
  rrIntervalsSec: { offset: number; t0Abs: number; values: number[] };
  /** 4 Hz heart-rate series (bpm). */
  heartRate: StoredUniformSeries;
  /** 4 Hz breathing series (unitless sensor units). */
  breathing: StoredUniformSeries;
  /** Cuff blood-pressure markers. */
  bpMarkers: {
    offset: number;
    timesAbs: number[];
    systolic: number[];
    diastolic: number[];
    map: number[];
  };
  /** The eleven 4-second spectral trend arrays, in stored order. */
  trends: {
    t0Abs: number;
    dtSec: number;
    channels: Array<{ index: number; offset: number; values: number[] }>;
  };
  spectrogram: StoredSpectrogram;
}

export interface VendorStoredAnalysis {
  phases: VendorPhaseMetrics[];
  signature: string;
  summaryOffset: number;
  waveletName: string;
  markerCount: number;
  warnings: ExtractionWarning[];
  /** Present only when parsed with `{ collectSeries: true }`. */
  series?: VendorStoredSeries;
}

export interface VendorStoredOptions {
  /**
   * Materialize the stored visualization series (4 Hz HR/breathing, the eleven
   * 4-second trend arrays and the wavelet spectrogram). Off by default: the
   * scalar summary path must not pay for ~150 K extra numbers.
   */
  collectSeries?: boolean;
}

class Cursor {
  constructor(
    readonly buffer: Buffer,
    public offset: number,
  ) {}

  private need(bytes: number, label: string): void {
    if (bytes < 0 || this.offset + bytes > this.buffer.length) {
      throw new RangeError(`${label} @ ${this.offset} exceeds file bounds`);
    }
  }

  u8(label: string): number {
    this.need(1, label);
    return this.buffer[this.offset++];
  }

  u32(label: string): number {
    this.need(4, label);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  f64(label: string): number {
    this.need(8, label);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    if (!Number.isFinite(value)) throw new RangeError(`${label} is non-finite`);
    return value;
  }

  skip(bytes: number, label: string): void {
    this.need(bytes, label);
    this.offset += bytes;
  }

  f32Array(count: number, label: string): number[] {
    if (count < 0 || count > 5_000_000) throw new RangeError(`${label} count ${count}`);
    this.need(count * 4, label);
    const values = new Array<number>(count);
    for (let index = 0; index < count; index += 1) {
      values[index] = this.buffer.readFloatBE(this.offset + index * 4);
    }
    this.offset += count * 4;
    return values;
  }

  f64Array(count: number, label: string): number[] {
    if (count < 0 || count > 1_000_000) throw new RangeError(`${label} count ${count}`);
    return Array.from({ length: count }, (_, index) => this.f64(`${label}[${index}]`));
  }

  u8Array(count: number, label: string): number[] {
    if (count < 0 || count > 1_000_000) throw new RangeError(`${label} count ${count}`);
    this.need(count, label);
    const values = [...this.buffer.subarray(this.offset, this.offset + count)];
    this.offset += count;
    return values;
  }
}

function checkedArrayBytes(count: number, width: number, label: string): number {
  if (!Number.isInteger(count) || count < 0 || count > 5_000_000) {
    throw new RangeError(`${label} count ${count}`);
  }
  const bytes = count * width;
  if (!Number.isSafeInteger(bytes)) throw new RangeError(`${label} byte count overflow`);
  return bytes;
}

function readPrintableLpStrings(
  buffer: Buffer,
  offset: number,
): { values: string[]; next: number } | null {
  let cursor = offset;
  const values: string[] = [];
  try {
    for (let index = 0; index < PHASE_COUNT; index += 1) {
      if (cursor + 4 > buffer.length) return null;
      const length = buffer.readUInt32BE(cursor);
      cursor += 4;
      if (length < 1 || length > 24 || cursor + length > buffer.length) return null;
      const bytes = buffer.subarray(cursor, cursor + length);
      if (![...bytes].every((value) => value >= 32 && value < 127)) return null;
      values.push(bytes.toString("ascii"));
      cursor += length;
    }
  } catch {
    return null;
  }
  return { values, next: cursor };
}

function decodeSummaryItems(buffer: Buffer, start: number): SummaryItem[] | null {
  const memo = new Map<number, SummaryItem[] | null>();
  const decode = (offset: number): SummaryItem[] | null => {
    if (offset === buffer.length) return [];
    if (offset + 4 > buffer.length) return null;
    if (memo.has(offset)) return memo.get(offset) ?? null;

    const count = buffer.readUInt32BE(offset);
    const payload = offset + 4;
    let result: SummaryItem[] | null = null;

    if (count === 0) {
      const rest = decode(payload);
      if (rest) result = [{ kind: "empty", values: [], offset }, ...rest];
    } else if (count === PHASE_COUNT) {
      const strings = readPrintableLpStrings(buffer, payload);
      if (strings) {
        const rest = decode(strings.next);
        if (rest) result = [{ kind: "strings", values: strings.values, offset }, ...rest];
      }

      if (!result && payload + PHASE_COUNT * 4 <= buffer.length) {
        const values = Array.from(
          { length: PHASE_COUNT },
          (_, index) => buffer.readFloatBE(payload + index * 4),
        );
        if (values.every(Number.isFinite)) {
          const rest = decode(payload + PHASE_COUNT * 4);
          if (rest) result = [{ kind: "f32", values, offset }, ...rest];
        }
      }

      if (!result && payload + PHASE_COUNT * 8 <= buffer.length) {
        const values = Array.from(
          { length: PHASE_COUNT },
          (_, index) => buffer.readDoubleBE(payload + index * 8),
        );
        if (values.every(Number.isFinite)) {
          const rest = decode(payload + PHASE_COUNT * 8);
          if (rest) result = [{ kind: "f64", values, offset }, ...rest];
        }
      }
    }

    memo.set(offset, result);
    return result;
  };
  return decode(start);
}

function readSummary(buffer: Buffer, offset: number): {
  waveletName: string;
  signature: string;
  items: SummaryItem[];
} {
  const cursor = new Cursor(buffer, offset);
  const nameLength = cursor.u32("summary.waveletName.length");
  if (nameLength < 1 || nameLength > 128) {
    throw new RangeError(`summary wavelet name length ${nameLength}`);
  }
  const nameStart = cursor.offset;
  cursor.skip(nameLength, "summary.waveletName");
  const waveletName = buffer.subarray(nameStart, nameStart + nameLength).toString("ascii");
  cursor.u8("summary.flag");
  const items = decodeSummaryItems(buffer, cursor.offset);
  if (!items) throw new RangeError("phase summary did not consume exactly to EOF");
  const signature =
    "S8" +
    items
      .map((item) =>
        item.kind === "strings"
          ? "N"
          : item.kind === "f64"
            ? "d"
            : item.kind === "f32"
              ? "a"
              : "0",
      )
      .join("");
  return { waveletName, signature, items };
}

function numericItem(
  items: SummaryItem[],
  index: number,
  kind: "f32" | "f64",
  label: string,
): number[] {
  const item = items[index - 2];
  if (!item || item.kind !== kind || item.values.length !== PHASE_COUNT) {
    throw new RangeError(`summary item ${index} is not ${label}`);
  }
  return item.values;
}

function stringItem(items: SummaryItem[], index: number, label: string): string[] {
  const item = items[index - 2];
  if (!item || item.kind !== "strings" || item.values.length !== PHASE_COUNT) {
    throw new RangeError(`summary item ${index} is not ${label}`);
  }
  return item.values;
}

/** LabVIEW-compatible round-to-nearest with ties to the even integer. */
export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) return value;
  const lower = Math.floor(value);
  const fraction = value - lower;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
  if (fraction < 0.5 - epsilon) return lower;
  if (fraction > 0.5 + epsilon) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function directField(
  value: number,
  unit: string,
  offset: number,
  matchedLabel: string,
  source: "binary_float32" | "binary_float64" | "binary_uint8",
): ProvField<number> {
  return provField(value, source, {
    unit,
    offset,
    matchedLabel,
    confidence: 0.99,
  });
}

export function vendorPhaseToBlock(
  phase: VendorPhaseMetrics,
  summaryOffset: number,
): PhaseBlock {
  const bp: BloodPressure =
    phase.bpReadingCount > 0
      ? {
          sbp: directField(
            phase.systolic!,
            "mmHg",
            summaryOffset,
            "vendor_bp_systolic_markers",
            "binary_uint8",
          ),
          dbp: directField(
            phase.diastolic!,
            "mmHg",
            summaryOffset,
            "vendor_bp_diastolic_markers",
            "binary_uint8",
          ),
          map: directField(
            phase.map!,
            "mmHg",
            summaryOffset,
            "vendor_bp_map_markers",
            "binary_uint8",
          ),
        }
      : {
          sbp: missingField("No BP marker falls inside this stored phase window."),
          dbp: missingField("No BP marker falls inside this stored phase window."),
          map: missingField("No BP marker falls inside this stored phase window."),
        };

  return {
    present: true,
    startSec: directField(
      phase.startSec,
      "s",
      summaryOffset,
      "vendor_phase_start",
      "binary_float64",
    ),
    endSec: directField(
      phase.endSec,
      "s",
      summaryOffset,
      "vendor_phase_end",
      "binary_float64",
    ),
    heartRate: directField(
      roundHalfEven(phase.meanHr),
      "bpm",
      summaryOffset,
      "vendor_phase_mean_hr",
      "binary_float32",
    ),
    bp,
    lfa: directField(
      Math.round(phase.lfa * 100) / 100,
      "bpm^2",
      summaryOffset,
      "vendor_phase_lfa",
      "binary_float32",
    ),
    rfa: directField(
      Math.round(phase.rfa * 100) / 100,
      "bpm^2",
      summaryOffset,
      "vendor_phase_rfa",
      "binary_float32",
    ),
    sb: directField(
      Math.round(phase.ratio * 100) / 100,
      "ratio",
      summaryOffset,
      "vendor_phase_lfa_rfa",
      "binary_float32",
    ),
    notes: [
      `PhysioPS stored phase ${phase.code} (${phase.label}); metrics read directly from the .ans analysis summary.`,
      phase.bpReadingCount
        ? `BP aggregated from ${phase.bpReadingCount} stored marker reading(s) using round-half-to-even.`
        : "No stored BP marker falls within this phase; BP remains unavailable.",
    ],
  };
}

/**
 * Decode PhysioPS post-ECG series and the stored six-phase summary.
 * Pure function of file bytes and the binary sampling probe.
 */
export function parseVendorStoredAnalysis(
  buffer: Buffer,
  sampling: SamplingProbe,
  options: VendorStoredOptions = {},
): VendorStoredAnalysis {
  const collect = options.collectSeries === true;
  if (sampling.truncated) throw new RangeError("ECG block is truncated");
  const cursor = new Cursor(
    buffer,
    sampling.dataStartOffset + sampling.dataPointCount * 2,
  );

  const rrT0 = cursor.f64("rr.t0");
  const rrCount = cursor.u32("rr.values.count");
  const rrOffset = cursor.offset;
  const rrValues = collect
    ? cursor.f32Array(rrCount, "rr.values")
    : (cursor.skip(checkedArrayBytes(rrCount, 4, "rr.values"), "rr.values"), []);

  const hrT0 = cursor.f64("hr4.t0");
  const hrDt = cursor.f64("hr4.dt");
  if (Math.abs(hrDt - 0.25) > 1e-9) throw new RangeError(`unexpected hr4 dt ${hrDt}`);
  const hrCount = cursor.u32("hr4.values.count");
  const hrOffset = cursor.offset;
  const hrValues = collect
    ? cursor.f32Array(hrCount, "hr4.values")
    : (cursor.skip(checkedArrayBytes(hrCount, 4, "hr4.values"), "hr4.values"), []);
  const breathingCount = cursor.u32("breathing4.values.count");
  const breathingOffset = cursor.offset;
  const breathingValues = collect
    ? cursor.f32Array(breathingCount, "breathing4.values")
    : (cursor.skip(
        checkedArrayBytes(breathingCount, 4, "breathing4.values"),
        "breathing4.values",
      ), []);

  const markerBlockOffset = cursor.offset;
  const markerCount = cursor.u32("bp.markers.count");
  if (markerCount < 1 || markerCount > 64) {
    throw new RangeError(`unexpected BP marker count ${markerCount}`);
  }
  const markerTimes = cursor.f64Array(markerCount, "bp.markers");
  const systolic = cursor.u8Array(cursor.u32("bp.systolic.count"), "bp.systolic");
  const diastolic = cursor.u8Array(cursor.u32("bp.diastolic.count"), "bp.diastolic");
  const maps = cursor.u8Array(cursor.u32("bp.map.count"), "bp.map");
  if (
    systolic.length !== markerCount ||
    diastolic.length !== markerCount ||
    maps.length !== markerCount
  ) {
    throw new RangeError("BP marker/value array counts disagree");
  }

  const trendT0 = cursor.f64("trends.t0");
  const trendDt = cursor.f64("trends.dt");
  if (Math.abs(trendDt - 4) > 1e-9) throw new RangeError(`unexpected trend dt ${trendDt}`);
  const trendChannels: Array<{ index: number; offset: number; values: number[] }> = [];
  for (let index = 0; index < TREND_COUNT; index += 1) {
    const count = cursor.u32(`trends[${index}].count`);
    const offset = cursor.offset;
    if (collect) {
      trendChannels.push({ index, offset, values: cursor.f32Array(count, `trends[${index}]`) });
    } else {
      cursor.skip(checkedArrayBytes(count, 4, `trends[${index}]`), `trends[${index}]`);
    }
  }

  const spectrogramHeaderOffset = cursor.offset;
  const spectrogramT0 = cursor.f64("spectrogram.t0");
  const spectrogramDt = cursor.f64("spectrogram.dt");
  const spectrogramFreqStart = cursor.f64("spectrogram.frequencyStart");
  const spectrogramFreqStep = cursor.f64("spectrogram.frequencyStep");
  const rows = cursor.u32("spectrogram.rows");
  const columns = cursor.u32("spectrogram.columns");
  if (rows < 1 || rows > 100_000 || columns < 1 || columns > 10_000) {
    throw new RangeError(`unexpected spectrogram shape ${rows}x${columns}`);
  }
  const spectrogramValuesOffset = cursor.offset;
  const spectrogramBytes = checkedArrayBytes(rows * columns, 4, "spectrogram.values");
  let spectrogramValues: Float32Array = EMPTY_F32;
  if (collect) {
    cursor.skip(spectrogramBytes, "spectrogram.values");
    spectrogramValues = new Float32Array(rows * columns);
    for (let index = 0; index < spectrogramValues.length; index += 1) {
      spectrogramValues[index] = buffer.readFloatBE(spectrogramValuesOffset + index * 4);
    }
  } else {
    cursor.skip(spectrogramBytes, "spectrogram.values");
  }

  if (
    Math.abs(rrT0 - hrT0) > 1e-6 ||
    Math.abs(rrT0 - trendT0) > 1e-6 ||
    Math.abs(rrT0 - spectrogramT0) > 1e-6 ||
    Math.abs(spectrogramDt - 4) > 1e-9
  ) {
    throw new RangeError("post-ECG series do not share the expected time base");
  }

  const summaryOffset = cursor.offset;
  const summary = readSummary(buffer, summaryOffset);
  if (summary.signature !== VENDOR_SUMMARY_SIGNATURE) {
    throw new RangeError(
      `unsupported phase-summary signature ${summary.signature}`,
    );
  }

  const labels = stringItem(summary.items, 2, "phase labels");
  const starts = numericItem(summary.items, 3, "f64", "phase starts");
  const ends = numericItem(summary.items, 4, "f64", "phase ends");
  const frf = numericItem(summary.items, 11, "f32", "FRF");
  const lfa = numericItem(summary.items, 13, "f32", "LFa");
  const rfa = numericItem(summary.items, 14, "f32", "RFa");
  const ratio = numericItem(summary.items, 15, "f32", "LFa/RFa");
  const meanHr = numericItem(summary.items, 16, "f32", "mean HR");
  const rangeHr = numericItem(summary.items, 36, "f32", "HR range");

  if (Math.abs(starts[0] - rrT0) > 0.01) {
    throw new RangeError("first phase does not start at the series time base");
  }
  for (let index = 0; index < PHASE_COUNT; index += 1) {
    if (!(ends[index] > starts[index])) throw new RangeError(`phase ${index} is empty`);
    if (index > 0 && Math.abs(starts[index] - ends[index - 1]) > 1e-5) {
      throw new RangeError(`phase ${index} is not contiguous`);
    }
    if (meanHr[index] < 30 || meanHr[index] > 220 || rangeHr[index] < 0) {
      throw new RangeError(`phase ${index} HR is implausible`);
    }
    if (frf[index] <= 0 || frf[index] >= 1 || rfa[index] <= 0) {
      throw new RangeError(`phase ${index} spectral values are implausible`);
    }
    const relativeRatioError = Math.abs(lfa[index] / rfa[index] - ratio[index]) /
      Math.max(Math.abs(ratio[index]), 1e-9);
    if (relativeRatioError > 0.02) {
      throw new RangeError(`phase ${index} LFa/RFa consistency check failed`);
    }
  }

  const phaseBps = Array.from({ length: PHASE_COUNT }, () => ({
    sys: [] as number[],
    dia: [] as number[],
    map: [] as number[],
  }));
  markerTimes.forEach((time, markerIndex) => {
    const phaseIndex = starts.findIndex(
      (start, index) => time >= start && time < ends[index],
    );
    if (phaseIndex >= 0) {
      phaseBps[phaseIndex].sys.push(systolic[markerIndex]);
      phaseBps[phaseIndex].dia.push(diastolic[markerIndex]);
      phaseBps[phaseIndex].map.push(maps[markerIndex]);
    }
  });

  const codes = ["A", "B", "C", "D", "E", "F"] as const;
  const phases = codes.map((code, index): VendorPhaseMetrics => {
    const bp = phaseBps[index];
    const bpReadingCount = bp.sys.length;
    const meanSys = bpReadingCount ? mean(bp.sys) : null;
    const meanDia = bpReadingCount ? mean(bp.dia) : null;
    return {
      index,
      code,
      label: labels[index],
      startAbs: starts[index],
      endAbs: ends[index],
      startSec: starts[index] - starts[0],
      endSec: ends[index] - starts[0],
      durationSec: ends[index] - starts[index],
      meanHr: meanHr[index],
      rangeHr: rangeHr[index],
      frf: frf[index],
      lfa: lfa[index],
      rfa: rfa[index],
      ratio: ratio[index],
      systolic: meanSys == null ? null : roundHalfEven(meanSys),
      diastolic: meanDia == null ? null : roundHalfEven(meanDia),
      map: bpReadingCount ? roundHalfEven(mean(bp.map)) : null,
      pulsePressure:
        meanSys == null || meanDia == null
          ? null
          : roundHalfEven(meanSys - meanDia),
      bpReadingCount,
    };
  });

  const series: VendorStoredSeries | undefined = collect
    ? {
        rrIntervalsSec: { offset: rrOffset, t0Abs: rrT0, values: rrValues },
        heartRate: { offset: hrOffset, t0Abs: hrT0, dtSec: hrDt, values: hrValues },
        breathing: {
          offset: breathingOffset,
          t0Abs: hrT0,
          dtSec: hrDt,
          values: breathingValues,
        },
        bpMarkers: {
          offset: markerBlockOffset,
          timesAbs: markerTimes,
          systolic,
          diastolic,
          map: maps,
        },
        trends: { t0Abs: trendT0, dtSec: trendDt, channels: trendChannels },
        spectrogram: {
          headerOffset: spectrogramHeaderOffset,
          valuesOffset: spectrogramValuesOffset,
          t0Abs: spectrogramT0,
          dtSec: spectrogramDt,
          freqStartHz: spectrogramFreqStart,
          freqStepHz: spectrogramFreqStep,
          rows,
          cols: columns,
          values: spectrogramValues,
        },
      }
    : undefined;

  return {
    phases,
    signature: summary.signature,
    summaryOffset,
    waveletName: summary.waveletName,
    markerCount,
    warnings: [],
    series,
  };
}
