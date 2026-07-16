import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthUser, setCorsHeaders, handleError } from "./_supabase.js";
import { ragQuery } from "./_ragDb.js";
import { parseStudy } from "./_ans/parseStudy.js";
import { computeDiagnosticSummary } from "./_ans/scoring/index.js";
import { buildExplainedReport } from "./_buildExplanations.js";
import type { DiagnosticSummary } from "../shared/diagnosticSummary.js";

/**
 * POST /api/explanations
 *
 * Two input modes:
 *   1. { summary: DiagnosticSummary }          — explain an already-computed summary
 *   2. { ansBase64: string, fileName: string } — parse + score + explain in one shot
 *
 * Optional body keys:
 *   - reportRef: free-form, NO PHI (used for audit only)
 *   - evidenceEnabledOverride: boolean (super-admin previews)
 *
 * Returns ExplainedReport. Public-safe response — never includes private file
 * bytes. Citations to private files surface only via the dedicated admin-gated
 * streaming endpoint (api/admin/source-file).
 *
 * Auth: requires an authenticated user (any role). Public landing pages that
 * need to preview an explanation should call this through an authenticated
 * session, not anonymously.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    let summary: DiagnosticSummary | undefined = body?.summary;

    if (!summary) {
      const ansB64: string | undefined = body?.ansBase64;
      const fileName: string | undefined = body?.fileName;
      if (!ansB64 || !fileName) {
        return res.status(400).json({
          success: false,
          error: "provide either `summary` or (`ansBase64` + `fileName`)",
        });
      }
      const buffer = Buffer.from(ansB64, "base64");
      const study = parseStudy({ buffer, fileName });
      summary = computeDiagnosticSummary(study);
    }

    const evidenceEnabledOverride =
      typeof body?.evidenceEnabledOverride === "boolean"
        ? body.evidenceEnabledOverride
        : undefined;

    const explained = await buildExplainedReport(summary, {
      evidenceEnabledOverride,
    });

    // Audit trail — no PHI. Tracks who generated explanations, which sources
    // were cited, and which rules fired. Written to the AUTHORITATIVE Akamai
    // PostgreSQL store (ans_report_explanations) via ../_ragDb — NOT Supabase —
    // so the append-only run log lives with the knowledge it references.
    try {
      const sourceIds = Array.from(
        new Set(
          explained.items.flatMap((it) => it.evidence.map((e) => e.sourceId))
        )
      );
      const ruleKeys = Array.from(
        new Set(explained.items.map((it) => `${it.rule.type}::${it.rule.key}`))
      );
      const numWithEvidence = explained.items.filter(
        (it) => it.mode === "evidence-backed"
      ).length;
      const numRuleBased = explained.items.filter(
        (it) => it.mode === "rule-based"
      ).length;

      await ragQuery(
        `INSERT INTO public.ans_report_explanations
           (report_ref, scoring_version, evidence_enabled, num_bullets,
            num_with_evidence, num_rule_based, source_ids, rule_keys, generated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::text[], $9)`,
        [
          body?.reportRef ?? null,
          explained.scoringVersion,
          explained.evidenceEnabled,
          explained.items.length,
          numWithEvidence,
          numRuleBased,
          sourceIds,
          ruleKeys,
          user.id,
        ]
      );
    } catch (e) {
      // Audit failure must not break the response.
      console.warn("[explanations] audit insert failed", (e as Error)?.message ?? "unknown");
    }

    return res.status(200).json({ success: true, data: explained });
  } catch (err) {
    return handleError(res, err);
  }
}
