/**
 * client/src/hooks/useAuth.ts
 * Supabase magic-link auth session + admin role lookup via /api/admin/me.
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
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
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

  const fetchRole = useCallback(
    async (session: Session | null) => {
      if (!session?.access_token) {
        setState((s) => ({
          ...s,
          session: null,
          email: null,
          role: null,
          isAdmin: false,
          isLoading: false,
        }));
        return;
      }

      try {
        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setState((s) => ({
            ...s,
            session,
            email: session.user?.email ?? null,
            role: null,
            isAdmin: false,
            isLoading: false,
          }));
          return;
        }
        const json = await res.json();
        setState({
          session,
          email: json.email ?? session.user?.email ?? null,
          role: json.role ?? null,
          isAdmin: json.isAdmin ?? false,
          isLoading: false,
          error: null,
        });
      } catch {
        setState((s) => ({
          ...s,
          session,
          email: session.user?.email ?? null,
          role: null,
          isAdmin: false,
          isLoading: false,
        }));
      }
    },
    []
  );

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetchRole(session);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchRole(session);
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchRole]);

  const signInWithMagicLink = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/#/admin`,
        },
      });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    // Clear the perimeter gateway session (HttpOnly cookie) first, then the
    // Supabase magic-link session. Best-effort: never block sign-out on the
    // gateway call failing.
    try {
      await fetch("/api/admin/gateway", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      /* ignore network errors during logout */
    }
    await supabase.auth.signOut();
  }, [supabase]);

  const refreshRole = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await fetchRole(session);
  }, [supabase, fetchRole]);

  return {
    ...state,
    signInWithMagicLink,
    signOut,
    refreshRole,
  };
}
