/**
 * api/_supabase.ts
 * Server-side Supabase client helpers for Vercel serverless functions.
 * Mirror of server/supabase.ts — same interface, same logic.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";
import { isGatewayConfigured, gatewayStatus } from "./_adminGateway.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type UserRole = "super_admin" | "clinical_admin" | "reviewer" | "viewer";

export interface AdminUser {
  /**
   * Supabase auth user id, or `null` when the request was authorized purely by
   * the env-configured admin gateway (username + password). In gateway mode
   * there is no per-user Supabase identity, so ownership/audit columns
   * (`added_by`, `last_updated_by`, `actor_id`) are written as NULL — they are
   * nullable FKs to auth.users(id) ON DELETE SET NULL.
   */
  id: string | null;
  email: string;
  role: UserRole;
}

// ── Backend configuration (server-only Supabase env) ─────────────────────────

/**
 * Read a Supabase env var, tolerating stray surrounding whitespace / a trailing
 * newline. Values pasted into the Vercel dashboard or piped via
 * `echo … | vercel env add` very commonly acquire a leading/trailing "\n" or
 * space. A trailing newline on SUPABASE_URL corrupts every constructed REST URL
 * (`https://ref.supabase.co\n/rest/v1/…`) so the underlying fetch fails with a
 * bare `TypeError: fetch failed`; the same class of bug already bit the admin
 * gateway. Normalising on read fixes it generically. Returns undefined when
 * unset or blank so the "configured" check stays honest.
 */
function readSupabaseEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
}

export function supabaseUrl(): string | undefined {
  return readSupabaseEnv("SUPABASE_URL");
}
export function supabaseServiceRoleKey(): string | undefined {
  return readSupabaseEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export interface BackendConfigStatus {
  configured: boolean;
  /** Secret-free, human-readable reason when not configured. */
  detail?: string;
  /** Env var NAMES that need attention — names only, never values. */
  missing?: string[];
}

/**
 * Precise, NON-SECRET status of the knowledge/RAG database backend env.
 * Reports which variable NAME is missing or malformed without ever exposing a
 * value, so the API/UI can surface an actionable configuration message instead
 * of a raw `TypeError: fetch failed`.
 */
export function backendConfigStatus(): BackendConfigStatus {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    return {
      configured: false,
      missing,
      detail: `Missing server environment variable(s): ${missing.join(", ")}.`,
    };
  }
  // URL must be a well-formed absolute http(s) URL, else fetch() throws opaquely.
  try {
    const parsed = new URL(url as string);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        configured: false,
        missing: ["SUPABASE_URL"],
        detail: "SUPABASE_URL must be an absolute https:// URL.",
      };
    }
  } catch {
    return {
      configured: false,
      missing: ["SUPABASE_URL"],
      detail: "SUPABASE_URL is not a valid URL.",
    };
  }
  return { configured: true };
}

/**
 * True when a caught error is a transport/connectivity failure (unreachable
 * host, DNS, refused, reset, timeout, TLS) rather than a legitimate query
 * error. Inspects both the message and the PostgREST `details` (which carries
 * the underlying cause for a swallowed fetch rejection) plus any `code`.
 */
export function isBackendUnreachable(err: unknown): boolean {
  const e = (err ?? {}) as {
    message?: string;
    details?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.cause?.message ?? ""}`;
  const code = `${e.code ?? ""} ${e.cause?.code ?? ""}`;
  return (
    /fetch failed|network|failed to fetch|socket hang up|tls|certificate/i.test(haystack) ||
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|UND_ERR/i.test(
      `${haystack} ${code}`
    )
  );
}

/**
 * Map a Supabase/PostgREST failure to a precise, SECRET-FREE API error.
 * Transport failures → 503 with an actionable message naming SUPABASE_URL
 * (never the value). Genuine query errors keep their (non-secret) PostgREST
 * message with a 400. The verbose PostgREST `details`/stack are never forwarded
 * to the client.
 */
export function backendError(
  err: { message?: string; details?: string; code?: string } | Error
): Error & { statusCode: number } {
  if (isBackendUnreachable(err)) {
    return Object.assign(
      new Error(
        "Cannot reach the knowledge database backend. Verify SUPABASE_URL points to the correct, active Supabase project (transport error contacting Supabase)."
      ),
      { statusCode: 503 }
    );
  }
  const message = (err as { message?: string })?.message || "Database query failed";
  return Object.assign(new Error(message), { statusCode: 400 });
}

// ── Singleton service-role client ────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null;

export function createSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const cfg = backendConfigStatus();
  if (!cfg.configured) {
    // 503 (not 500): this is an environment/configuration state, and the
    // message names the offending variable without exposing any value.
    throw Object.assign(
      new Error(`Supabase backend is not configured: ${cfg.detail}`),
      { statusCode: 503 }
    );
  }
  _adminClient = createClient(supabaseUrl() as string, supabaseServiceRoleKey() as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

// ── Per-request client (from Bearer token) ───────────────────────────────────

/**
 * Returns the user's Bearer token from the request, or null.
 */
export function getBearerToken(req: VercelRequest): string | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export function createSupabaseFromRequest(req: VercelRequest): SupabaseClient {
  // Returns the admin (service-role) client. Token-based identity is resolved
  // separately via getAuthUser() — the SUPABASE_SERVICE_ROLE_KEY apikey makes
  // attaching a Bearer header on this client unreliable for auth.getUser().
  return createSupabaseAdmin();
}

/**
 * Authoritative way to resolve the user identity from the request's Bearer token.
 * Uses the service-role admin client's `auth.getUser(token)` overload which
 * verifies the JWT against Supabase Auth directly — no header-mixing required.
 */
export async function getAuthUser(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) return null;
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// ── Role helpers ─────────────────────────────────────────────────────────────

export async function getUserRole(
  supabase: SupabaseClient,
  userIdOverride?: string
): Promise<UserRole | null> {
  let userId = userIdOverride;
  if (!userId) {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) return null;
    userId = user.id;
  }

  // Always read user_roles via admin client to bypass RLS reliably
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data.role as UserRole;
}

export async function requireRole(
  reqOrSupabase: VercelRequest | SupabaseClient,
  allowedRoles: UserRole[]
): Promise<AdminUser> {
  // Support both call patterns: (req, roles) and legacy (supabase, roles)
  let user: { id: string; email?: string } | null = null;

  if ("headers" in reqOrSupabase) {
    const req = reqOrSupabase as VercelRequest;

    // Primary path: the env-configured admin gateway (username + password) is
    // the sole, authoritative admin entry point for this deployment. A valid
    // signed gateway session cookie authorizes as super_admin — the highest
    // role — which satisfies every admin route's role gate. No Supabase
    // magic-link identity is required or consulted in this mode.
    if (isGatewayConfigured()) {
      const gw = gatewayStatus(req);
      if (!gw.authenticated) {
        throw Object.assign(
          new Error("Admin gateway authentication required"),
          { statusCode: 401 }
        );
      }
      const role: UserRole = "super_admin";
      if (!allowedRoles.includes(role)) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }
      return { id: null, email: gw.sub ?? "", role };
    }

    // Legacy fallback (gateway unconfigured — e.g. local dev / older
    // deployments): resolve identity from the Supabase Bearer token and RLS.
    user = (await getAuthUser(req)) as any;
  } else {
    const { data } = await (reqOrSupabase as SupabaseClient).auth.getUser();
    user = data.user as any;
  }

  if (!user) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (error || !data || !allowedRoles.includes(data.role as UserRole)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }

  return { id: user.id, email: user.email ?? "", role: data.role as UserRole };
}

// ── Audit logging ─────────────────────────────────────────────────────────────

export async function logAudit(
  supabase: SupabaseClient,
  action: string,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  req: VercelRequest
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const adminSupabase = createSupabaseAdmin();
    await adminSupabase.from("admin_audit_log").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      before: before ?? null,
      after: after ?? null,
      ip:
        (req.headers["x-forwarded-for"] as string) ||
        req.socket?.remoteAddress ||
        null,
      user_agent: req.headers["user-agent"] ?? null,
    });
  } catch (e) {
    console.error("admin_audit_log write failed:", e);
  }
}

// ── CORS helper ───────────────────────────────────────────────────────────────

import type { VercelResponse } from "@vercel/node";

export function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

export function handleError(
  res: VercelResponse,
  err: unknown
): VercelResponse {
  const e = err as Error & { statusCode?: number };
  const statusCode = e.statusCode ?? 500;
  console.error(e.message, e);
  return res.status(statusCode).json({ success: false, error: e.message });
}
