import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStudy } from "../../api/_ans/parseStudy.ts";
import { parseBinaryHeader } from "../../api/_ans/parseBinary.ts";
import {
  parseVendorStoredAnalysis,
  roundHalfEven,
  type VendorPhaseMetrics,
  type VendorStoredSeries,
} from "../../api/_ans/vendorStored.ts";
import { resolveTrendMapping } from "../../api/_ans/vendorTrendMapping.ts";
import { buildVendorVisualization } from "../../api/_ans/vendorVisualization.ts";
import type { AnsStudy, PhaseBlock, ProvField } from "../../shared/ansStudy.ts";

type Status = "pass" | "mismatch" | "not_implemented" | "unavailable";
type Comparison = {
  caseId: string;
  deidentifiedFile: string;
  category: string;
  metric: string;
  status: Status;
  expected: unknown;
  actual: unknown;
  tolerance?: number;
  note?: string;
};
type OracleField<T> = { value: T; source_class?: string; confidence?: string };
type OraclePhaseRow = {
  event_code: OracleField<string>;
  event: OracleField<string>;
  duration: OracleField<string>;
  meanHR: OracleField<number>;
  rangeHR: OracleField<number>;
  FRF: OracleField<number>;
  LFA: OracleField<number>;
  RFA: OracleField<number>;
  LFA_RFA: OracleField<number>;
  BP: OracleField<string | null>;
  PP: OracleField<number | null>;
  MAP: OracleField<number | null>;
};
type OracleTrendArray = {
  index: number;
  offset: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  first4: number[];
};
type OracleCase = {
  ans_binary_structure: {
    bytes: number;
    sha256: string;
    ekg: { dt_sec: number; rate_hz: number; sample_count: number };
    beat_interval_series?: { offset: string; count: number; min: number; max: number; mean: number };
    sample_4hz_group?: {
      dt_sec: number;
      arrays: Array<{ offset: string; count: number; min: number; max: number; mean: number }>;
      array_semantics: string[];
    };
    trend_group_4sec?: {
      dt_sec: number;
      arrays: OracleTrendArray[];
      identified_semantics?: Record<string, string>;
    };
    spectrogram?: {
      dt_sec: number;
      f_param_1: number;
      f_param_2: number;
      rows: number;
      cols: number;
      dtype: string;
      bytes_needed: number;
    };
    tail?: { offset: string; preview_hex: string };
  };
  demographics: {
    sex: OracleField<string>;
    age_years: OracleField<number>;
    physician: OracleField<string>;
    test_date: OracleField<string>;
    test_time_local: OracleField<string>;
    height: OracleField<string>;
    weight_lbs: OracleField<number>;
    bmi: OracleField<number>;
    num_ectopic_beats: OracleField<number>;
  };
  page2: {
    ratios: {
      ei: OracleField<number>;
      valsalva: OracleField<number>;
      r3015: OracleField<number>;
    };
    numerical_summary: OraclePhaseRow[];
  };
};
type Oracle = {
  schema_version: string;
  cases: Record<string, OracleCase>;
  validation_summary: {
    total: number;
    pass: number;
    fail: number;
    mismatch_informational: number;
  };
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_PATH = path.join(HERE, "oracle.v1.json");
const CHECKSUM_PATH = path.join(HERE, "CHECKSUMS.sha256");

function parseArgs(argv: string[]) {
  let sourceRoot = process.env.ANS_VENDOR_SOURCE_ROOT ?? "";
  let out = "";
  let requireParity = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-root") sourceRoot = argv[++i] ?? "";
    else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--require-parity") requireParity = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: parity:vendor -- --source-root PATH [--out PATH] [--require-parity]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!sourceRoot) {
    throw new Error("Set ANS_VENDOR_SOURCE_ROOT or pass --source-root.");
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    sourceRoot: path.resolve(sourceRoot),
    out: path.resolve(out || path.join(HERE, "runs", timestamp)),
    requireParity,
  };
}

function sha256(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function verifyArtifacts(): void {
  for (const line of fs.readFileSync(CHECKSUM_PATH, "utf8").trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!match) throw new Error(`Malformed checksum line: ${line}`);
    const [, expected, name] = match;
    const actual = sha256(fs.readFileSync(path.join(HERE, name.trim())));
    if (actual !== expected) throw new Error(`Oracle artifact integrity failure: ${name.trim()}`);
  }
}

function walkAnsFiles(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else if (current.toLowerCase().endsWith(".ans")) found.push(current);
  }
  return found.sort();
}

function fieldValue<T>(field: ProvField<T> | undefined): T | null {
  return field?.value ?? null;
}

function normalizePhysician(input: unknown): string {
  return String(input ?? "").replace(/^\s*(?:dr\.?|doctor)\s+/i, "").trim().toLowerCase();
}

function heightToInches(input: string): number | null {
  const match = input.match(/(\d+)\s*ft\s*(\d+)\s*in/i);
  return match ? Number(match[1]) * 12 + Number(match[2]) : null;
}

function extractEctopicCount(study: AnsStudy): number {
  const match = study.rawAsciiHead.match(
    /(\d+)\s*possible\s+(?:premature\s+beat(?:\(s\))?|ectop(?:ic)?\s+beats?)/i,
  );
  return match ? Number(match[1]) : 0;
}

function equal(
  expected: unknown,
  actual: unknown,
  tolerance?: number,
  normalize?: (input: unknown) => unknown,
): boolean {
  const left = normalize ? normalize(expected) : expected;
  const right = normalize ? normalize(actual) : actual;
  if (typeof left === "number" && typeof right === "number" && tolerance !== undefined) {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
  }
  return left === right;
}

function compare(
  rows: Comparison[],
  row: Omit<Comparison, "status">,
  tolerance?: number,
  normalize?: (input: unknown) => unknown,
): void {
  rows.push({
    ...row,
    status: equal(row.expected, row.actual, tolerance, normalize) ? "pass" : "mismatch",
    ...(tolerance === undefined ? {} : { tolerance }),
  });
}

function getPhase(oracleCase: OracleCase, code: string): OraclePhaseRow {
  const phase = oracleCase.page2.numerical_summary.find((row) => row.event_code.value === code);
  if (!phase) throw new Error(`Oracle phase ${code} missing`);
  return phase;
}

function comparePhase(
  rows: Comparison[],
  caseId: string,
  deidentifiedFile: string,
  code: string,
  label: string,
  expected: OraclePhaseRow,
  actual: PhaseBlock,
): void {
  const base = { caseId, deidentifiedFile, category: `phase_${code}_${label}` };
  compare(rows, {
    ...base,
    metric: "mean_hr_bpm",
    expected: expected.meanHR.value,
    actual: fieldValue(actual.heartRate),
    note: "HumanOS ECG-derived phase versus vendor numerical summary.",
  }, 1);
  compare(rows, {
    ...base,
    metric: "lfa_bpm2",
    expected: expected.LFA.value,
    actual: fieldValue(actual.lfa),
    note: "Current HumanOS estimate; vendor spectral parity is not assumed.",
  }, 0.01);
  compare(rows, {
    ...base,
    metric: "rfa_bpm2",
    expected: expected.RFA.value,
    actual: fieldValue(actual.rfa),
    note: "Current HumanOS estimate; vendor spectral parity is not assumed.",
  }, 0.01);
  compare(rows, {
    ...base,
    metric: "lfa_rfa_ratio",
    expected: expected.LFA_RFA.value,
    actual: fieldValue(actual.sb),
    note: "Current HumanOS estimate; vendor spectral parity is not assumed.",
  }, 0.02);
}

function formatDuration(durationSec: number): string {
  const seconds = Math.floor(durationSec);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function fixed2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatBp(phase: VendorPhaseMetrics): string | null {
  return phase.systolic == null || phase.diastolic == null
    ? null
    : `${phase.systolic} / ${phase.diastolic}`;
}

function compareStoredPhase(
  rows: Comparison[],
  caseId: string,
  deidentifiedFile: string,
  expected: OraclePhaseRow,
  actual: VendorPhaseMetrics,
): void {
  const code = expected.event_code.value;
  const base = {
    caseId,
    deidentifiedFile,
    category: `stored_vendor_summary_phase_${code}`,
  };
  const values: Array<{
    metric: string;
    expected: unknown;
    actual: unknown;
    tolerance?: number;
  }> = [
    {
      metric: "duration_mm_ss",
      expected: expected.duration.value,
      actual: formatDuration(actual.durationSec),
    },
    {
      metric: "mean_hr_bpm",
      expected: expected.meanHR.value,
      actual: roundHalfEven(actual.meanHr),
    },
    {
      metric: "range_hr_bpm",
      expected: expected.rangeHR.value,
      actual: roundHalfEven(actual.rangeHr),
    },
    {
      metric: "frf_hz",
      expected: expected.FRF.value,
      actual: fixed2(actual.frf),
      tolerance: 0.01,
    },
    {
      metric: "lfa_bpm2",
      expected: expected.LFA.value,
      actual: fixed2(actual.lfa),
      tolerance: 0.01,
    },
    {
      metric: "rfa_bpm2",
      expected: expected.RFA.value,
      actual: fixed2(actual.rfa),
      tolerance: 0.01,
    },
    {
      metric: "lfa_rfa_ratio",
      expected: expected.LFA_RFA.value,
      actual: fixed2(actual.ratio),
      tolerance: 0.01,
    },
    {
      metric: "bp_sys_dia",
      expected: expected.BP.value,
      actual: formatBp(actual),
    },
    {
      metric: "pulse_pressure_mmhg",
      expected: expected.PP.value,
      actual: actual.pulsePressure,
    },
    {
      metric: "map_mmhg",
      expected: expected.MAP.value,
      actual: actual.map,
    },
  ];
  for (const value of values) {
    compare(
      rows,
      {
        ...base,
        metric: value.metric,
        expected: value.expected,
        actual: value.actual,
        note: "Read generically from the stored PhysioPS phase summary and BP marker arrays.",
      },
      value.tolerance,
    );
  }
}


// ---------------------------------------------------------------------------
// Phase 3: stored visualization parity
//
// These are real scored checks, not placeholders. The oracle records the byte
// offset, sample count, min/max/mean and first four values of every stored
// array, plus the spectrogram block's declared geometry and a byte-exact hex
// preview of its header. HumanOS must reproduce all of it from the file alone.
// ---------------------------------------------------------------------------

/** Oracle statistics are transcribed to 4 decimal places. */
const STAT_TOLERANCE = 5e-5;

function hexOffset(input: string | undefined): number | null {
  if (!input) return null;
  const parsed = Number.parseInt(input, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function seriesStats(values: number[]): { count: number; min: number; max: number; mean: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    total += value;
  }
  return {
    count: values.length,
    min: values.length ? round4(min) : 0,
    max: values.length ? round4(max) : 0,
    mean: values.length ? round4(total / values.length) : 0,
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function statsTolerantEqual(
  expected: { count: number; min: number; max: number; mean: number },
  actual: { count: number; min: number; max: number; mean: number },
): boolean {
  return (
    expected.count === actual.count &&
    // Oracle statistics are 4-dp transcriptions of float32 values, so the last
    // transcribed digit is a rounding artefact at large magnitudes.
    Math.abs(expected.min - actual.min) <= Math.max(STAT_TOLERANCE, Math.abs(expected.min) * 1e-6) &&
    Math.abs(expected.max - actual.max) <= Math.max(STAT_TOLERANCE, Math.abs(expected.max) * 1e-6) &&
    // The oracle mean is a 4-dp transcription of a float32 average; allow the
    // last transcribed digit plus float32 accumulation noise.
    Math.abs(expected.mean - actual.mean) <= Math.max(STAT_TOLERANCE, Math.abs(expected.mean) * 2e-5)
  );
}

function pushStatus(
  rows: Comparison[],
  row: Omit<Comparison, "status">,
  ok: boolean,
): void {
  rows.push({ ...row, status: ok ? "pass" : "mismatch" });
}

/** Rebuild the spectrogram block header exactly as it must appear on disk. */
function spectrogramHeaderHex(series: VendorStoredSeries): string {
  const header = Buffer.alloc(48);
  header.writeDoubleBE(series.spectrogram.t0Abs, 0);
  header.writeDoubleBE(series.spectrogram.dtSec, 8);
  header.writeDoubleBE(series.spectrogram.freqStartHz, 16);
  header.writeDoubleBE(series.spectrogram.freqStepHz, 24);
  header.writeUInt32BE(series.spectrogram.rows, 32);
  header.writeUInt32BE(series.spectrogram.cols, 36);
  header.writeFloatBE(series.spectrogram.values[0] ?? 0, 40);
  header.writeFloatBE(series.spectrogram.values[1] ?? 0, 44);
  return header.toString("hex");
}

function compareVisualization(
  rows: Comparison[],
  caseId: string,
  deidentifiedFile: string,
  oracleCase: OracleCase,
  series: VendorStoredSeries,
  phases: VendorPhaseMetrics[],
  waveletName: string,
): void {
  const base = { caseId, deidentifiedFile };
  const binary = oracleCase.ans_binary_structure;

  // ---- 4 Hz series ---------------------------------------------------------
  const fast = binary.sample_4hz_group;
  if (fast) {
    const actualFast = [series.heartRate, series.breathing];
    compare(rows, {
      ...base,
      category: "stored_series_4hz",
      metric: "dt_sec",
      expected: fast.dt_sec,
      actual: series.heartRate.dtSec,
      note: "Stored 4 Hz time base for the heart-rate and breathing arrays.",
    }, 1e-9);
    fast.arrays.forEach((expected, index) => {
      const actual = actualFast[index];
      const label = fast.array_semantics[index] ?? `array_${index}`;
      compare(rows, {
        ...base,
        category: "stored_series_4hz",
        metric: `array_${index}_offset`,
        expected: hexOffset(expected.offset),
        actual: actual?.countOffset ?? null,
        note: `Byte offset of the stored ${label} array descriptor.`,
      });
      const stats = seriesStats(actual?.values ?? []);
      pushStatus(rows, {
        ...base,
        category: "stored_series_4hz",
        metric: `array_${index}_stats`,
        expected: { count: expected.count, min: expected.min, max: expected.max, mean: expected.mean },
        actual: stats,
        note: `Count, min, max and mean of the stored ${label} array.`,
      }, statsTolerantEqual(expected, stats));
    });
  }

  // ---- beat-to-beat interval series ---------------------------------------
  const beats = binary.beat_interval_series;
  if (beats) {
    compare(rows, {
      ...base,
      category: "stored_series_rr",
      metric: "offset",
      expected: hexOffset(beats.offset),
      actual: series.rrIntervalsSec.blockOffset,
      note: "Byte offset of the stored beat-to-beat interval series.",
    });
    const stats = seriesStats(series.rrIntervalsSec.values);
    pushStatus(rows, {
      ...base,
      category: "stored_series_rr",
      metric: "stats",
      expected: { count: beats.count, min: beats.min, max: beats.max, mean: beats.mean },
      actual: stats,
      note: "Count, min, max and mean of the stored interval series.",
    }, statsTolerantEqual(beats, stats));
  }

  // ---- 4-second trend arrays ----------------------------------------------
  const trends = binary.trend_group_4sec;
  const mapping = resolveTrendMapping(series, phases);
  if (trends) {
    compare(rows, {
      ...base,
      category: "vendor_trend_arrays",
      metric: "dt_sec",
      expected: trends.dt_sec,
      actual: series.trends.dtSec,
    }, 1e-9);
    compare(rows, {
      ...base,
      category: "vendor_trend_arrays",
      metric: "array_count",
      expected: trends.arrays.length,
      actual: series.trends.channels.length,
    });
    trends.arrays.forEach((expected) => {
      const actual = series.trends.channels.find((channel) => channel.index === expected.index);
      compare(rows, {
        ...base,
        category: "vendor_trend_arrays",
        metric: `trend_${expected.index}_offset`,
        expected: hexOffset(expected.offset),
        actual: actual?.countOffset ?? null,
        note: "Byte offset of the stored trend array descriptor.",
      });
      const stats = seriesStats(actual?.values ?? []);
      pushStatus(rows, {
        ...base,
        category: "vendor_trend_arrays",
        metric: `trend_${expected.index}_stats`,
        expected: { count: expected.count, min: expected.min, max: expected.max, mean: expected.mean },
        actual: stats,
      }, statsTolerantEqual(expected, stats));
      const firstFour = (actual?.values ?? []).slice(0, 4).map(round4);
      pushStatus(rows, {
        ...base,
        category: "vendor_trend_arrays",
        metric: `trend_${expected.index}_first4`,
        expected: expected.first4,
        actual: firstFour,
      },
        firstFour.length === expected.first4.length &&
          expected.first4.every((value, index) => Math.abs(value - firstFour[index]) <= STAT_TOLERANCE),
      );
    });
  }

  // ---- index-to-metric mapping --------------------------------------------
  const semantics = trends?.identified_semantics ?? {};
  const indexOfRole = (role: string): number | null =>
    mapping.channels.find((channel) => channel.role === role)?.index ?? null;
  const parseIndices = (key: string): number[] =>
    key
      .split(/[^0-9]+/)
      .map((part) => Number.parseInt(part, 10))
      .filter((value) => Number.isInteger(value));
  const semanticIndices = (needle: RegExp): number[] => {
    const key = Object.keys(semantics).find((candidate) => needle.test(semantics[candidate]));
    return key ? parseIndices(key) : [];
  };

  const frfExpected = semanticIndices(/^FRF/i);
  compare(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "frf_index",
    expected: frfExpected.length === 1 ? frfExpected[0] : null,
    actual: indexOfRole("frf_hz"),
    note: "Resolved from in-file evidence only; compared against the oracle's identified semantics.",
  });

  const bpm2Expected = semanticIndices(/LFa \/ RFa spectral power/i).slice().sort((a, b) => a - b);
  const bpm2Actual = [indexOfRole("lfa_bpm2"), indexOfRole("rfa_bpm2")]
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  pushStatus(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "lfa_rfa_index_pair",
    expected: bpm2Expected,
    actual: bpm2Actual,
    note:
      "The oracle left the LFa/RFa index ORDER unresolved; HumanOS resolves the order from the " +
      "stored per-phase summary and reports both indices.",
  }, bpm2Expected.length === 2 && JSON.stringify(bpm2Expected) === JSON.stringify(bpm2Actual));

  const percentExpected = semanticIndices(/percent split/i).slice().sort((a, b) => a - b);
  const percentActual = [indexOfRole("lfa_share_percent"), indexOfRole("rfa_share_percent")]
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  pushStatus(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "share_index_pair",
    expected: percentExpected,
    actual: percentActual,
  }, percentExpected.length === 2 && JSON.stringify(percentExpected) === JSON.stringify(percentActual));

  const ratioExpected = semanticIndices(/ratio candidate/i);
  compare(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "vendor_internal_ratio_index",
    expected: ratioExpected.length === 1 ? ratioExpected[0] : null,
    actual: indexOfRole("lfa_rfa_area_ratio"),
  });

  compare(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "clinical_channels_resolved",
    expected: true,
    actual: mapping.clinicalChannelsResolved,
    note: mapping.warnings.join(" ") || "LFa, RFa, the LFa/RFa ratio and FRF were all resolved.",
  });

  // Every resolved channel must carry a method that is not a guess.
  compare(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "no_unjustified_labels",
    expected: true,
    actual: mapping.channels.every(
      (channel) =>
        (channel.role === "unmapped" && channel.method === "unresolved") ||
        (channel.role !== "unmapped" && channel.method !== "unresolved" && channel.evidence.length > 0),
    ),
  });

  // Exact pointwise identity: the mapped ratio channel IS LFa / RFa.
  const lfaIndex = indexOfRole("lfa_bpm2");
  const rfaIndex = indexOfRole("rfa_bpm2");
  const ratioIndex = indexOfRole("lfa_rfa_ratio");
  let identityAgreement: number | null = null;
  if (lfaIndex !== null && rfaIndex !== null && ratioIndex !== null) {
    const lfa = series.trends.channels[lfaIndex].values;
    const rfa = series.trends.channels[rfaIndex].values;
    const ratio = series.trends.channels[ratioIndex].values;
    let comparable = 0;
    let agreeing = 0;
    for (let index = 0; index < ratio.length; index += 1) {
      if (rfa[index] === 0 || ratio[index] === 0) continue;
      comparable += 1;
      if (Math.abs(lfa[index] / rfa[index] - ratio[index]) / Math.abs(ratio[index]) <= 1e-3) {
        agreeing += 1;
      }
    }
    identityAgreement = comparable ? Math.round((agreeing / comparable) * 10_000) / 10_000 : null;
  }
  pushStatus(rows, {
    ...base,
    category: "vendor_trend_array_mapping",
    metric: "ratio_identity_agreement",
    expected: ">= 0.99",
    actual: identityAgreement,
  }, identityAgreement !== null && identityAgreement >= 0.99);

  // ---- wavelet spectrogram -------------------------------------------------
  const spectrogram = binary.spectrogram;
  if (spectrogram) {
    const category = "vendor_wavelet_spectrogram";
    compare(rows, { ...base, category, metric: "rows", expected: spectrogram.rows, actual: series.spectrogram.rows });
    compare(rows, { ...base, category, metric: "cols", expected: spectrogram.cols, actual: series.spectrogram.cols });
    compare(rows, { ...base, category, metric: "dt_sec", expected: spectrogram.dt_sec, actual: series.spectrogram.dtSec }, 1e-9);
    compare(rows, { ...base, category, metric: "frequency_start_hz", expected: spectrogram.f_param_1, actual: series.spectrogram.freqStartHz }, 1e-12);
    compare(rows, { ...base, category, metric: "frequency_step_hz", expected: spectrogram.f_param_2, actual: series.spectrogram.freqStepHz }, 1e-12);
    compare(rows, {
      ...base,
      category,
      metric: "value_bytes",
      expected: spectrogram.bytes_needed,
      actual: series.spectrogram.values.length * 4,
      note: "Every declared float32 cell must be materialized.",
    });
    compare(rows, {
      ...base,
      category,
      metric: "values_finite",
      expected: true,
      actual: series.spectrogram.values.every((value) => Number.isFinite(value)),
    });
    const tail = binary.tail;
    if (tail) {
      compare(rows, {
        ...base,
        category,
        metric: "block_offset",
        expected: hexOffset(tail.offset),
        actual: series.spectrogram.headerOffset,
      });
      // Byte-exact reproduction: rebuild the stored header plus the first two
      // stored cells and compare against the oracle's raw hex preview.
      compare(rows, {
        ...base,
        category,
        metric: "block_header_bytes_hex",
        expected: tail.preview_hex.toLowerCase(),
        actual: spectrogramHeaderHex(series),
        note: "Header doubles, row/column counts and the first two stored cells, byte for byte.",
      });
    }

    // Transport must not alter a single stored value.
    const visualization = buildVendorVisualization(series, phases, waveletName);
    const payload = visualization.spectrogram;
    let transportExact = false;
    if (payload && payload.source === "ans_stored" && payload.strideFactor === 1) {
      const decoded = Buffer.from(payload.values, "base64");
      transportExact =
        decoded.byteLength === series.spectrogram.values.length * 4 &&
        series.spectrogram.values.every(
          (value, index) => decoded.readFloatBE(index * 4) === value,
        );
    }
    pushStatus(rows, {
      ...base,
      category,
      metric: "transport_roundtrip_exact",
      expected: true,
      actual: transportExact,
      note: "Base64 float32 transport decoded back to the stored matrix without loss.",
    }, transportExact);
    compare(rows, {
      ...base,
      category,
      metric: "wavelet_name_present",
      expected: true,
      actual: typeof waveletName === "string" && waveletName.length > 0,
    });
  }
}

function compareCase(
  caseId: string,
  oracleCase: OracleCase,
  source: { buffer: Buffer; hash: string } | undefined,
): Comparison[] {
  const number = caseId.match(/\d+/)?.[0]?.padStart(2, "0") ?? "00";
  const deidentifiedFile = `case${number}_ans.ans`;
  if (!source) {
    return [{
      caseId,
      deidentifiedFile,
      category: "source",
      metric: "oracle_source_file",
      status: "unavailable",
      expected: oracleCase.ans_binary_structure.sha256,
      actual: null,
      note: "No local file matched the oracle SHA-256.",
    }];
  }

  const study = parseStudy({ buffer: source.buffer, fileName: deidentifiedFile });
  const binaryHeader = parseBinaryHeader(source.buffer);
  if (!binaryHeader.sampling) throw new Error(`Binary sampling block missing for ${caseId}`);
  const stored = parseVendorStoredAnalysis(source.buffer, binaryHeader.sampling, {
    collectSeries: true,
  });
  const rows: Comparison[] = [];
  const binary = oracleCase.ans_binary_structure;
  const demo = oracleCase.demographics;
  const ratios = oracleCase.page2.ratios;
  const base = { caseId, deidentifiedFile };

  compare(rows, { ...base, category: "file_integrity", metric: "sha256", expected: binary.sha256, actual: source.hash });
  compare(rows, { ...base, category: "file_integrity", metric: "bytes", expected: binary.bytes, actual: study.fileMetadata.fileSizeBytes });
  compare(rows, { ...base, category: "demographics", metric: "sex", expected: demo.sex.value, actual: fieldValue(study.patient.sex) });
  compare(rows, { ...base, category: "demographics", metric: "age_years", expected: demo.age_years.value, actual: fieldValue(study.patient.ageAtStudy) });
  compare(rows, {
    ...base,
    category: "demographics",
    metric: "physician",
    expected: demo.physician.value,
    actual: fieldValue(study.patient.physician),
  }, undefined, normalizePhysician);
  compare(rows, { ...base, category: "study_metadata", metric: "test_date", expected: demo.test_date.value, actual: fieldValue(study.fileMetadata.studyDate) });
  compare(rows, {
    ...base,
    category: "study_metadata",
    metric: "test_time_local",
    expected: demo.test_time_local.value,
    actual: fieldValue(study.fileMetadata.studyStartTime),
    note:
      "Vendor time is decoded from the exact BE-double LabVIEW start timestamp " +
      "and rendered with the configured acquisition-workstation UTC offset.",
  });
  compare(rows, { ...base, category: "sampling", metric: "sampling_rate_hz", expected: binary.ekg.rate_hz, actual: fieldValue(study.fileMetadata.samplingRateHz) });
  compare(rows, { ...base, category: "sampling", metric: "sampling_interval_sec", expected: binary.ekg.dt_sec, actual: fieldValue(study.fileMetadata.samplingInterval) }, 0.0000001);
  compare(rows, { ...base, category: "sampling", metric: "sample_count", expected: binary.ekg.sample_count, actual: fieldValue(study.fileMetadata.dataPointCount) });
  compare(rows, { ...base, category: "anthropometrics", metric: "height_inches", expected: heightToInches(demo.height.value), actual: fieldValue(study.anthropometrics.heightInches) });
  compare(rows, {
    ...base,
    category: "anthropometrics",
    metric: "weight_source_policy",
    expected: null,
    actual: fieldValue(study.anthropometrics.weightLbs),
    note: "Weight is PDF-only and must not be invented from .ans.",
  });
  compare(rows, {
    ...base,
    category: "anthropometrics",
    metric: "bmi_source_policy",
    expected: null,
    actual: fieldValue(study.anthropometrics.bmi),
    note: "BMI requires supplied weight and must remain unknown for .ans-only upload.",
  });
  compare(rows, { ...base, category: "ratios", metric: "ei_ratio", expected: ratios.ei.value, actual: fieldValue(study.ratios.eiRatio) }, 0.001);
  compare(rows, { ...base, category: "ratios", metric: "valsalva_ratio", expected: ratios.valsalva.value, actual: fieldValue(study.ratios.valsalvaRatio) }, 0.001);
  compare(rows, { ...base, category: "ratios", metric: "thirty_fifteen_ratio", expected: ratios.r3015.value, actual: fieldValue(study.ratios.thirtyFifteenRatio) }, 0.001);
  compare(rows, { ...base, category: "ectopy", metric: "raw_ascii_ectopic_count", expected: demo.num_ectopic_beats.value, actual: extractEctopicCount(study) });
  compare(rows, {
    ...base,
    category: "ectopy",
    metric: "canonical_study_ectopic_count",
    expected: demo.num_ectopic_beats.value,
    actual: fieldValue(study.ectopicBeats),
    note:
      "Canonical provenance-bearing ectopic count; a complete ECG record with no " +
      "annotation uses the validated PhysioPS zero-omission convention.",
  });

  comparePhase(rows, caseId, deidentifiedFile, "A", "baseline", getPhase(oracleCase, "A"), study.baseline);
  comparePhase(rows, caseId, deidentifiedFile, "B", "deep_breathing", getPhase(oracleCase, "B"), study.deepBreathing);
  comparePhase(rows, caseId, deidentifiedFile, "D", "valsalva", getPhase(oracleCase, "D"), study.valsalva);
  comparePhase(rows, caseId, deidentifiedFile, "F", "stand", getPhase(oracleCase, "F"), study.standOrTilt);
  for (const phase of stored.phases) {
    compareStoredPhase(
      rows,
      caseId,
      deidentifiedFile,
      getPhase(oracleCase, phase.code),
      phase,
    );
  }

  const reasons = study.ecg.quality.unusableReasons;
  compare(rows, {
    ...base,
    category: "quality_invariant",
    metric: "usable_has_no_unusable_reasons",
    expected: true,
    actual: !(study.ecg.quality.usable && reasons.length > 0),
    note:
      reasons.length
        ? `Blocking reasons present: ${reasons.join(", ")}`
        : study.ecg.quality.artifactFlags.length
          ? `Non-blocking artifact flags: ${study.ecg.quality.artifactFlags.join(", ")}`
          : "No contradictory reasons.",
  });
  compare(rows, {
    ...base,
    category: "confidence_invariant",
    metric: "valid_vendor_file_recognized",
    expected: true,
    actual:
      study.parserConfidence.sectionsDetected.length > 0 ||
      (fieldValue(study.patient.ageAtStudy) !== null &&
        fieldValue(study.ratios.eiRatio) !== null &&
        fieldValue(study.fileMetadata.dataPointCount) !== null),
    note: "Direct binary and ratio evidence recognizes a valid file even without ASCII phase headings.",
  });

  if (stored.series) {
    compareVisualization(
      rows,
      caseId,
      deidentifiedFile,
      oracleCase,
      stored.series,
      stored.phases,
      stored.waveletName,
    );
  } else {
    rows.push({
      ...base,
      category: "vendor_visualization",
      metric: "stored_series_available",
      status: "unavailable",
      expected: "stored trend and spectrogram arrays",
      actual: null,
      note: "The stored analysis block did not yield the visualization series.",
    });
  }
  return rows;
}

function summarize(rows: Comparison[]) {
  const statuses: Record<Status, number> = { pass: 0, mismatch: 0, not_implemented: 0, unavailable: 0 };
  for (const row of rows) statuses[row.status] += 1;
  return {
    cases: new Set(rows.map((row) => row.caseId)).size,
    comparisons: rows.length,
    statuses,
    parityPercent: rows.length ? Math.round((statuses.pass / rows.length) * 10_000) / 100 : 0,
  };
}

function formatCell(input: unknown): string {
  if (input === null || input === undefined) return "null";
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownReport(oracle: Oracle, rows: Comparison[], sourcesFound: number): string {
  const summary = summarize(rows);
  const byCase = [...new Set(rows.map((row) => row.caseId))].map((caseId) => ({
    caseId,
    ...summarize(rows.filter((row) => row.caseId === caseId)),
  }));
  const gaps = rows.filter((row) => row.status !== "pass");
  return [
    "# HumanOS ANS Vendor-Parity Report",
    "",
    "This measures the canonical HumanOS `.ans` parser against the deidentified 11-case PhysioPS vendor oracle. It is software validation, not a diagnosis.",
    "",
    "## Executive result",
    "",
    `- Oracle schema: \`${oracle.schema_version}\``,
    `- Private source files matched by SHA-256: **${sourcesFound}/11**`,
    `- Comparisons: **${summary.comparisons}**`,
    `- Pass: **${summary.statuses.pass}**`,
    `- Mismatch: **${summary.statuses.mismatch}**`,
    `- Not implemented: **${summary.statuses.not_implemented}**`,
    `- Unavailable: **${summary.statuses.unavailable}**`,
    `- Raw parity ratio: **${summary.parityPercent}%**`,
    "",
    "Core integrity, demographics, sampling metadata, Ewing ratios, height, the no-invented-weight/BMI policy, and all six stored PhysioPS numerical-summary rows are measured directly. Remaining visualization-array gaps are explicit and are not confused with the recovered vendor summary.",
    "",
    "## Case matrix",
    "",
    "| Case | Comparisons | Pass | Mismatch | Not implemented | Unavailable |",
    "|---|---:|---:|---:|---:|---:|",
    ...byCase.map((item) => `| ${item.caseId} | ${item.comparisons} | ${item.statuses.pass} | ${item.statuses.mismatch} | ${item.statuses.not_implemented} | ${item.statuses.unavailable} |`),
    "",
    "## Open discrepancies",
    "",
    "| Case | Category | Metric | Status | Expected | Actual |",
    "|---|---|---|---|---|---|",
    ...gaps.map((row) => `| ${row.caseId} | ${row.category} | ${row.metric} | ${row.status} | ${formatCell(row.expected)} | ${formatCell(row.actual)} |`),
    "",
    "## Recovery disposition",
    "",
    "- The deidentified oracle is checksum-protected.",
    "- Source matching is hash-based; local filenames and paths are excluded from output.",
    "- The diagnostic command records current truth without blocking development.",
    "- The strict command remains intentionally blocking while any measured gap remains.",
    "- No production deployment is part of this recovery checkpoint.",
    "",
  ].join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  verifyArtifacts();
  const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, "utf8")) as Oracle;
  const caseIds = Object.keys(oracle.cases).sort();
  if (oracle.schema_version !== "1.0.0") throw new Error(`Unexpected oracle schema: ${oracle.schema_version}`);
  if (caseIds.length !== 11) throw new Error(`Expected 11 oracle cases, found ${caseIds.length}`);
  if (oracle.validation_summary.fail !== 0) throw new Error("Oracle contains failed validation checks.");
  if (!fs.existsSync(args.sourceRoot)) throw new Error("Private source root does not exist.");

  const expectedByHash = new Map(caseIds.map((caseId) => [oracle.cases[caseId].ans_binary_structure.sha256, caseId]));
  const matched = new Map<string, { buffer: Buffer; hash: string }>();
  for (const file of walkAnsFiles(args.sourceRoot)) {
    const buffer = fs.readFileSync(file);
    const hash = sha256(buffer);
    const caseId = expectedByHash.get(hash);
    if (caseId && !matched.has(caseId)) matched.set(caseId, { buffer, hash });
  }

  const comparisons = caseIds.flatMap((caseId) => compareCase(caseId, oracle.cases[caseId], matched.get(caseId)));
  const summary = summarize(comparisons);
  const output = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    oracle: {
      schemaVersion: oracle.schema_version,
      caseCount: caseIds.length,
      validationSummary: oracle.validation_summary,
      checksumVerified: true,
    },
    privacy: {
      patientNamesIncluded: false,
      datesOfBirthIncluded: false,
      sourcePathsIncluded: false,
      sourceFilenamesIncluded: false,
      matchingMethod: "sha256",
    },
    sourceCoverage: { expectedCases: caseIds.length, matchedCases: matched.size },
    summary,
    comparisons,
  };

  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, "vendor-parity.json"), `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(args.out, "vendor-parity.md"), markdownReport(oracle, comparisons, matched.size));
  console.log(JSON.stringify({ out: args.out, ...summary }, null, 2));
  if (args.requireParity && (summary.statuses.mismatch || summary.statuses.not_implemented || summary.statuses.unavailable)) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
