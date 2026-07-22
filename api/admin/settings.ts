import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
  createSupabaseFromRequest,
} from "../_supabase.js";

/**
 * /api/admin/settings
 *
 * GET           — any authenticated user can read non-sensitive flags.
 * PUT { key, value } — super_admin only.
 *
 * Currently exposes a single key (evidence_linked_explanations_enabled) plus
 * any other rows present in app_settings.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createSupabaseFromRequest(req);

  try {
    if (req.method === "GET") {
      // Reading flags requires an authenticated admin session. Under the
      // username/password cookie auth there is no per-user Bearer token, so we
      // authorize via requireRole (any admin tier) instead of getAuthUser — the
      // only caller is the admin rule-evidence page. (Back-compat: requireRole
      // falls back to the legacy Supabase identity when cookie auth is unset.)
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
      const admin = createSupabaseAdmin();
      const { data, error } = await admin
        .from("app_settings")
        .select("key, value, description, updated_at");
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      // Convert to convenient map form for the client.
      const map: Record<string, unknown> = {};
      for (const row of data ?? []) map[row.key] = row.value;
      return res.status(200).json({ success: true, data: { settings: data, map } });
    }

    if (req.method === "PUT") {
      const user = await requireRole(req, ["super_admin"]);
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const key = body?.key;
      const value = body?.value;
      if (!key || value === undefined) {
        return res
          .status(400)
          .json({ success: false, error: "key and value required" });
      }
      const admin = createSupabaseAdmin();
      const { data: before } = await admin
        .from("app_settings")
        .select("*")
        .eq("key", key)
        .maybeSingle();

      const { data, error } = await admin
        .from("app_settings")
        .upsert(
          { key, value, updated_by: user.id },
          { onConflict: "key" }
        )
        .select()
        .single();
      if (error) throw Object.assign(new Error(error.message), { statusCode: 400 });

      await logAudit(
        supabase,
        "settings.update",
        "app_settings",
        null,
        before ?? null,
        data,
        req
      );
      return res.status(200).json({ success: true, data });
    }

    return res.status(405).json({ success: false, error: "method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
