/**
 * AdminGatewayLoginPage — admin sign-in (username + password ONLY).
 *
 * The env-configured admin gateway (ADMIN_GATEWAY_USERNAME +
 * ADMIN_GATEWAY_PASSWORD_HASH + ADMIN_SESSION_SECRET) is the SOLE admin entry
 * path. A successful POST /api/admin/gateway mints a signed, HttpOnly, Secure,
 * SameSite session cookie; every admin API then authorizes off that cookie (see
 * requireRole in api/_supabase.ts). The former Supabase magic-link email step
 * has been removed — there is no email field and no OTP flow here.
 *
 * Secrets never touch the client: the form only sends the username/password the
 * operator types, and the server responds with generic success/failure. The
 * password hash and session secret live only in the server environment.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(10,17,29,0.8)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "var(--color-text-primary)",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--color-text-secondary)",
  marginBottom: 6,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const errorStyle: React.CSSProperties = {
  color: "var(--color-status-critical)",
  fontSize: 12,
  background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.2)",
  borderRadius: 6,
  padding: "8px 12px",
};

export default function AdminGatewayLoginPage() {
  const [, navigate] = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = probe not finished / unreachable; true/false = server-reported.
  const [configured, setConfigured] = useState<boolean | null>(null);

  // On mount, probe gateway status: skip the form if already signed in, and
  // surface a clear diagnostic when the gateway env vars are not configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/gateway", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("probe failed");
        const json = await res.json();
        if (cancelled) return;
        setConfigured(Boolean(json?.configured));
        if (json?.configured && json?.authenticated) {
          navigate("/admin/knowledge");
        }
      } catch {
        if (!cancelled) setConfigured(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // navigate identity is stable in wouter; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (res.ok) {
        // Signed in — drop the password from memory and enter the console.
        setPassword("");
        navigate("/admin/knowledge");
        return;
      }

      // Generic, non-enumerating error messages.
      let message = "Invalid username or password.";
      try {
        const json = await res.json();
        if (res.status === 429) {
          const secs = Number(json?.retryAfterSec);
          message =
            Number.isFinite(secs) && secs > 0
              ? `Too many attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}.`
              : "Too many attempts. Please try again later.";
        } else if (res.status === 400 && json?.configured === false) {
          message = "Admin sign-in is not configured on the server.";
        } else if (json?.error) {
          message = json.error;
        }
      } catch {
        /* keep default message */
      }
      setError(message);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || !username.trim() || !password;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "var(--color-bg-void)",
        backgroundImage: "var(--gradient-hero-orbit)",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="ps-glass p-10 max-w-sm w-full mx-4" style={{ borderRadius: "var(--ps-radius-2xl)" }}>
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="ps-overline mb-2" style={{ fontSize: 9 }}>
            PhysioPS × HumanOS
          </div>
          <h1 className="ps-text-display" style={{ color: "var(--color-brand-cyan)", fontSize: 22 }}>
            Admin Console
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 6 }}>
            Sign in with your admin username and password.
          </p>
        </div>

        {/* Diagnostic when the server gateway env vars are unset. The form still
            renders, but a submit will report that sign-in is not configured. */}
        {configured === false && (
          <div
            data-testid="gateway-not-configured"
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--color-text-secondary)",
              background: "rgba(234,179,8,0.08)",
              border: "1px solid rgba(234,179,8,0.28)",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 16,
            }}
          >
            <strong style={{ color: "hsl(45 90% 65%)" }}>Admin sign-in not configured.</strong>{" "}
            Set <code>ADMIN_GATEWAY_USERNAME</code>, <code>ADMIN_GATEWAY_PASSWORD_HASH</code>, and{" "}
            <code>ADMIN_SESSION_SECRET</code> in the deployment environment (see
            docs/ADMIN_GATEWAY_SETUP.md), then redeploy.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="admin-login-form">
          <div>
            <label htmlFor="gw-username" style={labelStyle}>
              Username
            </label>
            <input
              id="gw-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="admin"
              style={inputStyle}
              data-testid="gw-username"
            />
          </div>
          <div>
            <label htmlFor="gw-password" style={labelStyle}>
              Password
            </label>
            <input
              id="gw-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={inputStyle}
              data-testid="gw-password"
            />
          </div>

          {error && (
            <p style={errorStyle} data-testid="admin-login-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={disabled}
            className="ps-cta"
            data-testid="admin-login-submit"
            style={{
              width: "100%",
              justifyContent: "center",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <a
            href="/#/"
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              textDecoration: "none",
            }}
          >
            ← Back to App
          </a>
        </div>
      </div>
    </div>
  );
}
