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
} from "../../api/_ans/vendorStored.ts";
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
type OracleCase = {
  ans_binary_structure: {
    bytes: number;
    sha256: string;
    ekg: { dt_sec: number; rate_hz: number; sample_count: number };
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
  const stored = parseVendorStoredAnalysis(source.buffer, binaryHeader.sampling);
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

  for (const [metric, note] of [
    ["vendor_trend_array_mapping", "Exact LFa/RFa trend-array indices remain unresolved."],
    ["vendor_wavelet_spectrogram", "Vendor wavelet/spectrogram reproduction is not implemented."],
  ] as const) {
    rows.push({
      ...base,
      category: "residual_vendor_parity",
      metric,
      status: "not_implemented",
      expected: "vendor parity",
      actual: null,
      note,
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
