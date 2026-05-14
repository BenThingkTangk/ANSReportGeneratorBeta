/**
 * /admin/change-requests/:id — Detail + audit history
 */
import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface ChangeRequest {
  id: string;
  title: string;
  category: string | null;
  priority: string;
  status: string;
  description: string | null;
  suggested_fix: string | null;
  related_report_id: string | null;
  screenshot_path: string | null;
  submitted_by: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditEntry {
  actor_email: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

const STATUSES = ["submitted","under_review","accepted","in_progress","completed","rejected"];

export default function ChangeRequestDetailPage() {
  const [, params] = useRoute("/admin/change-requests/:id");
  const id = params?.id;
  const [, navigate] = useLocation();
  const { session, role } = useAuth();
  const isAdmin = role === "super_admin" || role === "clinical_admin";
  const isSuperAdmin = role === "super_admin";

  const [cr, setCr] = useState<ChangeRequest | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [adminNotes, setAdminNotes] = useState("");
  const [newStatus, setNewStatus] = useState("");

  async function fetchCR() {
    if (!session?.access_token || !id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/change-requests/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setCr(json.data);
      setAuditHistory(json.auditHistory ?? []);
      setAdminNotes(json.data.admin_notes ?? "");
      setNewStatus(json.data.status);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchCR(); }, [session, id]);

  async function handleUpdate() {
    if (!session?.access_token || !id) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      if (isAdmin) {
        payload.status = newStatus;
        payload.admin_notes = adminNotes;
      }
      const res = await fetch(`/api/admin/change-requests/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setCr(json.data);
      setSuccessMsg("Updated successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isSuperAdmin || !session?.access_token || !id) return;
    if (!confirm(`Delete "${cr?.title}"?`)) return;
    try {
      const res = await fetch(`/api/admin/change-requests/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      navigate("/admin/change-requests");
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

  if (loading) {
    return (
      <AdminGuard>
        <AdminLayout title="Change Request">
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (!cr) {
    return (
      <AdminGuard>
        <AdminLayout title="Not Found">
          <div style={{ color: "var(--color-status-critical)", fontSize: 13 }}>{error ?? "Not found"}</div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout title={cr.title}>
        <div style={{ maxWidth: 680 }}>
          {successMsg && (
            <div style={{ padding: "10px 16px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, color: "var(--color-status-optimal)", fontSize: 13, marginBottom: 16 }}>
              {successMsg}
            </div>
          )}
          {error && (
            <div style={{ padding: "10px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "var(--color-status-critical)", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Detail card */}
          <div className="ps-glass p-5 mb-4" style={{ borderRadius: 10 }}>
            <div className="grid gap-3">
              <div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Description</div>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{cr.description || "—"}</p>
              </div>
              {cr.suggested_fix && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Suggested Fix</div>
                  <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{cr.suggested_fix}</p>
                </div>
              )}
              {cr.related_report_id && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Related Report ID</div>
                  <p className="ps-text-mono" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{cr.related_report_id}</p>
                </div>
              )}
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {[
                  { label: "Category", value: cr.category?.replace(/_/g," ") ?? "—" },
                  { label: "Priority", value: cr.priority },
                  { label: "Status", value: cr.status.replace(/_/g," ") },
                  { label: "Submitted", value: new Date(cr.created_at).toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Admin controls */}
          {isAdmin && (
            <div className="ps-glass p-5 mb-4" style={{ borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Admin Controls</div>
              <div className="grid gap-4">
                <div>
                  <label style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Status</label>
                  <select style={inputStyle} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Admin Notes</label>
                  <textarea
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Internal notes visible to admins only…"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button className="ps-cta" onClick={handleUpdate} disabled={saving} style={{ opacity: saving ? 0.6 : 1, padding: "9px 20px", fontSize: 13 }}>
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                {isSuperAdmin && (
                  <button onClick={handleDelete} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "var(--color-status-critical)", fontSize: 12, cursor: "pointer" }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Audit history */}
          {auditHistory.length > 0 && (
            <div className="ps-glass p-5 mb-4" style={{ borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--ps-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Status History</div>
              <div className="flex flex-col gap-2">
                {auditHistory.map((entry, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-brand-cyan)", marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {entry.actor_email ?? "System"} — <span style={{ color: "var(--color-brand-cyan)" }}>{entry.action}</span>
                      </span>
                      {entry.after && typeof entry.after === "object" && "status" in entry.after && (
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: 6 }}>
                          → {String(entry.after.status).replace(/_/g," ")}
                        </span>
                      )}
                      <div className="ps-text-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 1 }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <a href="/admin/change-requests" style={{ fontSize: 12, color: "var(--color-text-muted)", textDecoration: "none" }}>
            ← Back to Change Requests
          </a>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
