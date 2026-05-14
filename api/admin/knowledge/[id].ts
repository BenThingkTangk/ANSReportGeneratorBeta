import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";

/**
 * GET    /api/admin/knowledge/:id — get single source + chunk summary
 * PUT    /api/admin/knowledge/:id — update source
 * DELETE /api/admin/knowledge/:id — delete (super_admin only)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);
  const id = req.query.id as string;

  if (!id) return res.status(400).json({ success: false, error: "id is required" });

  try {
    if (req.method === "GET") {
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);

      const { data, error } = await supabase
        .from("ans_knowledge_sources")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, error: "Not found" });
      }

      // chunk summary
      const { count: chunkCount } = await supabase
        .from("ans_knowledge_chunks")
        .select("id", { count: "exact", head: true })
        .eq("source_id", id);

      return res.status(200).json({
        success: true,
        data: { ...data, chunkCount: chunkCount ?? 0 },
      });
    }

    if (req.method === "PUT") {
      const user = await requireRole(req, [
        "super_admin",
        "clinical_admin",
        "reviewer",
      ]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      // Fetch existing for audit
      const { data: existing, error: fetchErr } = await supabase
        .from("ans_knowledge_sources")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ success: false, error: "Not found" });
      }

      // Only super_admin/clinical_admin can toggle active_in_ai_analysis
      const allowedToToggleAI = ["super_admin", "clinical_admin"].includes(user.role);

      const updatePayload: Record<string, unknown> = {
        last_updated_by: user.id,
      };

      const allowedFields = [
        "title",
        "authors",
        "year",
        "publication_type",
        "journal",
        "publisher",
        "doi",
        "pubmed_id",
        "url",
        "abstract",
        "key_claims",
        "diagnostic_relevance",
        "ans_metrics",
        "tags",
        "used_in",
        "active_in_report_citations",
        "active_in_admin_review",
        "review_status",
        "file_path",
        "file_mime",
        "file_size_bytes",
      ];

      for (const field of allowedFields) {
        if (field in body) updatePayload[field] = body[field];
      }

      if (allowedToToggleAI && "active_in_ai_analysis" in body) {
        updatePayload["active_in_ai_analysis"] = body.active_in_ai_analysis;
      }

      const { data, error } = await supabase
        .from("ans_knowledge_sources")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "update",
        "ans_knowledge_sources",
        id,
        existing as Record<string, unknown>,
        data as Record<string, unknown>,
        req
      );

      return res.status(200).json({ success: true, data });
    }

    if (req.method === "DELETE") {
      const user = await requireRole(req, ["super_admin"]);

      const { data: existing } = await supabase
        .from("ans_knowledge_sources")
        .select("*")
        .eq("id", id)
        .single();

      const { error } = await supabase
        .from("ans_knowledge_sources")
        .delete()
        .eq("id", id);

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "delete",
        "ans_knowledge_sources",
        id,
        existing as Record<string, unknown>,
        null,
        req
      );

      return res.status(200).json({ success: true, deleted: id });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
