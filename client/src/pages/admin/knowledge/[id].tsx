/**
 * /admin/knowledge/:id — Knowledge source detail + edit
 */
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface Source {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  publication_type: string | null;
  journal: string | null;
  publisher: string | null;
  doi: string | null;
  pubmed_id: string | null;
  url: string | null;
  abstract: string | null;
  key_claims: string[];
  diagnostic_relevance: string | null;
  ans_metrics: string[];
  tags: string[];
  used_in: string[];
  active_in_ai_analysis: boolean;
  active_in_report_citations: boolean;
  active_in_admin_review: boolean;
  review_status: string;
  file_path: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  added_by: string | null;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
  chunkCount?: number;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "var(--ps-font-mono)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: value ? "var(--color-text-primary)" : "var(--color-text-muted)",
          fontFamily: mono ? "var(--ps-font-mono)" : undefined,
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

export default function KnowledgeDetailPage() {
  const [, params] = useRoute("/admin/knowledge/:id");
  const id = params?.id;
  const [, navigate] = useLocation();
  const { session, role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const canEdit = role === "super_admin" || role === "clinical_admin" || role === "reviewer";

  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit form state
  const [form, setForm] = useState<Partial<Source>>({});

  async function fetchSource() {
    if (!session?.access_token || !id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/knowledge/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSource(json.data);
      setForm(json.data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchSource(); }, [session, id]);

  async function handleSave() {
    if (!session?.access_token || !id) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/knowledge/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSource(json.data);
      setForm(json.data);
      setSuccessMsg("Saved successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setForm((f) => ({ ...f, review_status: newStatus }));
    if (!session?.access_token || !id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/knowledge/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ review_status: newStatus }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSource(json.data);
      setForm(json.data);
      setSuccessMsg(`Status → ${newStatus.replace(/_/g, " ")}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isSuperAdmin || !session?.access_token || !id) return;
    if (!confirm(`Delete "${source?.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/knowledge/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      navigate("/admin/knowledge");
    } catch (e: unknown) {
      setError((e as Error).message);
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

  if (loading) {
    return (
      <AdminGuard>
        <AdminLayout title="Knowledge Source">
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (!source) {
    return (
      <AdminGuard>
        <AdminLayout title="Not Found">
          <div style={{ color: "var(--color-status-critical)", fontSize: 13 }}>{error ?? "Source not found"}</div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout title={source.title}>
        <div style={{ maxWidth: 760 }}>
          {/* Status messages */}
          {successMsg && (
            <div
              style={{
                padding: "10px 16px",
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: 8,
                color: "var(--color-status-optimal)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {successMsg}
            </div>
          )}
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

          {/* Workflow buttons */}
          <div className="flex flex-wrap gap-2 mb-6">
            {source.review_status === "draft" && (
              <button
                onClick={() => handleStatusChange("pending_review")}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(245,158,11,0.4)",
                  background: "rgba(245,158,11,0.08)",
                  color: "var(--color-status-watch)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Submit for Review
              </button>
            )}
            {(source.review_status === "pending_review" || source.review_status === "needs_review") && (role === "super_admin" || role === "clinical_admin") && (
              <button
                onClick={() => handleStatusChange("approved")}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(34,197,94,0.4)",
                  background: "rgba(34,197,94,0.08)",
                  color: "var(--color-status-optimal)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Approve
              </button>
            )}
            {source.review_status !== "archived" && (
              <button
                onClick={() => handleStatusChange("archived")}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(100,116,139,0.4)",
                  background: "rgba(100,116,139,0.08)",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Archive
              </button>
            )}
            {source.review_status === "approved" && (
              <button
                onClick={() => handleStatusChange("needs_review")}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,107,53,0.4)",
                  background: "rgba(255,107,53,0.08)",
                  color: "var(--color-sympathetic)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Mark Needs Review
              </button>
            )}
            {isSuperAdmin && (
              <button
                onClick={handleDelete}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.08)",
                  color: "var(--color-status-critical)",
                  fontSize: 12,
                  cursor: "pointer",
                  marginLeft: "auto",
                }}
              >
                Delete
              </button>
            )}
          </div>

          {/* AI toggles */}
          <div className="ps-glass p-5 mb-6" style={{ borderRadius: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: "var(--ps-font-mono)",
                marginBottom: 12,
              }}
            >
              Activation Toggles
            </div>
            <div className="flex flex-col gap-3">
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
                    disabled={!canEdit}
                    onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))}
                    title={form[key] ? `Deactivate ${label}` : `Activate ${label}`}
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 999,
                      border: "none",
                      cursor: canEdit ? "pointer" : "default",
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

          {/* Form fields */}
          {canEdit && (
            <div className="ps-glass p-5 mb-6" style={{ borderRadius: 10 }}>
              <div className="grid gap-4">
                <div>
                  <label style={labelStyle}>Title *</label>
                  <input
                    style={inputStyle}
                    value={form.title ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label style={labelStyle}>Authors</label>
                    <input
                      style={inputStyle}
                      value={form.authors ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, authors: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Year</label>
                    <input
                      type="number"
                      style={inputStyle}
                      value={form.year ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, year: e.target.value ? parseInt(e.target.value) : null }))}
                    />
                  </div>
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select
                      style={{ ...inputStyle }}
                      value={form.publication_type ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, publication_type: e.target.value || null }))}
                    >
                      <option value="">—</option>
                      {["book","journal_article","paper","internal_protocol","algorithm_rule","note","pdf","other"].map(t => (
                        <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>DOI</label>
                    <input
                      style={inputStyle}
                      value={form.doi ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, doi: e.target.value || null }))}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>URL</label>
                  <input
                    style={inputStyle}
                    value={form.url ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value || null }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Abstract</label>
                  <textarea
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                    value={form.abstract ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, abstract: e.target.value || null }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Diagnostic Relevance</label>
                  <textarea
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                    value={form.diagnostic_relevance ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, diagnostic_relevance: e.target.value || null }))}
                  />
                </div>
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="ps-cta mt-4"
                style={{ opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}

          {/* Read-only metadata */}
          <div className="ps-glass p-5 mb-4" style={{ borderRadius: 10 }}>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
            >
              <Field label="Source ID" value={source.id} mono />
              <Field label="Created" value={new Date(source.created_at).toLocaleDateString()} />
              <Field label="Updated" value={new Date(source.updated_at).toLocaleDateString()} />
              {source.file_path && (
                <Field label="File" value={source.file_path} mono />
              )}
              {source.chunkCount !== undefined && (
                <Field label="Chunks" value={source.chunkCount} />
              )}
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <a
              href="/admin/knowledge"
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                textDecoration: "none",
              }}
            >
              ← Back to Knowledge Inventory
            </a>
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
