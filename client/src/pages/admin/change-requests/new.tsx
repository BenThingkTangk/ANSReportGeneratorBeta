/**
 * /admin/change-requests/new — Submit a new change request
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

export default function NewChangeRequestPage() {
  const { session } = useAuth();
  const [, navigate] = useLocation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    category: "",
    priority: "medium",
    description: "",
    suggested_fix: "",
    related_report_id: "",
  });

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!session?.access_token) { setError("Not authenticated"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/change-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: form.title,
          category: form.category || null,
          priority: form.priority,
          description: form.description || null,
          suggested_fix: form.suggested_fix || null,
          related_report_id: form.related_report_id || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      navigate(`/admin/change-requests/${json.data.id}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminGuard>
      <AdminLayout title="Submit Change Request">
        <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
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
                  placeholder="Brief description of the change"
                />
              </div>

              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select
                    style={inputStyle}
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    <option value="">— Select —</option>
                    {["clinical_logic","algorithm_rule","report_language","ui_ux","citation_evidence","data_parsing","admin","bug","feature_request"].map(c => (
                      <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select
                    style={inputStyle}
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Description</label>
                <textarea
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical" }}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the issue or requested change in detail…"
                />
              </div>

              <div>
                <label style={labelStyle}>Suggested Fix (optional)</label>
                <textarea
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                  value={form.suggested_fix}
                  onChange={(e) => setForm((f) => ({ ...f, suggested_fix: e.target.value }))}
                  placeholder="How would you fix or implement this?"
                />
              </div>

              <div>
                <label style={labelStyle}>Related Report ID (anonymised)</label>
                <input
                  style={inputStyle}
                  value={form.related_report_id}
                  onChange={(e) => setForm((f) => ({ ...f, related_report_id: e.target.value }))}
                  placeholder="No PHI — use anonymised ID only"
                />
                <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                  Do not include any patient-identifiable information.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="submit" className="ps-cta" disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
                {saving ? "Submitting…" : "Submit Request"}
              </button>
              <a
                href="/admin/change-requests"
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
