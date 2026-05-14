/**
 * /admin/login — Magic-link email entry
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signInWithMagicLink, isAdmin, session } = useAuth();
  const [, navigate] = useLocation();

  // If already admin, redirect
  if (session && isAdmin) {
    navigate("/admin/knowledge");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
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
          <h1
            className="ps-text-display"
            style={{ color: "var(--color-brand-cyan)", fontSize: 22 }}
          >
            Admin Console
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 6 }}>
            Sign in with your admin email to continue.
          </p>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="admin-email"
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Email Address
              </label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@physiops.com"
                style={{
                  width: "100%",
                  background: "rgba(10,17,29,0.8)",
                  border: "1px solid rgba(0,229,255,0.2)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  color: "var(--color-text-primary)",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {error && (
              <p
                style={{
                  color: "var(--color-status-critical)",
                  fontSize: 12,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                {error}
              </p>
            )}

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
        ) : (
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
                <path
                  d="M22 6L12 13L2 6"
                  stroke="var(--color-brand-cyan)"
                  strokeWidth="1.5"
                />
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
              onClick={() => { setSent(false); setError(null); }}
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
