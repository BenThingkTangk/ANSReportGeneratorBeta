import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";

/**
 * GET    /api/admin/change-requests/:id — get single change request
 * PUT    /api/admin/change-requests/:id — update status/notes
 * DELETE /api/admin/change-requests/:id — delete (super_admin only)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);
  const id = req.query.id as string;

  if (!id) return res.status(400).json({ success: false, error: "id is required" });

  try {
    if (req.method === "GET") {
      await requireRole(supabase, ["super_admin", "clinical_admin", "reviewer"]);

      const { data, error } = await supabase
        .from("app_change_requests")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return res.status(404).json({ success: false, error: "Not found" });

      // Fetch audit history for this entity
      const { data: auditHistory } = await supabase
        .from("audit_log")
        .select("actor_email, action, before, after, created_at")
        .eq("entity_type", "app_change_requests")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      return res
        .status(200)
        .json({ success: true, data, auditHistory: auditHistory ?? [] });
    }

    if (req.method === "PUT") {
      const user = await requireRole(supabase, [
        "super_admin",
        "clinical_admin",
        "reviewer",
      ]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { data: existing, error: fetchErr } = await supabase
        .from("app_change_requests")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ success: false, error: "Not found" });
      }

      const isAdmin = ["super_admin", "clinical_admin"].includes(user.role);
      const updatePayload: Record<string, unknown> = {};

      // Any authenticated reviewer can update their own request title/desc
      if ("title" in body) updatePayload.title = body.title;
      if ("description" in body) updatePayload.description = body.description;
      if ("suggested_fix" in body) updatePayload.suggested_fix = body.suggested_fix;
      if ("related_report_id" in body) updatePayload.related_report_id = body.related_report_id;

      // Admin-only fields
      if (isAdmin) {
        if ("status" in body) updatePayload.status = body.status;
        if ("admin_notes" in body) updatePayload.admin_notes = body.admin_notes;
        if ("priority" in body) updatePayload.priority = body.priority;
        if ("category" in body) updatePayload.category = body.category;
      }

      if (Object.keys(updatePayload).length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "No updatable fields provided" });
      }

      const { data, error } = await supabase
        .from("app_change_requests")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "update",
        "app_change_requests",
        id,
        existing as Record<string, unknown>,
        data as Record<string, unknown>,
        req
      );

      return res.status(200).json({ success: true, data });
    }

    if (req.method === "DELETE") {
      await requireRole(supabase, ["super_admin"]);

      const { data: existing } = await supabase
        .from("app_change_requests")
        .select("*")
        .eq("id", id)
        .single();

      const { error } = await supabase
        .from("app_change_requests")
        .delete()
        .eq("id", id);

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "delete",
        "app_change_requests",
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
