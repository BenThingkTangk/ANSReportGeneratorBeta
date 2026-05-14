/**
 * /admin/knowledge/new — Create new knowledge source
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

export default function NewKnowledgePage() {
  const { session } = useAuth();
  const [, navigate] = useLocation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    authors: "",
    year: "",
    publication_type: "",
    journal: "",
    publisher: "",
    doi: "",
    pubmed_id: "",
    url: "",
    abstract: "",
    diagnostic_relevance: "",
    review_status: "draft",
    active_in_ai_analysis: false,
    active_in_report_citations: false,
    active_in_admin_review: true,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!session?.access_token) { setError("Not authenticated"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        year: form.year ? parseInt(form.year) : null,
        authors: form.authors || null,
        journal: form.journal || null,
        publisher: form.publisher || null,
        doi: form.doi || null,
        pubmed_id: form.pubmed_id || null,
        url: form.url || null,
        abstract: form.abstract || null,
        diagnostic_relevance: form.diagnostic_relevance || null,
      };
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      navigate(`/admin/knowledge/${json.data.id}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%",
    background: "rgba(10,17,29,0.8)",
    border: "1px solid rgba(0,229,255,0.18)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "var(--color-text-primary)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block",
    fontSize: 10,
    color: "var(--color-text-muted)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    fontFamily: "var(--ps-font-mono)",
    marginBottom: 4,
  };

  return (
    <AdminGuard>
      <AdminLayout title="Add Knowledge Source">
        <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
          {error && (
            <div
              style={{
                padding: "10px 16px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 8,
                color: "var(--color-status-critical)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <div className="ps-glass p-6" style={{ borderRadius: 10 }}>
            <div className="grid gap-4">
              <div>
                <label style={labelStyle}>Title *</label>
                <input
                  required
                  style={inputStyle}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Clinical Autonomic Dysfunction…"
                />
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Authors</label>
                  <input
                    style={inputStyle}
                    value={form.authors}
                    onChange={(e) => setForm((f) => ({ ...f, authors: e.target.value }))}
                    placeholder="Last, First; Last, First"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Year</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={form.year}
                    onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                    placeholder="2024"
                    min={1900}
                    max={2100}
                  />
                </div>
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Publication Type</label>
                  <select
                    style={inputStyle}
                    value={form.publication_type}
                    onChange={(e) => setForm((f) => ({ ...f, publication_type: e.target.value }))}
                  >
                    <option value="">—</option>
                    {["book","journal_article","paper","internal_protocol","algorithm_rule","note","pdf","other"].map(t => (
                      <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Journal / Publisher</label>
                  <input
                    style={inputStyle}
                    value={form.journal || form.publisher}
                    onChange={(e) => setForm((f) => ({ ...f, journal: e.target.value, publisher: e.target.value }))}
                    placeholder="Springer / Circulation"
                  />
                </div>
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>DOI</label>
                  <input
                    style={inputStyle}
                    value={form.doi}
                    onChange={(e) => setForm((f) => ({ ...f, doi: e.target.value }))}
                    placeholder="10.1000/xyz"
                  />
                </div>
                <div>
                  <label style={labelStyle}>URL</label>
                  <input
                    style={inputStyle}
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="https://…"
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Abstract</label>
                <textarea
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                  value={form.abstract}
                  onChange={(e) => setForm((f) => ({ ...f, abstract: e.target.value }))}
                  placeholder="Brief summary…"
                />
              </div>
              <div>
                <label style={labelStyle}>Diagnostic Relevance</label>
                <textarea
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                  value={form.diagnostic_relevance}
                  onChange={(e) => setForm((f) => ({ ...f, diagnostic_relevance: e.target.value }))}
                  placeholder="How this source relates to ANS diagnostics…"
                />
              </div>

              {/* Status */}
              <div>
                <label style={labelStyle}>Initial Status</label>
                <select
                  style={inputStyle}
                  value={form.review_status}
                  onChange={(e) => setForm((f) => ({ ...f, review_status: e.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="pending_review">Pending Review</option>
                  <option value="approved">Approved</option>
                </select>
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-3 pt-2">
                {[
                  { key: "active_in_ai_analysis" as const, label: "Active in AI Analysis", color: "var(--color-brand-violet)" },
                  { key: "active_in_report_citations" as const, label: "Active in Report Citations", color: "var(--color-brand-cyan)" },
                  { key: "active_in_admin_review" as const, label: "Active in Admin Review", color: "var(--color-brand-blue)" },
                ].map(({ key, label, color }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))}
                      style={{
                        width: 40,
                        height: 22,
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        background: form[key] ? color : "rgba(100,116,139,0.3)",
                        transition: "background 160ms",
                        position: "relative",
                        boxShadow: form[key] ? `0 0 8px ${color}55` : "none",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 4,
                          left: form[key] ? 21 : 4,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: "white",
                          transition: "left 160ms",
                        }}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="submit" className="ps-cta" disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
                {saving ? "Creating…" : "Create Source"}
              </button>
              <a
                href="/admin/knowledge"
                style={{
                  padding: "12px 20px",
                  borderRadius: 4,
                  border: "1px solid rgba(100,116,139,0.3)",
                  color: "var(--color-text-muted)",
                  fontSize: 14,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Cancel
              </a>
            </div>
          </div>
        </form>
      </AdminLayout>
    </AdminGuard>
  );
}
