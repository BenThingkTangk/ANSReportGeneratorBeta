/**
 * AdminGatewayLoginPage — two-step admin sign-in.
 *
 * Step 1 (perimeter gateway): when the env-configured username + password-hash
 *   gateway is enabled (GET /api/admin/gateway → { configured: true }), the user
 *   must first pass a username/password check that mints an HttpOnly session
 *   cookie. This is defense-in-depth IN FRONT OF Supabase — it never replaces the
 *   magic-link identity or the RLS-backed role check.
 * Step 2 (magic link): the existing Supabase magic-link email entry. This remains
 *   the authoritative identity layer; RLS + AdminGuard still gate every action.
 *
 * When the gateway is not configured (or the endpoint is unreachable) the page
 * behaves exactly as before — magic-link only. The gateway is strictly opt-in.
 *
 * NOTE: this lives under components/ (writable) and is routed from App.tsx. It
 * supersedes pages/admin/login.tsx, which is read-only in this environment. The
 * canonical in-place version is staged at
 * proposed-changes/client/src/pages/admin/login.tsx.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

type Phase = "checking" | "gateway" | "magiclink";

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
  const { signInWithMagicLink, isAdmin, session } = useAuth();
  const [, navigate] = useLocation();

  // Perimeter-gateway step state.
  const [phase, setPhase] = useState<Phase>("checking");
  const [gwUsername, setGwUsername] = useState("");
  const [gwPassword, setGwPassword] = useState("");
  const [gwLoading, setGwLoading] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

  // Magic-link step state.
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decide which step to show: probe the gateway status once on mount.
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
        // Show the gateway step only when it is configured AND not yet passed.
        setPhase(json?.configured && !json?.authenticated ? "gateway" : "magiclink");
      } catch {
        // Opt-in: if the probe fails or the gateway is unconfigured, fall back to
        // the existing magic-link-only flow.
        if (!cancelled) setPhase("magiclink");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If already an authenticated admin, skip straight to the console.
  if (session && isAdmin) {
    navigate("/admin/knowledge");
    return null;
  }

  async function handleGatewaySubmit(e: React.FormEvent) {
    e.preventDefault();
    setGwLoading(true);
    setGwError(null);
    try {
      const res = await fetch("/api/admin/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: gwUsername.trim(),
          password: gwPassword,
        }),
      });

      if (res.ok) {
        // Perimeter cleared — drop the password from memory and advance.
        setGwPassword("");
        setPhase("magiclink");
        return;
      }

      let message = "Invalid username or password.";
      try {
        const json = await res.json();
        if (res.status === 429) {
          const secs = Number(json?.retryAfterSec);
          message =
            Number.isFinite(secs) && secs > 0
              ? `Too many attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}.`
              : "Too many attempts. Please try again later.";
        } else if (json?.error) {
          message = json.error;
        }
      } catch {
        /* keep default message */
      }
      setGwError(message);
    } catch {
      setGwError("Network error. Please try again.");
    } finally {
      setGwLoading(false);
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signInWithMagicLink(email.trim());
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  }

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
            {phase === "gateway"
              ? "Enter your gateway credentials to continue."
              : "Sign in with your admin email to continue."}
          </p>
        </div>

        {/* Probing the gateway status */}
        {phase === "checking" && (
          <div className="text-center" style={{ padding: "12px 0" }}>
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin mx-auto"
              style={{ borderColor: "var(--color-brand-cyan) transparent transparent transparent" }}
            />
            <p className="ps-text-mono" style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 10 }}>
              Preparing sign-in…
            </p>
          </div>
        )}

        {/* Step 1 — perimeter gateway (username + password) */}
        {phase === "gateway" && (
          <form onSubmit={handleGatewaySubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="gw-username" style={labelStyle}>
                Username
              </label>
              <input
                id="gw-username"
                type="text"
                autoComplete="username"
                value={gwUsername}
                onChange={(e) => setGwUsername(e.target.value)}
                required
                placeholder="admin"
                style={inputStyle}
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
                value={gwPassword}
                onChange={(e) => setGwPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>

            {gwError && <p style={errorStyle}>{gwError}</p>}

            <button
              type="submit"
              disabled={gwLoading || !gwUsername.trim() || !gwPassword}
              className="ps-cta"
              style={{
                width: "100%",
                justifyContent: "center",
                opacity: gwLoading || !gwUsername.trim() || !gwPassword ? 0.5 : 1,
                cursor: gwLoading || !gwUsername.trim() || !gwPassword ? "not-allowed" : "pointer",
              }}
            >
              {gwLoading ? "Verifying…" : "Continue"}
            </button>
          </form>
        )}

        {/* Step 2 — Supabase magic link */}
        {phase === "magiclink" && !sent && (
          <form onSubmit={handleMagicLinkSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="admin-email" style={labelStyle}>
                Email Address
              </label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@physiops.com"
                style={inputStyle}
              />
            </div>

            {error && <p style={errorStyle}>{error}</p>}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="ps-cta"
              style={{
                width: "100%",
                justifyContent: "center",
                opacity: loading || !email.trim() ? 0.5 : 1,
                cursor: loading || !email.trim() ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Sending…" : "Send Magic Link"}
            </button>
          </form>
        )}

        {/* Step 2 — sent confirmation */}
        {phase === "magiclink" && sent && (
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{
                background: "rgba(0,229,255,0.1)",
                border: "1px solid rgba(0,229,255,0.3)",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
                  stroke="var(--color-brand-cyan)"
                  strokeWidth="1.5"
                />
                <path d="M22 6L12 13L2 6" stroke="var(--color-brand-cyan)" strokeWidth="1.5" />
              </svg>
            </div>
            <h2 className="ps-text-display" style={{ color: "var(--color-text-primary)", fontSize: 17, marginBottom: 8 }}>
              Check your email
            </h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.6 }}>
              We sent a sign-in link to{" "}
              <span className="ps-text-mono" style={{ color: "var(--color-brand-cyan)" }}>
                {email}
              </span>
              . Click the link to access the admin console.
            </p>
            <button
              onClick={() => {
                setSent(false);
                setError(null);
              }}
              style={{
                marginTop: 16,
                fontSize: 12,
                color: "var(--color-text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Use a different email
            </button>
          </div>
        )}

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
