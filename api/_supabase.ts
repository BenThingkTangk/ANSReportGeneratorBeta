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

// ── Singleton service-role client ────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null;

export function createSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _adminClient = createClient(url, key, {
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
