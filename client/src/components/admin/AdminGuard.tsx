/**
 * AdminGuard — wraps admin routes.
 * Shows loading skeleton → restricted page → children (admin only).
 * NEVER reveals admin content to non-admins.
 */
import React from "react";
import { useAuth } from "@/hooks/useAuth";

interface AdminGuardProps {
  children: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isLoading, isAdmin, email } = useAuth();

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

  if (!isAdmin) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg-void)" }}
      >
        <div
          className="ps-glass p-10 max-w-md w-full mx-4 text-center"
          style={{ borderRadius: "var(--ps-radius-2xl)" }}
        >
          {/* Lock icon */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M17 11H7C5.9 11 5 11.9 5 13V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V13C19 11.9 18.1 11 17 11Z"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ color: "var(--color-status-critical)" }}
              />
              <path
                d="M12 16C12.5523 16 13 15.5523 13 15C13 14.4477 12.5523 14 12 14C11.4477 14 11 14.4477 11 15C11 15.5523 11.4477 16 12 16Z"
                fill="currentColor"
                style={{ color: "var(--color-status-critical)" }}
              />
              <path
                d="M8 11V7C8 4.79 9.79 3 12 3C14.21 3 16 4.79 16 7V11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{ color: "var(--color-status-critical)" }}
              />
            </svg>
          </div>

          <div className="ps-overline mb-3" style={{ color: "var(--color-status-critical)" }}>
            Access Restricted
          </div>
          <h2
            className="ps-text-display text-2xl mb-3"
            style={{ color: "var(--color-text-primary)" }}
          >
            Admins Only
          </h2>
          <p
            className="text-sm mb-6 leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            This area is restricted to authorised PhysioPS administrators.
            {email && (
              <span>
                {" "}
                Signed in as{" "}
                <span
                  className="ps-text-mono"
                  style={{ color: "var(--color-brand-cyan)" }}
                >
                  {email}
                </span>{" "}
                — your account does not have admin privileges.
              </span>
            )}
          </p>

          <div className="flex flex-col gap-3">
            <a
              href="/#/"
              className="ps-cta text-center justify-center"
              style={{ textDecoration: "none", display: "block" }}
            >
              Return to App
            </a>
            {!email && (
              <a
                href="/#/admin/login"
                className="text-sm"
                style={{ color: "var(--color-brand-cyan)", textDecoration: "none" }}
              >
                Sign in with admin email →
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
