/**
 * /admin/change-requests — Change requests list with filters
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface ChangeRequest {
  id: string;
  title: string;
  category: string | null;
  priority: string;
  status: string;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
  description: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "var(--color-status-critical)",
  high: "var(--color-status-risk)",
  medium: "var(--color-status-watch)",
  low: "var(--color-text-muted)",
};

const STATUS_COLORS: Record<string, string> = {
  submitted: "var(--color-brand-blue)",
  under_review: "var(--color-status-watch)",
  accepted: "var(--color-brand-cyan)",
  in_progress: "var(--color-brand-violet)",
  completed: "var(--color-status-optimal)",
  rejected: "var(--color-status-critical)",
};

function PriorityChip({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] ?? "var(--color-text-muted)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        background: `${color}18`,
        border: `1px solid ${color}44`,
        color,
        fontFamily: "var(--ps-font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {priority}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--color-text-muted)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        background: `${color}18`,
        border: `1px solid ${color}44`,
        color,
        fontFamily: "var(--ps-font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function ChangeRequestsPage() {
  const { session } = useAuth();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [page, setPage] = useState(1);

  async function fetchRequests() {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (filterStatus) params.set("status", filterStatus);
    if (filterCategory) params.set("category", filterCategory);
    if (filterPriority) params.set("priority", filterPriority);
    try {
      const res = await fetch(`/api/admin/change-requests?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRequests(json.data);
      setTotal(json.meta.total);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchRequests(); }, [session, page, filterStatus, filterCategory, filterPriority]);

  return (
    <AdminGuard>
      <AdminLayout title="App Change Requests">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            {
              value: filterStatus,
              set: setFilterStatus,
              placeholder: "Status",
              options: ["submitted","under_review","accepted","in_progress","completed","rejected"],
            },
            {
              value: filterCategory,
              set: setFilterCategory,
              placeholder: "Category",
              options: ["clinical_logic","algorithm_rule","report_language","ui_ux","citation_evidence","data_parsing","admin","bug","feature_request"],
            },
            {
              value: filterPriority,
              set: setFilterPriority,
              placeholder: "Priority",
              options: ["urgent","high","medium","low"],
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
              {options.map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
              ))}
            </select>
          ))}

          <Link href="/admin/change-requests/new">
            <a
              className="ps-cta"
              style={{ textDecoration: "none", padding: "8px 16px", fontSize: 13 }}
            >
              + Submit Request
            </a>
          </Link>
        </div>

        <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 12 }}>
          {loading ? "Loading…" : `${total} request${total !== 1 ? "s" : ""}`}
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
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

        <div className="ps-glass" style={{ borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid rgba(210,235,255,0.08)",
                    background: "rgba(10,17,29,0.5)",
                  }}
                >
                  {["Title", "Category", "Priority", "Status", "Submitted"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontFamily: "var(--ps-font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(210,235,255,0.05)" }}>
                      {[...Array(5)].map((__, j) => (
                        <td key={j} style={{ padding: "12px 14px" }}>
                          <div style={{ height: 12, borderRadius: 4, background: "rgba(255,255,255,0.05)", width: j === 0 ? "70%" : "50%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                {!loading && requests.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "24px 14px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
                      No change requests found
                    </td>
                  </tr>
                )}
                {!loading && requests.map((cr) => (
                  <tr
                    key={cr.id}
                    style={{ borderBottom: "1px solid rgba(210,235,255,0.05)", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,229,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 14px", maxWidth: 300 }}>
                      <Link href={`/admin/change-requests/${cr.id}`}>
                        <a style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                          {cr.title}
                        </a>
                      </Link>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--ps-font-mono)" }}>
                        {cr.category?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <PriorityChip priority={cr.priority} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <StatusChip status={cr.status} />
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className="ps-text-mono" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {new Date(cr.created_at).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
