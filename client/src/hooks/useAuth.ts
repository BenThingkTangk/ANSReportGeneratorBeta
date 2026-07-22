/**
 * client/src/hooks/useAuth.ts
 *
 * Cookie-session admin auth. Replaces the former Supabase magic-link flow with a
 * username/password sign-in backed by an HttpOnly session cookie:
 *   • POST /api/admin/login    → sets the cookie (username/password)
 *   • GET  /api/admin/session  → { configured, authenticated, username }
 *   • POST /api/admin/logout   → clears the cookie
 *
 * No tokens or auth state are ever placed in localStorage/sessionStorage — the
 * browser holds only the HttpOnly cookie, which JS cannot read. Same-origin
 * fetches send it automatically (credentials: "same-origin").
 *
 * The public shape (session/email/role/isAdmin/isLoading + signIn/signOut) is
 * preserved so AdminGuard, AdminLayout, and every admin page keep working with
 * no edits. `session` is a lightweight marker object (not a Supabase Session)
 * purely so existing `!!session` / `session?.access_token` guards stay truthy
 * for an authenticated admin; the HttpOnly cookie — not this object — carries
 * the real auth.
 */
import { useState, useEffect, useCallback } from "react";

export type UserRole = "super_admin" | "clinical_admin" | "reviewer" | "viewer" | null;

/** Minimal stand-in for the old Supabase Session so existing guards still work. */
export interface AdminSessionMarker {
  authenticated: true;
  /** Legacy field some callers read; cookie is HttpOnly so this is a sentinel. */
  access_token: "cookie";
}

export interface AuthState {
  session: AdminSessionMarker | null;
  email: string | null;
  role: UserRole;
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  /** Username/password sign-in. Returns an error string on failure, else null. */
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function readSession(): Promise<Partial<AuthState>> {
  const res = await fetch("/api/admin/session", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { session: null, email: null, role: null, isAdmin: false };
  }
  const json = await res.json();
  if (json?.authenticated) {
    return {
      session: { authenticated: true, access_token: "cookie" },
      email: json.username ?? "admin",
      role: "super_admin",
      isAdmin: true,
    };
  }
  return { session: null, email: null, role: null, isAdmin: false };
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    session: null,
    email: null,
    role: null,
    isAdmin: false,
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const next = await readSession();
      setState((s) => ({ ...s, ...next, isLoading: false, error: null }));
    } catch {
      setState((s) => ({
        ...s,
        session: null,
        email: null,
        role: null,
        isAdmin: false,
        isLoading: false,
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (username: string, password: string): Promise<{ error: string | null }> => {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          return { error: json?.error ?? "Sign-in failed. Please try again." };
        }
        await refresh();
        return { error: null };
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      /* ignore network errors during logout */
    }
    setState((s) => ({
      ...s,
      session: null,
      email: null,
      role: null,
      isAdmin: false,
      isLoading: false,
    }));
  }, []);

  return { ...state, signIn, signOut, refresh };
}
