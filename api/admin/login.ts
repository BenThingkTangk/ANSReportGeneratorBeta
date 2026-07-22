/**
 * POST /api/admin/login — username/password sign-in for the admin console.
 *
 * Body (JSON only): { username: string, password: string }
 * On success: mints a signed HttpOnly/Secure/SameSite=Strict session cookie and
 * returns { success: true, authenticated: true }.
 *
 * Credentials are validated server-side against ADMIN_USERNAME / ADMIN_PASSWORD
 * with constant-time comparisons (see ../_adminSession.ts). Nothing is stored in
 * the client beyond the cookie the browser holds; no plaintext ever leaves the
 * server. CSRF posture: SameSite=Strict cookie + JSON-only body + Origin/Host
 * validation + per-instance IP rate limiting.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  isAuthConfigured,
  verifyCredentials,
  signSession,
  setSessionCookie,
  isSameOrigin,
  ADMIN_SUBJECT,
} from "../_adminSession.js";
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  clientIp,
} from "../_adminGateway.js";
import { setCorsHeaders, handleError } from "../_supabase.js";

const MAX_USERNAME_LEN = 256;
const MAX_PASSWORD_LEN = 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    if (!isAuthConfigured()) {
      return res.status(503).json({
        success: false,
        configured: false,
        error: "Admin authentication is not configured on this deployment.",
      });
    }

    // CSRF: reject cross-site POSTs. SameSite=Strict already prevents the cookie
    // from riding along, but validating Origin/Host is defense-in-depth and also
    // guards the initial (pre-cookie) login POST.
    if (!isSameOrigin(req)) {
      return res.status(403).json({ success: false, error: "Cross-origin request rejected" });
    }

    // Reject non-JSON content types (blocks simple <form> CSRF which cannot set
    // application/json without a preflight).
    const ctype = String(req.headers["content-type"] ?? "");
    if (!ctype.includes("application/json")) {
      return res.status(415).json({ success: false, error: "JSON body required" });
    }

    // Per-instance IP rate-limit BEFORE any verification work.
    const key = `login:${clientIp(req)}`;
    const pre = checkRateLimit(key);
    if (!pre.allowed) {
      res.setHeader("Retry-After", String(pre.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: "Too many attempts. Please try again later.",
        retryAfterSec: pre.retryAfterSec,
      });
    }

    let body: unknown;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      body = null;
    }
    const username = (body as { username?: unknown })?.username;
    const password = (body as { password?: unknown })?.password;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username ||
      !password
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Username and password are required" });
    }

    const withinBounds =
      username.length <= MAX_USERNAME_LEN && password.length <= MAX_PASSWORD_LEN;
    const ok = withinBounds && verifyCredentials(username, password);

    if (!ok) {
      recordFailure(key);
      const post = checkRateLimit(key);
      if (!post.allowed) {
        res.setHeader("Retry-After", String(post.retryAfterSec));
        return res.status(429).json({
          success: false,
          error: "Too many failed attempts. Please try again later.",
          retryAfterSec: post.retryAfterSec,
        });
      }
      return res
        .status(401)
        .json({ success: false, error: "Invalid username or password" });
    }

    recordSuccess(key);
    const token = signSession(ADMIN_SUBJECT, process.env.ADMIN_SESSION_SECRET as string);
    setSessionCookie(res, token);
    return res.status(200).json({ success: true, authenticated: true });
  } catch (err) {
    return handleError(res, err);
  }
}
