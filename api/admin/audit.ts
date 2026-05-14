import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";

/**
 * GET /api/admin/audit — paginated audit log (super_admin only)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ success: false, error: "GET only" });

  const supabase = createSupabaseFromRequest(req);

  try {
    await requireRole(req, ["super_admin"]);

    const {
      entity_type,
      actor_id,
      action,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    let query = supabase
      .from("admin_audit_log")
      .select(
        "id, actor_id, actor_email, action, entity_type, entity_id, before, after, ip, user_agent, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (entity_type) query = query.eq("entity_type", entity_type);
    if (actor_id) query = query.eq("actor_id", actor_id);
    if (action) query = query.eq("action", action);

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const from = (pageNum - 1) * limitNum;
    query = query.range(from, from + limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

    return res.status(200).json({
      success: true,
      data,
      meta: { total: count ?? 0, page: pageNum, limit: limitNum },
    });
  } catch (err) {
    return handleError(res, err);
  }
}
