import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { parseStudy } from "../_ans/parseStudy.js";
import { computeDiagnosticSummary } from "../_ans/scoring/index.js";
import { PARSER_VERSION } from "../../shared/ansStudy.js";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { ragQuery } from "../_ragDb.js";

/**
 * GET /api/admin/parser-health
 *
 * One-call health board for the deterministic pipeline + AI model wiring:
 *   • parser: version + a live self-test (parse a fixture, time it, confirm
 *     phases/ratios come out) so an admin can see the engine is actually
 *     functioning, not just that the endpoint is up.
 *   • models: which AI integrations are CONFIGURED (env key present) vs not —
 *     never leaks the key, just a boolean + the voice id in use.
 *   • knowledge: source/chunk counts and how many are active+approved (i.e.
 *     actually reachable by retrieval).
 *   • evals: the last few regression-gate runs from eval/runs/history.jsonl.
 *
 * Read-only and role-gated. No PHI is returned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  try {
    await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

    // ---- Parser self-test -------------------------------------------------
    // Parse the first available fixture end-to-end and confirm the pipeline
    // yields structured output. Failures are captured, not thrown, so the
    // board still renders with a red parser card.
    const parser: any = { version: PARSER_VERSION, ok: false };
    try {
      const fixturesDir = path.resolve(process.cwd(), "eval", "fixtures");
      const files = (await fs.readdir(fixturesDir)).filter((f) => f.endsWith(".json")).sort();
      if (files.length === 0) {
        parser.detail = "no fixtures available for self-test";
      } else {
        const raw = await fs.readFile(path.join(fixturesDir, files[0]), "utf8");
        const evalCase = JSON.parse(raw);
        const buf = Buffer.from(evalCase.ansBase64, "base64");
        const t0 = performance.now();
        const study = parseStudy({ buffer: buf, fileName: evalCase.fileName });
        const summary = computeDiagnosticSummary(study);
        const ms = Number((performance.now() - t0).toFixed(1));
        parser.ok = true;
        parser.selfTest = {
          fixture: evalCase.id ?? files[0],
          parseMs: ms,
          phaseCount: Array.isArray((study as any).phases) ? (study as any).phases.length : null,
          hasDiagnosticSummary: !!summary,
          warnings: Array.isArray((study as any).warnings) ? (study as any).warnings.length : 0,
        };
      }
    } catch (e: any) {
      parser.ok = false;
      parser.detail = e?.message ?? "parser self-test failed";
    }

    // ---- Model / integration configuration --------------------------------
    const models = {
      askAtom: {
        provider: "perplexity-sonar-pro",
        configured: Boolean(process.env.PPLX_API_KEY),
      },
      synopsis: {
        provider: "perplexity-sonar-pro",
        configured: Boolean(process.env.PPLX_API_KEY),
      },
      tts: {
        provider: "elevenlabs",
        voiceId: "gs0tAILXbY5DNrJrsM6F",
        model: "eleven_turbo_v2_5",
        configured: Boolean(process.env.ELEVENLABS_API_KEY),
        browserFallback: true,
      },
    };

    // ---- Knowledge base reachability --------------------------------------
    // Counts come from the AUTHORITATIVE Akamai PostgreSQL store (the same store
    // the AI path retrieves from) in one round trip. count(*) returns text → Number().
    const knowledge: any = { ok: true };
    try {
      const { rows } = await ragQuery<{
        total_sources: string;
        active_approved: string;
        total_chunks: string;
      }>(
        `SELECT
           (SELECT count(*) FROM public.ans_knowledge_sources) AS total_sources,
           (SELECT count(*) FROM public.ans_knowledge_sources
              WHERE active_in_ai_analysis = true AND review_status = 'approved')
             AS active_approved,
           (SELECT count(*) FROM public.ans_knowledge_chunks) AS total_chunks`
      );
      knowledge.totalSources = Number(rows[0]?.total_sources ?? 0);
      knowledge.activeApprovedSources = Number(rows[0]?.active_approved ?? 0);
      knowledge.totalChunks = Number(rows[0]?.total_chunks ?? 0);
    } catch (e: any) {
      knowledge.ok = false;
      knowledge.detail = e?.message ?? "knowledge count failed";
    }

    // ---- Recent eval runs -------------------------------------------------
    const evals: any = { recent: [] };
    try {
      const histPath = path.resolve(process.cwd(), "eval", "runs", "history.jsonl");
      const raw = await fs.readFile(histPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      evals.recent = lines
        .slice(-5)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse();
      const last = evals.recent[0];
      evals.lastGatePassed = last ? last.failedCases === 0 && last.unsafeOverclaimCount === 0 : null;
    } catch {
      evals.detail = "no eval history available in this environment";
    }

    const healthy = parser.ok && knowledge.ok !== false;

    return res.status(200).json({
      success: true,
      healthy,
      generatedAt: new Date().toISOString(),
      parser,
      models,
      knowledge,
      evals,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
