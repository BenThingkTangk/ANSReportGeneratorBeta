import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";

/**
 * GET  /api/admin/change-requests — list with filters
 * POST /api/admin/change-requests — create a new change request
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);

  try {
    if (req.method === "GET") {
      await requireRole(supabase, ["super_admin", "clinical_admin", "reviewer"]);

      const {
        status,
        category,
        priority,
        submitted_by,
        page = "1",
        limit = "50",
      } = req.query as Record<string, string>;

      let query = supabase
        .from("app_change_requests")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (status) query = query.eq("status", status);
      if (category) query = query.eq("category", category);
      if (priority) query = query.eq("priority", priority);
      if (submitted_by) query = query.eq("submitted_by", submitted_by);

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const from = (pageNum - 1) * limitNum;
      query = query.range(from, from + limitNum - 1);

      const { data, error, count } = await query;
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      return res.status(200).json({
        success: true,
        data,
        meta: { total: count ?? 0, page: pageNum, limit: limitNum },
      });
    }

    if (req.method === "POST") {
      const user = await requireRole(supabase, [
        "super_admin",
        "clinical_admin",
        "reviewer",
      ]);
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      if (!body?.title) {
        return res.status(400).json({ success: false, error: "title is required" });
      }

      const payload = {
        title: body.title,
        category: body.category ?? null,
        priority: body.priority ?? "medium",
        description: body.description ?? null,
        suggested_fix: body.suggested_fix ?? null,
        screenshot_path: body.screenshot_path ?? null,
        related_report_id: body.related_report_id ?? null,
        status: "submitted",
        submitted_by: user.id,
        admin_notes: null,
      };

      const { data, error } = await supabase
        .from("app_change_requests")
        .insert(payload)
        .select()
        .single();

      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "create",
        "app_change_requests",
        data.id,
        null,
        data as Record<string, unknown>,
        req
      );

      return res.status(201).json({ success: true, data });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
