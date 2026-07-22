import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getAuthUser,
  getUserRole,
  createSupabaseAdmin,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";
import { isAuthConfigured, verifyRequest } from "../_adminSession.js";

/**
 * GET /api/admin/me
 * Returns { email, role, isAdmin } for the authenticated admin.
 *
 * Primary path: the env username/password session cookie (POST /api/admin/login)
 * → a single super_admin account. Falls back to the legacy Supabase identity
 * only when the new auth is not configured. 401 if not authenticated.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  try {
    if (isAuthConfigured()) {
      const session = verifyRequest(req);
      if (!session) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      return res.status(200).json({
        success: true,
        email: process.env.ADMIN_USERNAME ?? "admin",
        role: "super_admin",
        isAdmin: true,
      });
    }

    // Legacy fallback (Supabase magic-link identity), unchanged.
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const role = await getUserRole(createSupabaseAdmin(), user.id);
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
