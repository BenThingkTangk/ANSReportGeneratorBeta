/**
 * AdminGatewayLoginPage — admin console username/password sign-in.
 *
 * Replaces the former magic-link email flow. A single polished form takes a
 * username and password, posts them to /api/admin/login (which validates against
 * ADMIN_USERNAME / ADMIN_PASSWORD server-side and sets an HttpOnly session
 * cookie), then routes into the admin console. No email/magic-link UI remains.
 *
 * Styling matches the existing HumanOS "Deep Space" admin surfaces (ps-glass,
 * brand cyan, PhysioPS overline). Accessible labels, password reveal toggle,
 * Enter-key submit, and loading/error states are all present. Stable
 * data-testids are exposed for tests.
 *
 * Routed from App.tsx at /admin/login. It keeps its historical filename because
 * pages/admin/login.tsx exists in the tree; App.tsx imports THIS component.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

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
  const { signIn, isAdmin, session } = useAuth();
  const [, navigate] = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already authenticated → go straight to the console.
  if (session && isAdmin) {
    navigate("/admin/knowledge");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!username.trim() || !password) {
      setError("Please enter both username and password.");
      return;
    }
    setLoading(true);
    const result = await signIn(username.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setPassword("");
      return;
    }
    navigate("/admin/knowledge");
  }

  const canSubmit = !loading && username.trim().length > 0 && password.length > 0;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "var(--color-bg-void)",
        backgroundImage: "var(--gradient-hero-orbit)",
        backgroundAttachment: "fixed",
      }}
    >
      <div
        className="ps-glass p-10 max-w-sm w-full mx-4"
        style={{ borderRadius: "var(--ps-radius-2xl)" }}
        data-testid="admin-login-card"
      >
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="admin-login-form">
          <div>
            <label htmlFor="admin-username" style={labelStyle}>
              Username
            </label>
            <input
              id="admin-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
              placeholder="admin"
              style={inputStyle}
              data-testid="admin-login-username"
            />
          </div>

          <div>
            <label htmlFor="admin-password" style={labelStyle}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="admin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                placeholder="••••••••"
                style={{ ...inputStyle, paddingRight: 44 }}
                data-testid="admin-login-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                data-testid="admin-login-password-toggle"
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 8,
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: 6,
                }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="assertive" style={errorStyle} data-testid="admin-login-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="ps-cta"
            data-testid="admin-login-submit"
            style={{
              width: "100%",
              justifyContent: "center",
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <a href="/#/" style={{ fontSize: 12, color: "var(--color-text-muted)", textDecoration: "none" }}>
            ← Back to App
          </a>
        </div>
      </div>
    </div>
  );
}
