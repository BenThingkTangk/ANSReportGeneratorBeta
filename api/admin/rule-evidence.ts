import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
  createSupabaseFromRequest,
} from "../_supabase.js";
import { clearEvidenceCache } from "../_evidenceRetrieval.js";

/**
 * /api/admin/rule-evidence
 *
 * GET   ?rule_type=&rule_key=  — list mappings (optionally filtered)
 * POST  { rule_type, rule_key, source_id, evidence_quote?, page_ref?, notes? }
 *         — create a new rule->source mapping
 * DELETE ?id=                  — remove a mapping
 *
 * Roles: super_admin & clinical_admin for write, +reviewer for read.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);

  try {
    if (req.method === "GET") {
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
      const { rule_type, rule_key } = req.query as Record<string, string>;

      let q = createSupabaseAdmin()
        .from("ans_rule_evidence_links")
        .select(
          `id, rule_type, rule_key, evidence_quote, page_ref, notes, created_at, updated_at,
           source:ans_knowledge_sources!inner (
             id, title, authors, year, publication_type, url, file_path,
             active_in_ai_analysis, review_status
           )`
        )
        .order("created_at", { ascending: false });

      if (rule_type) q = q.eq("rule_type", rule_type);
      if (rule_key) q = q.eq("rule_key", rule_key);

      const { data, error } = await q;
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });
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

      const admin = createSupabaseAdmin();
      // Validate the source exists and is approved+active before linking.
      const { data: src, error: srcErr } = await admin
        .from("ans_knowledge_sources")
        .select("id, active_in_ai_analysis, review_status")
        .eq("id", source_id)
        .single();
      if (srcErr || !src) {
        return res.status(404).json({ success: false, error: "source not found" });
      }
      if (!src.active_in_ai_analysis || src.review_status !== "approved") {
        return res.status(400).json({
          success: false,
          error:
            "source must be active_in_ai_analysis=true AND review_status='approved' before linking",
        });
      }

      const { data, error } = await admin
        .from("ans_rule_evidence_links")
        .insert({
          rule_type,
          rule_key,
          source_id,
          evidence_quote: body.evidence_quote ?? null,
          page_ref: body.page_ref ?? null,
          notes: body.notes ?? null,
          added_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          return res
            .status(409)
            .json({ success: false, error: "mapping already exists" });
        }
        throw Object.assign(new Error(error.message), { statusCode: 400 });
      }

      await logAudit(
        supabase,
        "rule_evidence.create",
        "ans_rule_evidence_links",
        data.id,
        null,
        { rule_type, rule_key, source_id },
        req
      );
      clearEvidenceCache();
      return res.status(201).json({ success: true, data });
    }

    if (req.method === "DELETE") {
      await requireRole(req, ["super_admin"]);
      const id = (req.query.id as string) || "";
      if (!id) {
        return res.status(400).json({ success: false, error: "id required" });
      }
      const admin = createSupabaseAdmin();
      const { data: existing } = await admin
        .from("ans_rule_evidence_links")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const { error } = await admin
        .from("ans_rule_evidence_links")
        .delete()
        .eq("id", id);
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });
      await logAudit(
        supabase,
        "rule_evidence.delete",
        "ans_rule_evidence_links",
        id,
        existing ?? null,
        null,
        req
      );
      clearEvidenceCache();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: "method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
