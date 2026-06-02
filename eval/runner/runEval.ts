#!/usr/bin/env tsx
/**
 * ANS Accuracy Lab — CLI eval runner.
 *
 *   npm run eval                   # run all fixtures, print human report
 *   npm run eval -- --filter ID    # run a single fixture
 *   npm run eval:ci                # CI mode (less output, hard exit on gate fail)
 *
 * Local-first: reads JSON fixtures from `eval/fixtures/*.json`, parses each
 * .ans buffer with the production parser, scores with the production scorer,
 * and compares with `compareCase`. Writes per-run JSON to `eval/runs/` and
 * appends a one-liner to `eval/runs/history.jsonl`.
 *
 * Exit codes:
 *   0  all gates passed
 *   1  at least one regression gate violated
 *   2  runner exception (fixture missing, parse crash, etc.)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { parseStudy } from "../../api/_ans/parseStudy";
import { computeDiagnosticSummary } from "../../api/_ans/scoring/index";
import {
  DEFAULT_REGRESSION_GATE,
  type EvalCase,
  type EvalCaseResult,
  type EvalMetrics,
  type EvalRunSummary,
  type RegressionGate,
} from "../../shared/evalTypes";
import { compareCase } from "./compareCase";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "eval", "fixtures");
const RUNS_DIR = path.join(REPO_ROOT, "eval", "runs");
const GATE_PATH = path.join(REPO_ROOT, "eval", "regression-gate.json");

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------

interface CliArgs {
  filter?: string;
  ci: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { ci: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--filter") {
      out.filter = argv[i + 1];
      i += 1;
    } else if (a === "--ci") {
      out.ci = true;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        `ANS Accuracy Lab eval runner\n\nUsage:\n  tsx eval/runner/runEval.ts [--filter <caseId>] [--ci] [--json]\n`,
      );
      process.exit(0);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Fixture I/O
// ----------------------------------------------------------------------------

async function loadFixtures(filter?: string): Promise<EvalCase[]> {
  const entries = await fs.readdir(FIXTURES_DIR);
  const jsonFiles = entries.filter(f => f.endsWith(".json")).sort();
  const cases: EvalCase[] = [];
  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, file), "utf8");
    const parsed = JSON.parse(raw) as EvalCase;
    if (filter && parsed.id !== filter) continue;
    cases.push(parsed);
  }
  if (filter && cases.length === 0) {
    throw new Error(`No fixture matched --filter ${filter}`);
  }
  return cases;
}

async function loadGate(): Promise<RegressionGate> {
  try {
    const raw = await fs.readFile(GATE_PATH, "utf8");
    return { ...DEFAULT_REGRESSION_GATE, ...(JSON.parse(raw) as Partial<RegressionGate>) };
  } catch {
    return DEFAULT_REGRESSION_GATE;
  }
}

// ----------------------------------------------------------------------------
// Per-case execution
// ----------------------------------------------------------------------------

function runOneCase(c: EvalCase): EvalCaseResult {
  const t0 = performance.now();
  let parserError: string | undefined;
  try {
    const buffer = Buffer.from(c.ansBase64, "base64");
    const study = parseStudy({ buffer, fileName: c.fileName });
    const summary = computeDiagnosticSummary(study);
    return compareCase({
      evalCase: c,
      study,
      summary,
      durationMs: performance.now() - t0,
    });
  } catch (err) {
    parserError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // Build a minimal failed result without a study/summary.
    return {
      caseId: c.id,
      scenario: c.scenario,
      passed: false,
      durationMs: performance.now() - t0,
      failures: [
        {
          category: "parser_error",
          code: "PARSER_THREW",
          message: parserError,
        },
      ],
      metrics: emptyMetrics(),
    };
  }
}

function emptyMetrics(): EvalMetrics {
  return {
    demographicsAccuracy: { correct: 0, total: 0, ratio: 0 },
    numericAccuracy: { correct: 0, total: 0, ratio: 0 },
    missingDetection: { correct: 0, total: 0, ratio: 0 },
    abnormalityFlags: {
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      precision: 0,
      recall: 0,
      f1: 0,
    },
    scoreAgreement: { cardiovagalMad: null, adrenergicMad: null, totalSeverityMad: null },
    unsafeOverclaimCount: 0,
  };
}

// ----------------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------------

function aggregate(results: EvalCaseResult[]): EvalMetrics {
  let demoC = 0, demoT = 0;
  let numC = 0, numT = 0;
  let misC = 0, misT = 0;
  let tp = 0, fp = 0, fn = 0;
  let cvMadSum = 0, cvMadCount = 0;
  let adMadSum = 0, adMadCount = 0;
  let tsMadSum = 0, tsMadCount = 0;
  let unsafe = 0;
  for (const r of results) {
    const m = r.metrics;
    demoC += m.demographicsAccuracy.correct;
    demoT += m.demographicsAccuracy.total;
    numC += m.numericAccuracy.correct;
    numT += m.numericAccuracy.total;
    misC += m.missingDetection.correct;
    misT += m.missingDetection.total;
    tp += m.abnormalityFlags.truePositive;
    fp += m.abnormalityFlags.falsePositive;
    fn += m.abnormalityFlags.falseNegative;
    if (m.scoreAgreement.cardiovagalMad != null) {
      cvMadSum += m.scoreAgreement.cardiovagalMad;
      cvMadCount += 1;
    }
    if (m.scoreAgreement.adrenergicMad != null) {
      adMadSum += m.scoreAgreement.adrenergicMad;
      adMadCount += 1;
    }
    if (m.scoreAgreement.totalSeverityMad != null) {
      tsMadSum += m.scoreAgreement.totalSeverityMad;
      tsMadCount += 1;
    }
    unsafe += m.unsafeOverclaimCount;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    demographicsAccuracy: {
      correct: demoC,
      total: demoT,
      ratio: demoT === 0 ? 1 : demoC / demoT,
    },
    numericAccuracy: {
      correct: numC,
      total: numT,
      ratio: numT === 0 ? 1 : numC / numT,
    },
    missingDetection: {
      correct: misC,
      total: misT,
      ratio: misT === 0 ? 1 : misC / misT,
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
      cardiovagalMad: cvMadCount === 0 ? null : cvMadSum / cvMadCount,
      adrenergicMad: adMadCount === 0 ? null : adMadSum / adMadCount,
      totalSeverityMad: tsMadCount === 0 ? null : tsMadSum / tsMadCount,
    },
    unsafeOverclaimCount: unsafe,
  };
}

// ----------------------------------------------------------------------------
// Gate evaluation
// ----------------------------------------------------------------------------

interface GateResult {
  passed: boolean;
  violations: string[];
}

function evaluateGate(
  metrics: EvalMetrics,
  results: EvalCaseResult[],
  gate: RegressionGate,
): GateResult {
  const violations: string[] = [];
  const passRate = results.length === 0 ? 1 : results.filter(r => r.passed).length / results.length;
  if (passRate < gate.minPassRate) {
    violations.push(`pass rate ${(passRate * 100).toFixed(1)}% < ${(gate.minPassRate * 100).toFixed(1)}%`);
  }
  if (metrics.demographicsAccuracy.ratio < gate.minDemographicsAccuracy) {
    violations.push(
      `demographics accuracy ${(metrics.demographicsAccuracy.ratio * 100).toFixed(1)}% < ${(gate.minDemographicsAccuracy * 100).toFixed(1)}%`,
    );
  }
  if (metrics.numericAccuracy.ratio < gate.minNumericAccuracy) {
    violations.push(
      `numeric accuracy ${(metrics.numericAccuracy.ratio * 100).toFixed(1)}% < ${(gate.minNumericAccuracy * 100).toFixed(1)}%`,
    );
  }
  if (metrics.missingDetection.ratio < gate.minMissingDetection) {
    violations.push(
      `missing detection ${(metrics.missingDetection.ratio * 100).toFixed(1)}% < ${(gate.minMissingDetection * 100).toFixed(1)}%`,
    );
  }
  if (metrics.abnormalityFlags.f1 < gate.minFlagF1) {
    violations.push(
      `flag F1 ${metrics.abnormalityFlags.f1.toFixed(3)} < ${gate.minFlagF1.toFixed(3)}`,
    );
  }
  if (metrics.unsafeOverclaimCount > gate.maxUnsafeOverclaims) {
    violations.push(
      `unsafe overclaims ${metrics.unsafeOverclaimCount} > max ${gate.maxUnsafeOverclaims}`,
    );
  }
  return { passed: violations.length === 0, violations };
}

// ----------------------------------------------------------------------------
// Reporting
// ----------------------------------------------------------------------------

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function color(use: boolean, name: keyof typeof COLORS, text: string): string {
  return use ? `${COLORS[name]}${text}${COLORS.reset}` : text;
}

function printReport(
  results: EvalCaseResult[],
  metrics: EvalMetrics,
  gate: GateResult,
  args: CliArgs,
): void {
  const useColor = !args.ci && process.stdout.isTTY;

  // eslint-disable-next-line no-console
  console.log(`\n${color(useColor, "bold", "ANS Accuracy Lab — eval results")}\n`);

  for (const r of results) {
    const mark = r.passed ? color(useColor, "green", "✓") : color(useColor, "red", "✗");
    const scenario = color(useColor, "dim", `[${r.scenario}]`);
    // eslint-disable-next-line no-console
    console.log(`  ${mark} ${r.caseId} ${scenario} (${r.durationMs.toFixed(0)}ms)`);
    if (!r.passed) {
      for (const f of r.failures) {
        const tag = color(useColor, "yellow", `[${f.category}/${f.code}]`);
        // eslint-disable-next-line no-console
        console.log(`      ${tag} ${f.message}`);
      }
    }
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  // eslint-disable-next-line no-console
  console.log(`\n${color(useColor, "bold", "Summary")}`);
  // eslint-disable-next-line no-console
  console.log(`  Cases:                ${passed}/${total} passed`);
  // eslint-disable-next-line no-console
  console.log(`  Demographics:         ${(metrics.demographicsAccuracy.ratio * 100).toFixed(1)}%  (${metrics.demographicsAccuracy.correct}/${metrics.demographicsAccuracy.total})`);
  // eslint-disable-next-line no-console
  console.log(`  Numeric:              ${(metrics.numericAccuracy.ratio * 100).toFixed(1)}%  (${metrics.numericAccuracy.correct}/${metrics.numericAccuracy.total})`);
  // eslint-disable-next-line no-console
  console.log(`  Missing detection:    ${(metrics.missingDetection.ratio * 100).toFixed(1)}%  (${metrics.missingDetection.correct}/${metrics.missingDetection.total})`);
  // eslint-disable-next-line no-console
  console.log(`  Flag P/R/F1:          ${metrics.abnormalityFlags.precision.toFixed(3)} / ${metrics.abnormalityFlags.recall.toFixed(3)} / ${metrics.abnormalityFlags.f1.toFixed(3)}`);
  // eslint-disable-next-line no-console
  console.log(`  Unsafe overclaims:    ${metrics.unsafeOverclaimCount}`);

  if (gate.passed) {
    // eslint-disable-next-line no-console
    console.log(`\n${color(useColor, "green", "✓ Regression gate PASSED")}\n`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${color(useColor, "red", "✗ Regression gate FAILED")}`);
    for (const v of gate.violations) {
      // eslint-disable-next-line no-console
      console.log(`    - ${v}`);
    }
    // eslint-disable-next-line no-console
    console.log("");
  }
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

async function writeRunArtifacts(summary: EvalRunSummary): Promise<string> {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${summary.runId}.json`);
  await fs.writeFile(file, JSON.stringify(summary, null, 2));
  const historyLine = JSON.stringify({
    runId: summary.runId,
    finishedAt: summary.finishedAt,
    totalCases: summary.totalCases,
    passedCases: summary.passedCases,
    failedCases: summary.failedCases,
    unsafeOverclaimCount: summary.metrics.unsafeOverclaimCount,
    flagF1: summary.metrics.abnormalityFlags.f1,
  }) + "\n";
  await fs.appendFile(path.join(RUNS_DIR, "history.jsonl"), historyLine);
  return file;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const cases = await loadFixtures(args.filter);
  const gate = await loadGate();

  const results = cases.map(runOneCase);
  const metrics = aggregate(results);
  const gateResult = evaluateGate(metrics, results, gate);
  const finishedAt = new Date().toISOString();

  const summary: EvalRunSummary = {
    runId: randomUUID(),
    startedAt,
    finishedAt,
    parserVersion: "ans-parser@1.0.0",
    scoringVersion: "ans-scoring@1.0.0",
    gitSha: process.env.GITHUB_SHA ?? process.env.GIT_SHA,
    totalCases: results.length,
    passedCases: results.filter(r => r.passed).length,
    failedCases: results.filter(r => !r.passed).length,
    metrics,
    caseResults: results,
  };

  const artifactPath = await writeRunArtifacts(summary);

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(results, metrics, gateResult, args);
    // eslint-disable-next-line no-console
    console.log(`  Run artifact: ${path.relative(REPO_ROOT, artifactPath)}\n`);
  }

  return gateResult.passed ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error("[eval] runner crashed:", err);
    process.exit(2);
  });
