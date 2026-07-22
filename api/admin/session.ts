/**
 * GET /api/admin/session — non-mutating session probe for the admin UI.
 *
 * Returns { configured, authenticated } and, when authenticated, the logical
 * admin identity. No secret values are ever returned. The client uses this on
 * load to decide whether to show the login form or the admin UI.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthConfigured, verifyRequest } from "../_adminSession.js";
import { setCorsHeaders, handleError } from "../_supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const configured = isAuthConfigured();
    const session = verifyRequest(req);
    return res.status(200).json({
      success: true,
      configured,
      authenticated: Boolean(session),
      // `username` is the display identity only (the configured admin account);
      // never the password. Present only when authenticated.
      username: session ? process.env.ADMIN_USERNAME ?? null : null,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
