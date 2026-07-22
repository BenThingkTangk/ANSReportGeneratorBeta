/**
 * api/_adminSession.ts
 *
 * Canonical admin authentication for the HumanOS admin console. Replaces the
 * former Supabase magic-link identity layer with a single env-configured
 * username/password sign-in that mints a stateless, signed session cookie.
 *
 * Guarantees / design:
 *   - Credentials are NEVER hardcoded. The operator sets ADMIN_USERNAME and
 *     ADMIN_PASSWORD as protected Vercel env vars; only the env holds them.
 *   - Login verifies username AND password with constant-time comparisons
 *     (both factors evaluated unconditionally → no username enumeration via
 *     timing or response shape).
 *   - Success mints an HMAC-SHA256 signed token stored in an HttpOnly, Secure,
 *     SameSite=Strict cookie. Stateless → works across Vercel serverless
 *     invocations with no shared session store. Nothing is written to
 *     localStorage/sessionStorage.
 *   - Reasonable expiry (default 8h, override with ADMIN_SESSION_TTL_SEC).
 *   - CSRF posture: SameSite=Strict cookie + JSON-only POST bodies +
 *     Origin/Host validation on state-changing requests (login/logout).
 *
 * Uses only Node's built-in `node:crypto` — no new dependencies, compatible
 * with the project's current @vercel/node runtime.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Name of the signed session cookie. */
export const ADMIN_SESSION_COOKIE = "hos_admin_session";

/** A fixed logical subject for the single env-configured admin account. */
export const ADMIN_SUBJECT = "admin";

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Auth is enforced only when all three secrets are present. When unconfigured,
 * `verifyRequest` returns null (no session) and the login endpoint reports
 * `configured: false`, so a misconfigured deployment fails closed (admin locked
 * out) rather than open.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_USERNAME &&
      process.env.ADMIN_PASSWORD &&
      process.env.ADMIN_SESSION_SECRET,
  );
}

export function sessionTtlSeconds(): number {
  const raw = parseInt(process.env.ADMIN_SESSION_TTL_SEC ?? "", 10);
  // Default 8h; clamp to a sane 1h–12h window if an override is provided.
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60 * 8;
  return Math.min(Math.max(raw, 60 * 60), 60 * 60 * 12);
}

// ── Constant-time comparison ───────────────────────────────────────────────────

/**
 * Constant-time string comparison that does not leak length: both inputs are
 * hashed to a fixed-width SHA-256 digest before `timingSafeEqual`, so a length
 * mismatch takes the same time as a content mismatch.
 */
export function safeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify a candidate username+password against the env-configured values.
 * Evaluates BOTH comparisons unconditionally (no short-circuit) so a wrong
 * username and a wrong password are indistinguishable in timing.
 */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.ADMIN_USERNAME ?? "";
  const expectedPass = process.env.ADMIN_PASSWORD ?? "";
  const userOk = safeEquals(username, expectedUser);
  const passOk = safeEquals(password, expectedPass);
  return userOk && passOk;
}

// ── Signed session token (HMAC-SHA256, dependency-free) ─────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBuf(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

export interface AdminSession {
  sub: string;
  iat: number;
  exp: number;
}

export function signSession(
  sub: string,
  secret: string,
  ttlSec: number = sessionTtlSeconds(),
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSession = { sub, iat: now, exp: now + ttlSec };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a token's signature (constant-time) and expiry. Returns the decoded
 * payload or null on any failure (bad signature, tamper, expiry, malformed).
 */
export function verifySession(token: string, secret: string): AdminSession | null {
  try {
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = b64url(createHmac("sha256", secret).update(body).digest());
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(b64urlToBuf(body).toString("utf8")) as AdminSession;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ──────────────────────────────────────────────────────────────

export function readSessionToken(req: VercelRequest): string | null {
  const fromParsed = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (fromParsed) return fromParsed;
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === ADMIN_SESSION_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(
  res: VercelResponse,
  token: string,
  ttlSec: number = sessionTtlSeconds(),
): void {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${ttlSec}`,
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

// ── Session resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the authenticated admin session from the request cookie, or null.
 * Returns null when auth is unconfigured (fail-closed for admin access).
 */
export function verifyRequest(req: VercelRequest): AdminSession | null {
  if (!isAuthConfigured()) return null;
  const token = readSessionToken(req);
  if (!token) return null;
  return verifySession(token, process.env.ADMIN_SESSION_SECRET as string);
}

// ── CSRF: Origin/Host validation for state-changing requests ─────────────────────

/**
 * For POST login/logout: require that the request's Origin (or, if absent, its
 * Referer) matches the Host it was sent to. Combined with the SameSite=Strict
 * cookie and JSON-only bodies, this blocks cross-site forgery. Same-origin
 * requests with no Origin header (some same-origin GETs) are allowed; but for
 * POST we require an Origin/Referer and that it match Host.
 */
export function isSameOrigin(req: VercelRequest): boolean {
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  if (!host) return false;
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const candidate = origin || referer;
  if (!candidate) return false;
  try {
    const u = new URL(candidate);
    return u.host === host;
  } catch {
    return false;
  }
}
