import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import {
  ragQuery,
  logRagAudit,
  ragBackendError,
} from "../_ragDb.js";
import { invalidateKnowledgeCaches } from "../_knowledgeInvalidate.js";

/**
 * /api/admin/rule-evidence
 *
 * GET   ?rule_type=&rule_key=  — list mappings (optionally filtered)
 * POST  { rule_type, rule_key, source_id, evidence_quote?, page_ref?, notes? }
 *         — create a new rule->source mapping
 * DELETE ?id=                  — remove a mapping
 *
 * Backed by Akamai Managed PostgreSQL (humanos-ans-rag-pg) via ../_ragDb — the
 * SAME authoritative store the AI evidence retriever reads — NOT Supabase, so a
 * newly-created/removed link is reflected in report grounding (after the caches
 * are invalidated) with no split-brain. Auth is enforced FIRST via the admin
 * gateway session. Every statement is parameterized.
 *
 * Roles: super_admin & clinical_admin for write, +reviewer for read.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
      const { rule_type, rule_key } = req.query as Record<string, string>;

      // Nest the source object in-SQL (json_build_object → parsed by pg) so the
      // response shape exactly matches what the admin page consumes.
      const conds: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (rule_type) {
        conds.push(`l.rule_type = $${i++}`);
        params.push(rule_type);
      }
      if (rule_key) {
        conds.push(`l.rule_key = $${i++}`);
        params.push(rule_key);
      }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      let data: Array<Record<string, unknown>>;
      try {
        const result = await ragQuery(
          `SELECT l.id, l.rule_type, l.rule_key, l.evidence_quote, l.page_ref,
                  l.notes, l.created_at, l.updated_at,
                  json_build_object(
                    'id', s.id,
                    'title', s.title,
                    'authors', s.authors,
                    'year', s.year,
                    'publication_type', s.publication_type,
                    'url', s.url,
                    'file_path', s.file_path,
                    'active_in_ai_analysis', s.active_in_ai_analysis,
                    'review_status', s.review_status
                  ) AS source
             FROM public.ans_rule_evidence_links l
             JOIN public.ans_knowledge_sources s ON s.id = l.source_id
             ${where}
            ORDER BY l.created_at DESC`,
          params
        );
        data = result.rows;
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      return res.status(200).json({ success: true, data });
    }

    if (req.method === "POST") {
      const user = await requireRole(req, ["super_admin", "clinical_admin"]);
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { rule_type, rule_key, source_id } = body ?? {};
      if (!rule_type || !rule_key || !source_id) {
        return res
          .status(400)
          .json({ success: false, error: "rule_type, rule_key, source_id required" });
      }
      if (!["finding", "phenotype", "domain"].includes(rule_type)) {
        return res
          .status(400)
          .json({ success: false, error: "rule_type must be finding|phenotype|domain" });
      }
      // A non-uuid source_id can never match a row; treat as not found (never a
      // 500 from an invalid-uuid cast).
      if (!UUID_RE.test(String(source_id))) {
        return res.status(404).json({ success: false, error: "source not found" });
      }

      let created: Record<string, unknown>;
      try {
        // Validate the source exists and is approved+active before linking.
        const srcRes = await ragQuery<{
          id: string;
          active_in_ai_analysis: boolean;
          review_status: string;
        }>(
          `SELECT id, active_in_ai_analysis, review_status
             FROM public.ans_knowledge_sources WHERE id = $1`,
          [source_id]
        );
        const src = srcRes.rows[0];
        if (!src) {
          return res.status(404).json({ success: false, error: "source not found" });
        }
        if (!src.active_in_ai_analysis || src.review_status !== "approved") {
          return res.status(400).json({
            success: false,
            error:
              "source must be active_in_ai_analysis=true AND review_status='approved' before linking",
          });
        }

        const insRes = await ragQuery(
          `INSERT INTO public.ans_rule_evidence_links
             (rule_type, rule_key, source_id, evidence_quote, page_ref, notes, added_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, rule_type, rule_key, source_id, evidence_quote, page_ref,
                     notes, created_at, updated_at`,
          [
            rule_type,
            rule_key,
            source_id,
            body.evidence_quote ?? null,
            body.page_ref ?? null,
            body.notes ?? null,
            user.id,
          ]
        );
        created = insRes.rows[0] as Record<string, unknown>;
      } catch (dbErr) {
        // Unique-violation → the mapping already exists (409, not a raw 400).
        if ((dbErr as { code?: string })?.code === "23505") {
          return res
            .status(409)
            .json({ success: false, error: "mapping already exists" });
        }
        throw ragBackendError(dbErr);
      }

      await logRagAudit(
        "rule_evidence.create",
        "ans_rule_evidence_links",
        created.id as string,
        null,
        { rule_type, rule_key, source_id },
        { id: user.id, email: user.email },
        req
      );
      invalidateKnowledgeCaches();
      return res.status(201).json({ success: true, data: created });
    }

    if (req.method === "DELETE") {
      const user = await requireRole(req, ["super_admin"]);
      const id = (req.query.id as string) || "";
      if (!id) {
        return res.status(400).json({ success: false, error: "id required" });
      }
      if (!UUID_RE.test(id)) {
        return res.status(404).json({ success: false, error: "not found" });
      }

      let existing: Record<string, unknown> | null;
      try {
        const cur = await ragQuery(
          `SELECT id, rule_type, rule_key, source_id, evidence_quote, page_ref,
                  notes, created_at, updated_at
             FROM public.ans_rule_evidence_links WHERE id = $1`,
          [id]
        );
        existing = (cur.rows[0] as Record<string, unknown>) ?? null;
        await ragQuery(
          "DELETE FROM public.ans_rule_evidence_links WHERE id = $1",
          [id]
        );
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }

      await logRagAudit(
        "rule_evidence.delete",
        "ans_rule_evidence_links",
        id,
        existing,
        null,
        { id: user.id, email: user.email },
        req
      );
      invalidateKnowledgeCaches();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: "method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
