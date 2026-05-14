/**
 * /admin/knowledge — Knowledge Inventory table
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface KnowledgeSource {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  publication_type: string | null;
  doi: string | null;
  url: string | null;
  used_in: string[];
  active_in_ai_analysis: boolean;
  review_status: string;
  created_at: string;
  updated_at: string;
  added_by: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  approved: "var(--color-status-optimal)",
  draft: "var(--color-text-muted)",
  pending_review: "var(--color-status-watch)",
  archived: "rgba(100,116,139,0.7)",
  needs_review: "var(--color-status-risk)",
};

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

export default function KnowledgePage() {
  const { session } = useAuth();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [page, setPage] = useState(1);

  async function fetchSources() {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("search", search);
    if (filterStatus) params.set("status", filterStatus);
    if (filterType) params.set("type", filterType);
    if (filterActive !== "") params.set("active", filterActive);

    try {
      const res = await fetch(`/api/admin/knowledge?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSources(json.data);
      setTotal(json.meta.total);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchSources(); }, [session, page, filterStatus, filterType, filterActive]);
  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void fetchSources(); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  async function toggleAI(source: KnowledgeSource) {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`/api/admin/knowledge/${source.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active_in_ai_analysis: !source.active_in_ai_analysis }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id
            ? { ...s, active_in_ai_analysis: !s.active_in_ai_analysis }
            : s
        )
      );
    } catch (e: unknown) {
      alert("Toggle failed: " + (e as Error).message);
    }
  }

  return (
    <AdminGuard>
      <AdminLayout title="Knowledge Inventory">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <input
            type="search"
            placeholder="Search title, author, abstract…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: "1 1 220px",
              background: "rgba(10,17,29,0.8)",
              border: "1px solid rgba(0,229,255,0.2)",
              borderRadius: 8,
              padding: "8px 12px",
              color: "var(--color-text-primary)",
              fontSize: 13,
              outline: "none",
              minWidth: 180,
            }}
          />

          {[
            {
              value: filterStatus,
              set: setFilterStatus,
              placeholder: "Status",
              options: ["approved", "draft", "pending_review", "archived", "needs_review"],
            },
            {
              value: filterType,
              set: setFilterType,
              placeholder: "Type",
              options: ["book", "journal_article", "paper", "internal_protocol", "algorithm_rule", "note", "pdf", "other"],
            },
            {
              value: filterActive,
              set: setFilterActive,
              placeholder: "Active in AI",
              options: [{ label: "Active", value: "true" }, { label: "Inactive", value: "false" }],
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
              {(options as Array<string | { label: string; value: string }>).map((o) =>
                typeof o === "string" ? (
                  <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                ) : (
                  <option key={o.value} value={o.value}>{o.label}</option>
                )
              )}
            </select>
          ))}

          <Link href="/admin/knowledge/new">
            <a
              className="ps-cta"
              style={{ textDecoration: "none", padding: "8px 16px", fontSize: 13 }}
            >
              + Add Source
            </a>
          </Link>
        </div>

        {/* Results count */}
        <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 12 }}>
          {loading ? "Loading…" : `${total} source${total !== 1 ? "s" : ""}`}
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

        {/* Table */}
        <div
          className="ps-glass"
          style={{ borderRadius: 12, overflow: "hidden" }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid rgba(210,235,255,0.08)",
                    background: "rgba(10,17,29,0.5)",
                  }}
                >
                  {["Title", "Type", "Year", "Status", "Active in AI", "Updated"].map((h) => (
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
                  [...Array(6)].map((_, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(210,235,255,0.05)" }}>
                      {[...Array(6)].map((__, j) => (
                        <td key={j} style={{ padding: "12px 14px" }}>
                          <div
                            style={{
                              height: 12,
                              borderRadius: 4,
                              background: "rgba(255,255,255,0.05)",
                              width: j === 0 ? "80%" : "60%",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                {!loading && sources.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "24px 14px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
                      No sources found
                    </td>
                  </tr>
                )}
                {!loading && sources.map((source) => (
                  <tr
                    key={source.id}
                    style={{
                      borderBottom: "1px solid rgba(210,235,255,0.05)",
                      cursor: "pointer",
                      transition: "background 120ms",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,229,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                      <Link href={`/admin/knowledge/${source.id}`}>
                        <a
                          style={{
                            color: "var(--color-text-primary)",
                            textDecoration: "none",
                            fontWeight: 500,
                            display: "block",
                          }}
                        >
                          <div style={{ marginBottom: 2 }}>{source.title}</div>
                          {source.authors && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-muted)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {source.authors}
                            </div>
                          )}
                        </a>
                      </Link>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          fontFamily: "var(--ps-font-mono)",
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {source.publication_type?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span className="ps-text-mono" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {source.year ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <StatusChip status={source.review_status} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); void toggleAI(source); }}
                        title={source.active_in_ai_analysis ? "Active in AI — click to deactivate" : "Inactive in AI — click to activate"}
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 999,
                          border: "none",
                          cursor: "pointer",
                          background: source.active_in_ai_analysis
                            ? "var(--color-brand-violet)"
                            : "rgba(100,116,139,0.3)",
                          transition: "background 160ms",
                          position: "relative",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 3,
                            left: source.active_in_ai_analysis ? 18 : 3,
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: "white",
                            transition: "left 160ms",
                          }}
                        />
                      </button>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span className="ps-text-mono" style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {new Date(source.updated_at).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex gap-2 justify-end mt-4">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(0,229,255,0.2)",
                background: "transparent",
                color: "var(--color-text-secondary)",
                cursor: page <= 1 ? "not-allowed" : "pointer",
                fontSize: 12,
                opacity: page <= 1 ? 0.4 : 1,
              }}
            >
              ← Prev
            </button>
            <span style={{ padding: "6px 8px", fontSize: 12, color: "var(--color-text-muted)" }}>
              Page {page}
            </span>
            <button
              disabled={page * 50 >= total}
              onClick={() => setPage((p) => p + 1)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(0,229,255,0.2)",
                background: "transparent",
                color: "var(--color-text-secondary)",
                cursor: page * 50 >= total ? "not-allowed" : "pointer",
                fontSize: 12,
                opacity: page * 50 >= total ? 0.4 : 1,
              }}
            >
              Next →
            </button>
          </div>
        )}
      </AdminLayout>
    </AdminGuard>
  );
}
