import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseStudy } from "../_ans/parseStudy.js";
import { computeDiagnosticSummary } from "../_ans/scoring/index.js";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import type { EvalCase } from "../../shared/evalTypes.js";

/**
 * GET /api/admin/eval-cases               → list all eval fixtures (lightweight)
 * GET /api/admin/eval-cases?id=<caseId>   → full fixture + parsed AnsStudy + DiagnosticSummary
 *
 * Reads from the local-first fixture store at `eval/fixtures/`. Restricted to
 * clinical_admin and super_admin so clinicians can review the gold cases that
 * gate every deploy.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }
  try {
    await requireRole(req, ["super_admin", "clinical_admin"]);
    const fixturesDir = path.resolve(process.cwd(), "eval", "fixtures");
    const files = (await fs.readdir(fixturesDir)).filter(f => f.endsWith(".json")).sort();

    const { id } = req.query as { id?: string };
    if (id) {
      const target = files.find(f => f === `${id}.json`);
      if (!target) {
        return res.status(404).json({ success: false, error: `Fixture ${id} not found` });
      }
      const raw = await fs.readFile(path.join(fixturesDir, target), "utf8");
      const evalCase = JSON.parse(raw) as EvalCase;
      let parsedStudy: unknown = null;
      let diagnosticSummary: unknown = null;
      let parserError: string | null = null;
      try {
        const buf = Buffer.from(evalCase.ansBase64, "base64");
        const study = parseStudy({ buffer: buf, fileName: evalCase.fileName });
        parsedStudy = study;
        diagnosticSummary = computeDiagnosticSummary(study);
      } catch (e) {
        parserError = e instanceof Error ? e.message : String(e);
      }
      return res.json({
        success: true,
        data: { evalCase, parsedStudy, diagnosticSummary, parserError },
      });
    }

    // List mode — strip ansBase64 to keep payload small
    const cases: Array<Omit<EvalCase, "ansBase64">> = [];
    for (const file of files) {
      const raw = await fs.readFile(path.join(fixturesDir, file), "utf8");
      const c = JSON.parse(raw) as EvalCase;
      const { ansBase64, ...lite } = c;
      void ansBase64;
      cases.push(lite);
    }
    return res.json({ success: true, data: cases, meta: { total: cases.length } });
  } catch (err) {
    return handleError(res, err);
  }
}
