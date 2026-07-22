/**
 * client/src/hooks/AuthProvider.tsx
 *
 * SHARED admin auth state via React context. Previously `useAuth` was a plain
 * hook, so every component (login form, AdminGuard, each admin page) held its
 * OWN independent copy that separately re-probed /api/admin/session. After the
 * login form authenticated and navigated, the destination's AdminGuard mounted a
 * FRESH useAuth that had to re-fetch the session from scratch — a race that left
 * the route rendering nothing (only the build-hash footer) until a manual reload
 * (by which time the cookie was already set). This was the production repro.
 *
 * With a single provider at the app root, `signIn()` updates ONE store that
 * every consumer reads synchronously, so authenticated content renders
 * immediately after a successful submit — no reload.
 *
 * Auth model is unchanged: username/password → /api/admin/login sets an HttpOnly
 * cookie; nothing is stored in localStorage/sessionStorage. Same-origin fetches
 * send the cookie automatically.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

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

const AUTHED: Pick<AuthState, "session" | "role" | "isAdmin"> = {
  session: { authenticated: true, access_token: "cookie" },
  role: "super_admin",
  isAdmin: true,
};
const ANON: Pick<AuthState, "session" | "email" | "role" | "isAdmin"> = {
  session: null,
  email: null,
  role: null,
  isAdmin: false,
};

async function probeSession(): Promise<Partial<AuthState>> {
  const res = await fetch("/api/admin/session", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return { ...ANON };
  const json = await res.json();
  if (json?.authenticated) {
    return { ...AUTHED, email: json.username ?? "admin" };
  }
  return { ...ANON };
}

const AuthContext = createContext<UseAuthReturn | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
      const next = await probeSession();
      setState((s) => ({ ...s, ...next, isLoading: false, error: null }));
    } catch {
      setState((s) => ({ ...s, ...ANON, isLoading: false }));
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
        // Update the SHARED store synchronously on success so every consumer
        // (AdminGuard, the destination page) sees an authenticated session on
        // the very next render — no re-probe race, no reload needed. We also
        // reconcile with the server via refresh() to pick up the real username.
        setState((s) => ({ ...s, ...AUTHED, email: username, isLoading: false, error: null }));
        void refresh();
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
    setState((s) => ({ ...s, ...ANON, isLoading: false }));
  }, []);

  const value: UseAuthReturn = { ...state, signIn, signOut, refresh };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the shared admin auth state. Falls back to a self-contained local
 * instance if no provider is mounted (keeps tests that render a component in
 * isolation working), but the app always mounts <AuthProvider> at the root.
 */
export function useAuth(): UseAuthReturn {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  return useLocalAuthFallback();
}

/** Provider-less fallback (isolated renders / tests). Mirrors the provider. */
function useLocalAuthFallback(): UseAuthReturn {
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
      const next = await probeSession();
      setState((s) => ({ ...s, ...next, isLoading: false, error: null }));
    } catch {
      setState((s) => ({ ...s, ...ANON, isLoading: false }));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
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
        setState((s) => ({ ...s, ...AUTHED, email: username, isLoading: false, error: null }));
        void refresh();
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
    } catch { /* ignore */ }
    setState((s) => ({ ...s, ...ANON, isLoading: false }));
  }, []);
  return { ...state, signIn, signOut, refresh };
}
