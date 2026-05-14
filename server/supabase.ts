/**
 * server/supabase.ts
 * Server-side Supabase client helpers for the Express dev server.
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (never exposed to client).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";

// ── Types ────────────────────────────────────────────────────────────────────

export type UserRole = "super_admin" | "clinical_admin" | "reviewer" | "viewer";

export interface AdminUser {
  id: string;
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

export function createSupabaseFromRequest(req: Request): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const authHeader = req.headers["authorization"] as string | undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  return client;
}

// ── Role helpers ─────────────────────────────────────────────────────────────

export async function getUserRole(
  supabase: SupabaseClient
): Promise<UserRole | null> {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return null;

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;
  return data.role as UserRole;
}

export async function requireRole(
  supabase: SupabaseClient,
  allowedRoles: UserRole[]
): Promise<AdminUser> {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  const { data, error } = await supabase
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
  req: Request
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const adminSupabase = createSupabaseAdmin();
    await adminSupabase.from("audit_log").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      before: before ?? null,
      after: after ?? null,
      ip: (req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || null,
      user_agent: req.headers["user-agent"] ?? null,
    });
  } catch (e) {
    console.error("audit_log write failed:", e);
  }
}
