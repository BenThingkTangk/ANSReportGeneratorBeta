/**
 * client/src/hooks/useAuth.ts
 *
 * Admin auth state for the console. The env-configured admin gateway
 * (username + password → signed HttpOnly cookie) is the primary auth path:
 * we resolve identity by calling GET /api/admin/me, which the server answers
 * from the gateway cookie. The cookie is sent automatically on same-origin
 * requests, so no token is handled in JS.
 *
 * A legacy Supabase magic-link session is still honoured when present (older /
 * local deployments without the gateway configured): if a Supabase session
 * exists we forward its Bearer token to /api/admin/me. The gateway is
 * authoritative when configured.
 */
import { useState, useEffect, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import getSupabase from "@/lib/supabase";

export type UserRole = "super_admin" | "clinical_admin" | "reviewer" | "viewer" | null;

export interface AuthState {
  session: Session | null;
  email: string | null;
  role: UserRole;
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

/**
 * Build a truthy session sentinel for a gateway-authenticated admin. Existing
 * admin pages guard on `session.access_token` and forward it as a Bearer
 * header; under the gateway the real authorization rides on the HttpOnly
 * cookie, so the token value is a non-secret placeholder the server ignores.
 */
function gatewaySession(email: string | null): Session {
  return {
    access_token: "gateway",
    refresh_token: "",
    expires_in: 0,
    expires_at: undefined,
    token_type: "bearer",
    user: { id: "gateway", email: email ?? undefined },
  } as unknown as Session;
}

export function useAuth(): UseAuthReturn {
  const supabase = getSupabase();

  const [state, setState] = useState<AuthState>({
    session: null,
    email: null,
    role: null,
    isAdmin: false,
    isLoading: true,
    error: null,
  });

  const evaluate = useCallback(async () => {
    // Best-effort legacy Supabase session (null under gateway-only deployments).
    let supaSession: Session | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      supaSession = data.session ?? null;
    } catch {
      supaSession = null;
    }

    try {
      const headers: Record<string, string> = {};
      if (supaSession?.access_token) {
        headers.Authorization = `Bearer ${supaSession.access_token}`;
      }
      // credentials:same-origin → the HttpOnly gateway cookie is sent automatically.
      const res = await fetch("/api/admin/me", { headers, credentials: "same-origin" });

      if (!res.ok) {
        setState({
          session: supaSession,
          email: supaSession?.user?.email ?? null,
          role: null,
          isAdmin: false,
          isLoading: false,
          error: null,
        });
        return;
      }

      const json = await res.json();
      const isAdmin = Boolean(json.isAdmin);
      const email = json.email ?? supaSession?.user?.email ?? null;
      const role = (json.role ?? null) as UserRole;

      setState({
        // A truthy session only when authorized as admin; otherwise expose the
        // (possibly non-admin) Supabase session so AdminGuard can explain it.
        session: isAdmin ? (supaSession ?? gatewaySession(email)) : supaSession,
        email,
        role,
        isAdmin,
        isLoading: false,
        error: null,
      });
    } catch {
      setState({
        session: supaSession,
        email: supaSession?.user?.email ?? null,
        role: null,
        isAdmin: false,
        isLoading: false,
        error: null,
      });
    }
  }, [supabase]);

  useEffect(() => {
    void evaluate();

    // Keep in sync with any legacy Supabase auth changes.
    let unsub: (() => void) | undefined;
    try {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(() => {
        void evaluate();
      });
      unsub = () => subscription.unsubscribe();
    } catch {
      /* placeholder client / no auth events — gateway probe already ran */
    }
    return () => unsub?.();
  }, [supabase, evaluate]);

  const signOut = useCallback(async () => {
    // Clear the gateway session cookie first, then any legacy Supabase session.
    // Best-effort: never block sign-out on a network error.
    try {
      await fetch("/api/admin/gateway", { method: "DELETE", credentials: "same-origin" });
    } catch {
      /* ignore */
    }
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    setState({
      session: null,
      email: null,
      role: null,
      isAdmin: false,
      isLoading: false,
      error: null,
    });
  }, [supabase]);

  return {
    ...state,
    signOut,
    refreshRole: evaluate,
  };
}
