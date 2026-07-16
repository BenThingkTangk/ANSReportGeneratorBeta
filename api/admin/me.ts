import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getAuthUser,
  getUserRole,
  createSupabaseAdmin,
  setCorsHeaders,
  handleError,
} from "../_supabase.js";
import { isGatewayConfigured, gatewayStatus } from "../_adminGateway.js";

/**
 * GET /api/admin/me
 * Returns { email, role, isAdmin } for the authenticated user.
 * 401 if not authenticated.
 *
 * When the env-configured admin gateway is enabled it is the sole admin auth
 * path: a valid gateway session cookie resolves to a super_admin identity and
 * no Supabase magic-link token is consulted. The username (gateway `sub`) is
 * surfaced as the email for display; the password hash and secrets are never
 * exposed here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  try {
    if (isGatewayConfigured()) {
      const gw = gatewayStatus(req);
      if (!gw.authenticated) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      return res.status(200).json({
        success: true,
        email: gw.sub ?? "",
        role: "super_admin",
        isAdmin: true,
      });
    }

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
