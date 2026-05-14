import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  setCorsHeaders,
  handleError,
  getUserRole,
} from "../_supabase.js";

/**
 * GET /api/admin/me
 * Returns { email, role, isAdmin } for the authenticated user.
 * 401 if not authenticated, 404 if no role assigned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  try {
    const supabase = createSupabaseFromRequest(req);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const role = await getUserRole(supabase);
    const isAdmin = role === "super_admin" || role === "clinical_admin";

    return res.status(200).json({
      success: true,
      email: user.email,
      role: role ?? null,
      isAdmin,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
