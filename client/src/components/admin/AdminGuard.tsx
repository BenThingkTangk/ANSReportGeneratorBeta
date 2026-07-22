/**
 * AdminGuard — wraps admin routes.
 * Shows loading skeleton → restricted page → children (admin only).
 * NEVER reveals admin content to non-admins.
 */
import React from "react";
import { useAuth } from "@/hooks/useAuth";
import AdminLoginPage from "@/components/AdminGatewayLoginPage";

interface AdminGuardProps {
  children: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg-void)" }}>
        <div className="flex flex-col items-center gap-4">
          {/* Skeleton spinner */}
          <div
            className="w-12 h-12 rounded-full border-2 animate-spin"
            style={{
              borderColor: "var(--color-brand-cyan) transparent transparent transparent",
            }}
          />
          <p className="ps-text-mono text-sm" style={{ color: "var(--color-text-muted)" }}>
            Verifying access…
          </p>
        </div>
      </div>
    );
  }

  // Unauthenticated → show the username/password sign-in form directly.
  // (The env-configured admin is the only account; there is no non-admin
  // "signed in but unauthorised" state to distinguish here.)
  if (!isAdmin) {
    return <AdminLoginPage />;
  }

  return <div data-testid="admin-content" style={{ display: "contents" }}>{children}</div>;
}
