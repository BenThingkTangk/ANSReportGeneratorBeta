import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseStudy } from "../_ans/parseStudy.js";
import { computeDiagnosticSummary } from "../_ans/scoring/index.js";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { compareCase } from "../../eval/runner/compareCase.js";
import type {
  EvalCase,
  EvalCaseResult,
  EvalRunSummary,
} from "../../shared/evalTypes.js";

/**
 * POST /api/admin/eval-run
 *
 * Trigger an ad-hoc eval run against the local fixtures and return the
 * summary. Useful for the admin Accuracy Lab UI to refresh after a
 * correction promotion.
 *
 * Optional body: { caseId?: string } — run a single fixture.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  try {
    await requireRole(req, ["super_admin", "clinical_admin"]);
    const { caseId } = (req.body ?? {}) as { caseId?: string };

    const fixturesDir = path.resolve(process.cwd(), "eval", "fixtures");
    const files = (await fs.readdir(fixturesDir))
      .filter(f => f.endsWith(".json"))
      .sort();

    const startedAt = new Date().toISOString();
    const results: EvalCaseResult[] = [];
    for (const file of files) {
      const raw = await fs.readFile(path.join(fixturesDir, file), "utf8");
      const evalCase = JSON.parse(raw) as EvalCase;
      if (caseId && evalCase.id !== caseId) continue;
      const t0 = performance.now();
      try {
        const buf = Buffer.from(evalCase.ansBase64, "base64");
        const study = parseStudy({ buffer: buf, fileName: evalCase.fileName });
        const summary = computeDiagnosticSummary(study);
        results.push(
          compareCase({ evalCase, study, summary, durationMs: performance.now() - t0 }),
        );
      } catch (e) {
        results.push({
          caseId: evalCase.id,
          scenario: evalCase.scenario,
          passed: false,
          durationMs: performance.now() - t0,
          failures: [
            {
              category: "parser_error",
              code: "PARSER_THREW",
              message: e instanceof Error ? e.message : String(e),
            },
          ],
          metrics: {
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
            scoreAgreement: {
              cardiovagalMad: null,
              adrenergicMad: null,
              totalSeverityMad: null,
            },
            unsafeOverclaimCount: 0,
          },
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const passedCases = results.filter(r => r.passed).length;
    const summary: EvalRunSummary = {
      runId: randomUUID(),
      startedAt,
      finishedAt,
      parserVersion: "ans-parser@1.0.0",
      scoringVersion: "ans-scoring@1.0.0",
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      metrics: aggregateMetrics(results),
      caseResults: results,
    };

    return res.json({ success: true, data: summary });
  } catch (err) {
    return handleError(res, err);
  }
}

function aggregateMetrics(results: EvalCaseResult[]): EvalRunSummary["metrics"] {
  let demoC = 0, demoT = 0, numC = 0, numT = 0, misC = 0, misT = 0;
  let tp = 0, fp = 0, fn = 0, unsafe = 0;
  for (const r of results) {
    const m = r.metrics;
    demoC += m.demographicsAccuracy.correct; demoT += m.demographicsAccuracy.total;
    numC += m.numericAccuracy.correct; numT += m.numericAccuracy.total;
    misC += m.missingDetection.correct; misT += m.missingDetection.total;
    tp += m.abnormalityFlags.truePositive;
    fp += m.abnormalityFlags.falsePositive;
    fn += m.abnormalityFlags.falseNegative;
    unsafe += m.unsafeOverclaimCount;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    demographicsAccuracy: { correct: demoC, total: demoT, ratio: demoT === 0 ? 1 : demoC / demoT },
    numericAccuracy: { correct: numC, total: numT, ratio: numT === 0 ? 1 : numC / numT },
    missingDetection: { correct: misC, total: misT, ratio: misT === 0 ? 1 : misC / misT },
    abnormalityFlags: { truePositive: tp, falsePositive: fp, falseNegative: fn, precision, recall, f1 },
    scoreAgreement: { cardiovagalMad: null, adrenergicMad: null, totalSeverityMad: null },
    unsafeOverclaimCount: unsafe,
  };
}
