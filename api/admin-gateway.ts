/**
 * api/admin-gateway.ts  (Vercel serverless route → /api/admin-gateway)
 *
 * HTTP endpoint for the env-configured admin perimeter gateway. This is the
 * login/logout/status surface that sits IN FRONT OF the Supabase magic-link auth
 * + Row Level Security (defense in depth). It never replaces Supabase RLS — after
 * clearing the gateway the user still authenticates with Supabase and every admin
 * API re-checks the gateway cookie AND the RLS-backed role (see
 * requireRole → requireGateway in ./_supabase.ts).
 *
 * The client calls the canonical path /api/admin/gateway. Because the api/admin/
 * directory is read-only in this environment, the function is hosted here at
 * api/admin-gateway.ts and vercel.json rewrites /api/admin/gateway → this route.
 * (When api/admin/ becomes writable, move this file to api/admin/gateway.ts and
 * drop the rewrite — no other change is needed.)
 *
 *   GET    → { configured, authenticated } — the login UI uses this to decide
 *            whether to show the gateway step at all.
 *   POST   → { username, password } → verifies against the env-configured
 *            username + scrypt password-hash (constant-time, no plaintext ever
 *            stored/hardcoded), rate-limits by client IP, and on success mints a
 *            signed HttpOnly session cookie.
 *   DELETE → clears the session cookie (logout).
 *
 * The endpoint intentionally does NOT call requireGateway/requireRole on itself:
 * it is the thing you authenticate against, so gating it would be circular.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  isGatewayConfigured,
  gatewayStatus,
  verifyPassword,
  safeEquals,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  checkRateLimit,
  recordFailure,
  recordSuccess,
  clientIp,
} from "./_adminGateway.js";
import { setCorsHeaders, handleError } from "./_supabase.js";

// Upper bounds so an attacker cannot force expensive scrypt work with a giant
// password body. Anything longer is rejected as invalid (and still rate-limited).
const MAX_USERNAME_LEN = 256;
const MAX_PASSWORD_LEN = 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── Status probe ─────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const status = gatewayStatus(req);
      return res.status(200).json({
        success: true,
        configured: status.configured,
        authenticated: status.authenticated,
      });
    }

    // ── Logout ───────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    // ── Login ────────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      if (!isGatewayConfigured()) {
        // Opt-in: nothing to log into. The client falls back to magic-link only.
        return res
          .status(400)
          .json({ success: false, configured: false, error: "Admin gateway is not configured" });
      }

      // Rate-limit by source IP BEFORE doing any (expensive) verification.
      const key = `gw:${clientIp(req)}`;
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

      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        return res
          .status(400)
          .json({ success: false, error: "Username and password are required" });
      }

      const expectedUser = process.env.ADMIN_GATEWAY_USERNAME as string;
      const expectedHash = process.env.ADMIN_GATEWAY_PASSWORD_HASH as string;
      const secret = process.env.ADMIN_SESSION_SECRET as string;

      // Evaluate BOTH factors unconditionally (no short-circuit) so a wrong
      // username and a wrong password are indistinguishable in timing and in the
      // response — this avoids username enumeration. Over-length inputs are
      // rejected without running scrypt.
      const withinBounds =
        username.length <= MAX_USERNAME_LEN && password.length <= MAX_PASSWORD_LEN;
      const userOk = safeEquals(username, expectedUser);
      const passOk = withinBounds && verifyPassword(password, expectedHash);
      const ok = userOk && passOk;

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

      // Success: clear the failure counter and mint the signed session cookie.
      recordSuccess(key);
      const token = signSession(username, secret);
      setSessionCookie(res, token);
      return res.status(200).json({ success: true, authenticated: true });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return handleError(res, err);
  }
}
