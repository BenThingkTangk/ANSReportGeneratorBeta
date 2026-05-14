/**
 * /admin/audit — Audit log (super_admin only)
 */
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export default function AuditPage() {
  const { session, role } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterEntityType, setFilterEntityType] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function fetchAudit() {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (filterEntityType) params.set("entity_type", filterEntityType);
    if (filterAction) params.set("action", filterAction);
    try {
      const res = await fetch(`/api/admin/audit?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setEntries(json.data);
      setTotal(json.meta.total);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchAudit(); }, [session, page, filterEntityType, filterAction]);

  if (role !== "super_admin") {
    return (
      <AdminGuard>
        <AdminLayout title="Audit Log">
          <div
            style={{
              padding: "16px 20px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              color: "var(--color-status-critical)",
              fontSize: 13,
            }}
          >
            This page is restricted to Super Admins.
          </div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout title="Audit Log">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            {
              value: filterEntityType,
              set: setFilterEntityType,
              placeholder: "Entity Type",
              options: ["ans_knowledge_sources","app_change_requests","user_roles"],
            },
            {
              value: filterAction,
              set: setFilterAction,
              placeholder: "Action",
              options: ["create","update","delete","upload_file"],
            },
          ].map(({ value, set, placeholder, options }) => (
            <select
              key={placeholder}
              value={value}
              onChange={(e) => { set(e.target.value); setPage(1); }}
              style={{
                background: "rgba(10,17,29,0.8)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 8,
                padding: "8px 12px",
                color: value ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontSize: 13,
                outline: "none",
              }}
            >
              <option value="">{placeholder}</option>
              {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
          ))}
        </div>

        <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 12 }}>
          {loading ? "Loading…" : `${total} event${total !== 1 ? "s" : ""}`}
        </div>

        {error && (
          <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "var(--color-status-critical)", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="ps-glass" style={{ borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(210,235,255,0.08)", background: "rgba(10,17,29,0.5)" }}>
                {["Time", "Actor", "Action", "Entity", "ID"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "var(--ps-font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-muted)", whiteSpace: "nowrap", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                [...Array(8)].map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(210,235,255,0.05)" }}>
                    {[...Array(5)].map((__, j) => (
                      <td key={j} style={{ padding: "10px 14px" }}>
                        <div style={{ height: 10, borderRadius: 3, background: "rgba(255,255,255,0.05)", width: j === 0 ? "60%" : "80%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {!loading && entries.length === 0 && (
                <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)" }}>No audit events found</td></tr>
              )}
              {!loading && entries.map((entry) => (
                <>
                  <tr
                    key={entry.id}
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    style={{ borderBottom: "1px solid rgba(210,235,255,0.05)", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,229,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <span className="ps-text-mono" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {entry.actor_email ?? entry.actor_id?.slice(0, 8) ?? "system"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          fontFamily: "var(--ps-font-mono)",
                          fontSize: 11,
                          color: entry.action === "delete" ? "var(--color-status-critical)"
                            : entry.action === "create" ? "var(--color-status-optimal)"
                            : "var(--color-brand-cyan)",
                        }}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className="ps-text-mono" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        {entry.entity_type?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className="ps-text-mono" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                        {entry.entity_id?.slice(0, 8) ?? "—"}
                      </span>
                    </td>
                  </tr>
                  {expanded === entry.id && (
                    <tr key={entry.id + "_expanded"} style={{ borderBottom: "1px solid rgba(210,235,255,0.05)" }}>
                      <td colSpan={5} style={{ padding: "0 14px 12px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 8 }}>
                          {entry.before && (
                            <div>
                              <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontFamily: "var(--ps-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Before</div>
                              <pre style={{ fontSize: 10, color: "var(--color-text-secondary)", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 6, overflow: "auto", maxHeight: 120 }}>
                                {JSON.stringify(entry.before, null, 2)}
                              </pre>
                            </div>
                          )}
                          {entry.after && (
                            <div>
                              <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontFamily: "var(--ps-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>After</div>
                              <pre style={{ fontSize: 10, color: "var(--color-text-secondary)", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 6, overflow: "auto", maxHeight: 120 }}>
                                {JSON.stringify(entry.after, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                        {entry.ip && <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>IP: {entry.ip}</p>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {total > 50 && (
          <div className="flex gap-2 justify-end mt-4">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(0,229,255,0.2)", background: "transparent", color: "var(--color-text-secondary)", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 12, opacity: page <= 1 ? 0.4 : 1 }}>
              ← Prev
            </button>
            <span style={{ padding: "6px 8px", fontSize: 12, color: "var(--color-text-muted)" }}>Page {page}</span>
            <button disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(0,229,255,0.2)", background: "transparent", color: "var(--color-text-secondary)", cursor: page * 50 >= total ? "not-allowed" : "pointer", fontSize: 12, opacity: page * 50 >= total ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
        )}
      </AdminLayout>
    </AdminGuard>
  );
}
