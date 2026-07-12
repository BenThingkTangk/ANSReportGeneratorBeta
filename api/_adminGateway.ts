/**
 * api/_adminGateway.ts
 *
 * Env-configured username + password-hash PERIMETER gateway for the admin
 * console. This is a defense-in-depth layer that sits IN FRONT OF the existing
 * Supabase magic-link auth + Row Level Security, which remain the authoritative
 * per-user identity and authorization layer. The gateway does not replace them.
 *
 * Design goals / guarantees:
 *   - The password is NEVER hardcoded. The operator stores a scrypt hash in the
 *     ADMIN_GATEWAY_PASSWORD_HASH env var (generate it locally with
 *     `node scripts/hash-admin-password.mjs`). Only the hash lives in the
 *     environment — never the plaintext password.
 *   - Successful login mints a signed, HttpOnly, Secure, SameSite cookie
 *     (a stateless HMAC session token). This works across Vercel serverless
 *     invocations with no shared session store.
 *   - Constant-time comparisons for both username and password verification to
 *     avoid timing side-channels and user enumeration.
 *   - Best-effort, per-instance in-memory rate limiting with lockout. NOTE:
 *     Vercel spins up multiple isolated instances, so this is not a global
 *     counter — it slows down bursts against a warm instance. For a hard global
 *     limit, back `checkRateLimit`/`recordFailure` with a shared store (e.g. a
 *     Supabase table or Upstash). The interface is kept small for that reason.
 *   - The whole gateway is OPT-IN: when the env vars are absent, every helper is
 *     a no-op / pass-through so existing magic-link-only deployments keep working
 *     unchanged.
 */

import {
  createHmac,
  createHash,
  scryptSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const GATEWAY_COOKIE = "hos_admin_gw";

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * The gateway is only enforced when all three secrets are present. This keeps
 * the change backwards-compatible: unconfigured deployments behave exactly as
 * before (magic-link only).
 */
export function isGatewayConfigured(): boolean {
  return Boolean(
    process.env.ADMIN_GATEWAY_USERNAME &&
      process.env.ADMIN_GATEWAY_PASSWORD_HASH &&
      process.env.ADMIN_SESSION_SECRET
  );
}

function sessionTtlSeconds(): number {
  const raw = parseInt(process.env.ADMIN_SESSION_TTL_SEC ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 8; // default 8h
}

// ── Password hashing (scrypt) ─────────────────────────────────────────────────
// Stored format:  scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>

const SCRYPT_MAXMEM = 64 * 1024 * 1024; // 64 MB — comfortably above default cost

export interface ScryptParams {
  N?: number;
  r?: number;
  p?: number;
  keylen?: number;
  salt?: Buffer;
}

export function hashPassword(password: string, opts: ScryptParams = {}): string {
  const N = opts.N ?? 16384;
  const r = opts.r ?? 8;
  const p = opts.p ?? 1;
  const keylen = opts.keylen ?? 64;
  const salt = opts.salt ?? randomBytes(16);
  const hash = scryptSync(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Verify a plaintext password against a stored scrypt hash string.
 * Returns false on any malformed input rather than throwing.
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    if (![N, r, p].every((n) => Number.isFinite(n) && n > 0)) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison that does not leak length. Hashes both inputs
 * to a fixed-width digest before comparing so mismatched lengths still take the
 * same time.
 */
export function safeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// ── Signed session token (HMAC-SHA256, JWT-like but dependency-free) ───────────

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlToBuf(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

export interface GatewaySession {
  sub: string;
  iat: number;
  exp: number;
}

export function signSession(
  sub: string,
  secret: string,
  ttlSec: number = sessionTtlSeconds()
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: GatewaySession = { sub, iat: now, exp: now + ttlSec };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a session token's signature and expiry. Returns the decoded payload or
 * null. Uses a constant-time signature comparison.
 */
export function verifySession(token: string, secret: string): GatewaySession | null {
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
    const payload = JSON.parse(b64urlToBuf(body).toString("utf8")) as GatewaySession;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export function readGatewayToken(req: VercelRequest): string | null {
  const fromParsed = req.cookies?.[GATEWAY_COOKIE];
  if (fromParsed) return fromParsed;
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === GATEWAY_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(
  res: VercelResponse,
  token: string,
  ttlSec: number = sessionTtlSeconds()
): void {
  const attrs = [
    `${GATEWAY_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${ttlSec}`,
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${GATEWAY_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}

// ── Rate limiting (per-instance, in-memory, best-effort) ──────────────────────

interface Bucket {
  fails: number[];
  lockedUntil: number;
}

const _buckets = new Map<string, Bucket>();

interface Limits {
  max: number;
  windowMs: number;
  lockoutMs: number;
}

function limits(): Limits {
  const max = parseInt(process.env.ADMIN_GATEWAY_MAX_ATTEMPTS ?? "", 10);
  const windowSec = parseInt(process.env.ADMIN_GATEWAY_WINDOW_SEC ?? "", 10);
  const lockoutSec = parseInt(process.env.ADMIN_GATEWAY_LOCKOUT_SEC ?? "", 10);
  return {
    max: Number.isFinite(max) && max > 0 ? max : 5,
    windowMs: (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 900) * 1000,
    lockoutMs: (Number.isFinite(lockoutSec) && lockoutSec > 0 ? lockoutSec : 900) * 1000,
  };
}

export function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0]!.trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.socket?.remoteAddress ?? "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Check (without recording) whether an attempt from `key` is currently allowed. */
export function checkRateLimit(key: string): RateLimitResult {
  const { max, windowMs } = limits();
  const now = Date.now();
  const b = _buckets.get(key);
  if (!b) return { allowed: true, retryAfterSec: 0 };
  if (b.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  b.fails = b.fails.filter((t) => now - t < windowMs);
  if (b.fails.length >= max) {
    return { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Record a failed attempt; triggers a lockout once the window threshold is hit. */
export function recordFailure(key: string): void {
  const { max, windowMs, lockoutMs } = limits();
  const now = Date.now();
  const b = _buckets.get(key) ?? { fails: [], lockedUntil: 0 };
  b.fails = b.fails.filter((t) => now - t < windowMs);
  b.fails.push(now);
  if (b.fails.length >= max) b.lockedUntil = now + lockoutMs;
  _buckets.set(key, b);
}

/** Clear the failure record for `key` after a successful login. */
export function recordSuccess(key: string): void {
  _buckets.delete(key);
}

/** Test-only: reset the in-memory rate-limit state. */
export function _resetRateLimit(): void {
  _buckets.clear();
}

// ── Enforcement ───────────────────────────────────────────────────────────────

/**
 * Throws a 401 when the gateway is configured but the request carries no valid
 * gateway session cookie. No-op when the gateway is not configured.
 * Called from `requireRole()` so every admin API inherits the perimeter check.
 */
export function requireGateway(req: VercelRequest): void {
  if (!isGatewayConfigured()) return;
  const token = readGatewayToken(req);
  const session = token
    ? verifySession(token, process.env.ADMIN_SESSION_SECRET as string)
    : null;
  if (!session) {
    throw Object.assign(new Error("Admin gateway authentication required"), {
      statusCode: 401,
    });
  }
}

export interface GatewayStatus {
  configured: boolean;
  authenticated: boolean;
  sub?: string;
}

/** Non-throwing status probe used by the login UI to decide which step to show. */
export function gatewayStatus(req: VercelRequest): GatewayStatus {
  if (!isGatewayConfigured()) return { configured: false, authenticated: false };
  const token = readGatewayToken(req);
  const session = token
    ? verifySession(token, process.env.ADMIN_SESSION_SECRET as string)
    : null;
  return {
    configured: true,
    authenticated: Boolean(session),
    sub: session?.sub,
  };
}
