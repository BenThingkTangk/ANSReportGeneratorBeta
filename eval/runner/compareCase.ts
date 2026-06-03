/**
 * Pure case-comparator. Takes an EvalCase and an actual (AnsStudy + DiagnosticSummary)
 * and produces an EvalCaseResult with structured failure list + per-case metrics.
 *
 * No I/O — safe to import from CI runner, Vitest, and the admin UI.
 */

import type { AnsStudy } from "../../shared/ansStudy";
import type {
  DiagnosticSummary,
  Confidence,
} from "../../shared/diagnosticSummary";
import type {
  EvalCase,
  EvalCaseResult,
  EvalFailure,
  EvalMetrics,
  ExpectedScalar,
  ExpectedDomainScore,
} from "../../shared/evalTypes";

const CONFIDENCE_RANK: Record<Confidence, number> = { Low: 0, Medium: 1, High: 2 };

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function getByPath<T = unknown>(obj: unknown, path: string): T | undefined {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur as T | undefined;
}

function fieldValue<T>(study: AnsStudy, path: string): T | null {
  // ProvField paths end at the field itself; we want .value.
  const f = getByPath<{ value: T | null }>(study, path);
  return f?.value ?? null;
}

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function scalarMatch<T>(actual: T | null, expected: ExpectedScalar<T>): {
  ok: boolean;
  reason?: string;
} {
  if (expected.value === null) {
    return actual == null
      ? { ok: true }
      : { ok: false, reason: `expected null, got ${JSON.stringify(actual)}` };
  }
  if (actual == null) {
    return { ok: false, reason: `expected ${JSON.stringify(expected.value)}, got null` };
  }
  if (typeof expected.value === "number" && typeof actual === "number") {
    const tol = expected.tolerance ?? 0;
    return nearlyEqual(actual, expected.value, tol)
      ? { ok: true }
      : { ok: false, reason: `${actual} ≠ ${expected.value} (±${tol})` };
  }
  if (typeof expected.value === "string" && typeof actual === "string") {
    return actual.trim().toLowerCase() === expected.value.trim().toLowerCase()
      ? { ok: true }
      : { ok: false, reason: `"${actual}" ≠ "${expected.value}"` };
  }
  return actual === expected.value
    ? { ok: true }
    : { ok: false, reason: `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected.value)}` };
}

// Map an ExpectedFields key → dotted AnsStudy path for actual lookup.
const FIELD_PATH: Record<string, string> = {
  lastName: "patient.lastName",
  firstName: "patient.firstName",
  ageAtStudy: "patient.ageAtStudy",
  sex: "patient.sex",
  physician: "patient.physician",
  dob: "patient.dob",
  samplingRateHz: "fileMetadata.samplingRateHz",
  baselineHr: "baseline.heartRate",
  baselineSbp: "baseline.bp.sbp",
  baselineDbp: "baseline.bp.dbp",
  standHr: "standOrTilt.heartRate",
  standSbp: "standOrTilt.bp.sbp",
  standDbp: "standOrTilt.bp.dbp",
  eiRatio: "ratios.eiRatio",
  valsalvaRatio: "ratios.valsalvaRatio",
  thirtyFifteenRatio: "ratios.thirtyFifteenRatio",
};

const DEMOGRAPHIC_KEYS = new Set(["lastName", "firstName", "ageAtStudy", "sex", "physician", "dob"]);

// ----------------------------------------------------------------------------
// Comparator
// ----------------------------------------------------------------------------

export interface CompareInput {
  evalCase: EvalCase;
  study: AnsStudy;
  summary: DiagnosticSummary;
  parserError?: string;
  durationMs: number;
}

export function compareCase(input: CompareInput): EvalCaseResult {
  const { evalCase, study, summary, parserError, durationMs } = input;
  const failures: EvalFailure[] = [];

  // Track metric accumulators.
  let demoCorrect = 0, demoTotal = 0;
  let numCorrect = 0, numTotal = 0;
  let missingCorrect = 0, missingTotal = 0;

  if (parserError) {
    failures.push({
      category: "parser_error",
      code: "PARSER_THREW",
      message: parserError,
    });
  }

  // -- Expected scalar fields ----------------------------------------------
  const ef = evalCase.expectedFields;
  for (const [key, expected] of Object.entries(ef)) {
    if (key === "expectedMissing" || expected == null) continue;
    const path = FIELD_PATH[key];
    if (!path) continue;
    const actual = fieldValue<unknown>(study, path);
    const isDemo = DEMOGRAPHIC_KEYS.has(key);
    if (isDemo) demoTotal += 1;
    else numTotal += 1;
    const res = scalarMatch(actual, expected as ExpectedScalar<unknown>);
    if (res.ok) {
      if (isDemo) demoCorrect += 1;
      else numCorrect += 1;
    } else {
      failures.push({
        category: isDemo ? "demographics" : "numeric",
        code: `${key.toUpperCase()}_MISMATCH`,
        message: `${key}: ${res.reason}`,
        expected: (expected as ExpectedScalar<unknown>).value,
        actual,
        path,
      });
    }
  }

  // -- Expected missing -----------------------------------------------------
  for (const path of ef.expectedMissing ?? []) {
    missingTotal += 1;
    const actual = fieldValue<unknown>(study, path);
    if (actual == null) {
      missingCorrect += 1;
    } else {
      failures.push({
        category: "missing_detection",
        code: "EXPECTED_MISSING_PRESENT",
        message: `${path} should be missing but parser extracted ${JSON.stringify(actual)}`,
        expected: null,
        actual,
        path,
      });
    }
  }

  // -- Expected domain scores ----------------------------------------------
  const es = evalCase.expectedScores;
  const cardiovagalMad = compareDomain("cardiovagal", es.cardiovagal, summary.cardiovagalScore, failures);
  const adrenergicMad = compareDomain("adrenergic", es.adrenergic, summary.adrenergicScore, failures);
  compareDomain("sudomotor", es.sudomotor, summary.sudomotorScore, failures);

  let totalSeverityMad: number | null = null;
  if (es.expectedTotalSeverity != null) {
    const tol = es.totalSeverityTolerance ?? 0;
    const diff = Math.abs(summary.totalAutonomicSeverityScore - es.expectedTotalSeverity);
    totalSeverityMad = diff;
    if (diff > tol) {
      failures.push({
        category: "domain_score",
        code: "TOTAL_SEVERITY_MISMATCH",
        message: `total severity ${summary.totalAutonomicSeverityScore} ≠ ${es.expectedTotalSeverity} (±${tol})`,
        expected: es.expectedTotalSeverity,
        actual: summary.totalAutonomicSeverityScore,
      });
    }
  }
  if (es.expectedReportConfidence) {
    if (CONFIDENCE_RANK[summary.reportConfidence] < CONFIDENCE_RANK[es.expectedReportConfidence]) {
      failures.push({
        category: "report_confidence",
        code: "REPORT_CONFIDENCE_TOO_LOW",
        message: `expected ≥ ${es.expectedReportConfidence}, got ${summary.reportConfidence}`,
        expected: es.expectedReportConfidence,
        actual: summary.reportConfidence,
      });
    }
  }

  // -- Phenotype flags ------------------------------------------------------
  // Precision/recall is computed against the "abnormal-when-present" set.
  let tp = 0, fp = 0, fn = 0;
  const expectedFlagsById = new Map(evalCase.expectedFlags.phenotypes.map(p => [p.id, p]));
  const actualFlagsById = new Map(summary.phenotypeFlags.map(p => [p.id, p]));

  for (const [id, exp] of Array.from(expectedFlagsById)) {
    const act = actualFlagsById.get(id);
    if (exp.present === "absent") {
      if (act) {
        failures.push({
          category: "phenotype_flag",
          code: "FLAG_SHOULD_BE_ABSENT",
          message: `${id} should not be emitted at all`,
          expected: "absent",
          actual: act.present,
        });
      }
      continue;
    }
    const actPresent = act?.present ?? false;
    if (exp.present && actPresent) tp += 1;
    if (exp.present && !actPresent) fn += 1;
    if (!exp.present && actPresent) fp += 1;
    if (actPresent !== exp.present) {
      failures.push({
        category: "phenotype_flag",
        code: "FLAG_PRESENCE_MISMATCH",
        message: `${id}: expected present=${exp.present}, got ${actPresent}`,
        expected: exp.present,
        actual: actPresent,
      });
    }
  }
  // Also count false positives among present flags not listed in expectations.
  for (const [id, act] of Array.from(actualFlagsById)) {
    if (act.present && !expectedFlagsById.has(id) && id !== "insufficient_data") {
      fp += 1;
      failures.push({
        category: "phenotype_flag",
        code: "FLAG_UNEXPECTED_PRESENCE",
        message: `unexpected flag present: ${id}`,
        actual: id,
      });
    }
  }

  // -- Blocked claims -------------------------------------------------------
  const blockedClaims = new Set(summary.unsafeOrUnsupportedClaimsBlocked.map(b => b.claim));
  for (const claim of evalCase.expectedFlags.expectedBlockedClaims ?? []) {
    if (!blockedClaims.has(claim)) {
      failures.push({
        category: "blocked_claim",
        code: "BLOCKED_CLAIM_MISSING",
        message: `expected blocked claim "${claim}" was not emitted`,
        expected: claim,
        actual: Array.from(blockedClaims),
      });
    }
  }

  // -- Finding codes --------------------------------------------------------
  const findingCodes = new Set(summary.abnormalFindings.map(f => f.code));
  for (const code of evalCase.expectedFlags.expectedFindingCodes ?? []) {
    if (!findingCodes.has(code)) {
      failures.push({
        category: "finding_code",
        code: "FINDING_CODE_MISSING",
        message: `expected finding code "${code}" was not emitted`,
        expected: code,
        actual: Array.from(findingCodes),
      });
    }
  }
  for (const code of evalCase.expectedFlags.forbiddenFindingCodes ?? []) {
    if (findingCodes.has(code)) {
      failures.push({
        category: "finding_code",
        code: "FINDING_CODE_FORBIDDEN",
        message: `forbidden finding code "${code}" was emitted`,
        expected: `NOT ${code}`,
        actual: code,
      });
    }
  }

  // -- Unsafe overclaims (CRITICAL safety invariant) -----------------------
  // Definition: any present phenotype flag whose required source fields are
  // all null in the actual AnsStudy. The engine should NEVER emit one.
  let unsafeOverclaims = 0;
  for (const flag of summary.phenotypeFlags) {
    if (!flag.present || flag.id === "insufficient_data") continue;
    const allMissing = flag.sourceFields.length > 0
      && flag.sourceFields.every(p => fieldValue(study, p) == null);
    if (allMissing) {
      unsafeOverclaims += 1;
      failures.push({
        category: "unsafe_overclaim",
        code: "UNSAFE_OVERCLAIM",
        message: `phenotype "${flag.id}" emitted as present despite all source fields being null`,
        actual: flag.sourceFields,
      });
    }
  }

  // -- Per-case metrics -----------------------------------------------------
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const metrics: EvalMetrics = {
    demographicsAccuracy: {
      correct: demoCorrect,
      total: demoTotal,
      ratio: demoTotal === 0 ? 1 : demoCorrect / demoTotal,
    },
    numericAccuracy: {
      correct: numCorrect,
      total: numTotal,
      ratio: numTotal === 0 ? 1 : numCorrect / numTotal,
    },
    missingDetection: {
      correct: missingCorrect,
      total: missingTotal,
      ratio: missingTotal === 0 ? 1 : missingCorrect / missingTotal,
    },
    abnormalityFlags: {
      truePositive: tp,
      falsePositive: fp,
      falseNegative: fn,
      precision,
      recall,
      f1,
    },
    scoreAgreement: {
      cardiovagalMad,
      adrenergicMad,
      totalSeverityMad,
    },
    unsafeOverclaimCount: unsafeOverclaims,
  };

  return {
    caseId: evalCase.id,
    scenario: evalCase.scenario,
    passed: failures.length === 0,
    failures,
    metrics,
    durationMs,
  };
}

function compareDomain(
  domain: "cardiovagal" | "adrenergic" | "sudomotor",
  expected: ExpectedDomainScore | undefined,
  actual: DiagnosticSummary["cardiovagalScore"],
  failures: EvalFailure[],
): number | null {
  if (!expected) return null;
  if (expected.assessable !== actual.assessable) {
    failures.push({
      category: "domain_score",
      code: `${domain.toUpperCase()}_ASSESSABILITY_MISMATCH`,
      message: `${domain}.assessable expected ${expected.assessable}, got ${actual.assessable}`,
      expected: expected.assessable,
      actual: actual.assessable,
      path: `${domain}Score.assessable`,
    });
    return null;
  }
  if (expected.severity && actual.severity !== expected.severity) {
    failures.push({
      category: "domain_score",
      code: `${domain.toUpperCase()}_SEVERITY_MISMATCH`,
      message: `${domain}.severity expected ${expected.severity}, got ${actual.severity}`,
      expected: expected.severity,
      actual: actual.severity,
      path: `${domain}Score.severity`,
    });
  }
  if (expected.minConfidence) {
    if (CONFIDENCE_RANK[actual.confidence] < CONFIDENCE_RANK[expected.minConfidence]) {
      failures.push({
        category: "domain_score",
        code: `${domain.toUpperCase()}_CONFIDENCE_TOO_LOW`,
        message: `${domain}.confidence expected ≥ ${expected.minConfidence}, got ${actual.confidence}`,
        expected: expected.minConfidence,
        actual: actual.confidence,
        path: `${domain}Score.confidence`,
      });
    }
  }
  if (expected.expectedValue != null && actual.value != null) {
    const tol = expected.valueTolerance ?? 0;
    const diff = Math.abs(actual.value - expected.expectedValue);
    if (diff > tol) {
      failures.push({
        category: "domain_score",
        code: `${domain.toUpperCase()}_VALUE_MISMATCH`,
        message: `${domain}.value ${actual.value} ≠ ${expected.expectedValue} (±${tol})`,
        expected: expected.expectedValue,
        actual: actual.value,
        path: `${domain}Score.value`,
      });
    }
    return diff;
  }
  return null;
}
