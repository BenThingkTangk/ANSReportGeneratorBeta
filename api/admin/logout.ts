/**
 * POST /api/admin/logout — clears the admin session cookie.
 *
 * POST (not GET) so it is a deliberate state change; SameSite=Strict + JSON
 * posture keeps it CSRF-resistant. Idempotent: always clears the cookie and
 * returns success, whether or not a valid session was present.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSessionCookie, isSameOrigin } from "../_adminSession.js";
import { setCorsHeaders, handleError } from "../_supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // Clearing your own session cross-site is harmless, but keep the posture
    // consistent: same-origin only.
    if (!isSameOrigin(req)) {
      return res.status(403).json({ success: false, error: "Cross-origin request rejected" });
    }
    clearSessionCookie(res);
    return res.status(200).json({ success: true, authenticated: false });
  } catch (err) {
    return handleError(res, err);
  }
}
