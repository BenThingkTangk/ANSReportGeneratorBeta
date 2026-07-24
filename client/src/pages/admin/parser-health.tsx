/**
 * /admin/parser-health — Parser & Model Health board.
 *
 * Read-only status of the deterministic pipeline (live parser self-test),
 * AI model wiring (configured vs not — never the key), knowledge-base
 * reachability, and the last few regression-gate eval runs.
 */
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface HealthData {
  healthy: boolean;
  generatedAt: string;
  parser: {
    version: string;
    ok: boolean;
    detail?: string;
    selfTest?: {
      fixture: string;
      parseMs: number;
      phaseCount: number | null;
      hasDiagnosticSummary: boolean;
      warnings: number;
    };
  };
  models: Record<string, { provider: string; configured: boolean; voiceId?: string; model?: string; browserFallback?: boolean }>;
  knowledge: {
    ok?: boolean;
    totalSources?: number;
    activeApprovedSources?: number;
    totalChunks?: number;
    metadataOnlyChunks?: number | null;
    fullTextChunks?: number | null;
    chunkSchemaVersion?: string;
    hasPageColumn?: boolean;
    hasSectionColumn?: boolean;
    ragFunctional?: boolean;
    ragStatus?: string;
    activation?: string;
    detail?: string;
  };
  evals: {
    recent: Array<{ finishedAt: string; totalCases: number; passedCases: number; failedCases: number; unsafeOverclaimCount: number; flagF1: number }>;
    lastGatePassed?: boolean | null;
    detail?: string;
  };
}

/** Human label for the honest RAG status pill (non-functional states). */
function ragStatusLabel(status: string | undefined, totalChunks: number | undefined): string {
  switch (status) {
    case "metadata_only": return "metadata only";
    case "sources_present_no_chunks": return "no chunks";
    case "empty": return "empty";
    default: return (totalChunks ?? 0) === 0 ? "no chunks" : "needs indexing";
  }
}
/** "n" for a number, "n/a (legacy)" when the count is indeterminable (null). */
function fmtChunks(n: number | null | undefined): string {
  return n == null ? "n/a (legacy schema)" : String(n);
}
function yn(b: boolean | undefined): string {
  return b ? "yes" : "no";
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      data-testid={`health-pill-${ok ? "ok" : "bad"}`}
      style={{
        fontSize: 11,
        padding: "2px 10px",
        borderRadius: 999,
        border: `1px solid ${ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
        color: ok ? "#4ade80" : "#f87171",
        background: ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

export default function ParserHealthPage() {
  const { session } = useAuth();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/parser-health", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchHealth(); }, [session]);

  return (
    <AdminGuard>
      <AdminLayout title="Parser & Model Health">
        <div data-testid="parser-health-page" style={{ maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button
              onClick={() => void fetchHealth()}
              data-testid="health-refresh"
              style={{
                fontSize: 12, padding: "6px 14px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: "var(--color-text-primary, #e5e7eb)", cursor: "pointer",
              }}
            >
              Refresh
            </button>
            {data && <Pill ok={data.healthy} label={data.healthy ? "All systems nominal" : "Attention needed"} />}
          </div>

          {loading && <p style={{ fontSize: 13, opacity: 0.6 }}>Running health checks…</p>}
          {error && (
            <div style={{ ...CARD, borderColor: "rgba(239,68,68,0.3)", color: "#f87171" }} data-testid="health-error">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Parser */}
              <div style={CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>Deterministic Parser</strong>
                  <Pill ok={data.parser.ok} label={data.parser.ok ? "healthy" : "failing"} />
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
                  <div>Version: <code>{data.parser.version}</code></div>
                  {data.parser.selfTest && (
                    <>
                      <div>Self-test fixture: <code>{data.parser.selfTest.fixture}</code></div>
                      <div>Parse time: {data.parser.selfTest.parseMs} ms</div>
                      <div>Phases produced: {data.parser.selfTest.phaseCount ?? "—"}</div>
                      <div>Diagnostic summary: {data.parser.selfTest.hasDiagnosticSummary ? "yes" : "no"}</div>
                      <div>Warnings: {data.parser.selfTest.warnings}</div>
                    </>
                  )}
                  {data.parser.detail && <div style={{ color: "#f87171" }}>{data.parser.detail}</div>}
                </div>
              </div>

              {/* Models */}
              <div style={CARD}>
                <strong style={{ fontSize: 14, display: "block", marginBottom: 10 }}>AI Integrations</strong>
                {Object.entries(data.models).map(([key, m]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 12 }}>
                      <strong>{key}</strong> <span style={{ opacity: 0.6 }}>· {m.provider}{m.model ? ` · ${m.model}` : ""}{m.voiceId ? ` · voice ${m.voiceId}` : ""}</span>
                      {m.browserFallback && <span style={{ opacity: 0.6 }}> · browser fallback ✓</span>}
                    </div>
                    <Pill ok={m.configured} label={m.configured ? "configured" : "not configured"} />
                  </div>
                ))}
                <p style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>
                  "Not configured" means the server env key is absent; the app still runs with deterministic output and browser-voice fallback.
                </p>
              </div>

              {/* Knowledge */}
              <div style={CARD} data-testid="admin-knowledge-health">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>Knowledge Base (RAG)</strong>
                  {data.knowledge.ok !== false && (
                    <Pill
                      ok={data.knowledge.ragFunctional === true}
                      label={
                        data.knowledge.ragFunctional === true
                          ? "RAG functional"
                          : ragStatusLabel(data.knowledge.ragStatus, data.knowledge.totalChunks)
                      }
                    />
                  )}
                </div>
                {data.knowledge.ok !== false ? (
                  <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.7 }} data-rag-status={data.knowledge.ragStatus ?? ""} data-rag-functional={String(data.knowledge.ragFunctional ?? "")}>
                    <div>Total sources: {data.knowledge.totalSources ?? 0}</div>
                    <div>Active + approved: {data.knowledge.activeApprovedSources ?? 0}</div>
                    <div>Total chunks: <strong>{data.knowledge.totalChunks ?? 0}</strong></div>
                    <div>· Full-text chunks: {fmtChunks(data.knowledge.fullTextChunks)}</div>
                    <div>· Metadata-only chunks: {fmtChunks(data.knowledge.metadataOnlyChunks)}</div>
                    <div style={{ marginTop: 6 }}>
                      Schema: <strong>{data.knowledge.chunkSchemaVersion ?? "?"}</strong>
                      {" "}({data.knowledge.hasPageColumn && data.knowledge.hasSectionColumn ? "native page/section" : "legacy — fallback mode"})
                    </div>
                    <div>page column: {yn(data.knowledge.hasPageColumn)} · section column: {yn(data.knowledge.hasSectionColumn)}</div>
                    {/* Explicit honest state banner */}
                    {data.knowledge.ragFunctional !== true && (
                      <div
                        data-testid="admin-rag-activation"
                        style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "hsl(38 92% 50% / 0.10)", border: "1px solid hsl(38 92% 50% / 0.3)", color: "#fbbf24", fontSize: 11.5, lineHeight: 1.5 }}
                      >
                        <strong>
                          {(data.knowledge.totalChunks ?? 0) === 0
                            ? "Sources present, no chunks — RAG not functional."
                            : "Metadata-only chunks — not full-text RAG."}
                        </strong>
                        {data.knowledge.activation ? <div style={{ marginTop: 3 }}>{data.knowledge.activation}</div> : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#f87171" }}>{data.knowledge.detail}</div>
                )}
              </div>

              {/* Evals */}
              <div style={CARD}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>Recent Regression Runs</strong>
                  {data.evals.lastGatePassed != null && (
                    <Pill ok={data.evals.lastGatePassed} label={data.evals.lastGatePassed ? "gate passing" : "gate failing"} />
                  )}
                </div>
                {data.evals.recent.length > 0 ? (
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ opacity: 0.6, textAlign: "left" }}>
                        <th style={{ padding: "4px 0" }}>Finished</th>
                        <th>Passed</th>
                        <th>Failed</th>
                        <th>Overclaims</th>
                        <th>Flag F1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.evals.recent.map((r, i) => (
                        <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "4px 0" }}>{new Date(r.finishedAt).toLocaleString()}</td>
                          <td>{r.passedCases}/{r.totalCases}</td>
                          <td style={{ color: r.failedCases ? "#f87171" : undefined }}>{r.failedCases}</td>
                          <td style={{ color: r.unsafeOverclaimCount ? "#f87171" : undefined }}>{r.unsafeOverclaimCount}</td>
                          <td>{r.flagF1?.toFixed?.(3) ?? r.flagF1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: 12, opacity: 0.5 }}>{data.evals.detail ?? "No eval history."}</p>
                )}
              </div>

              <p style={{ fontSize: 11, opacity: 0.4 }}>Generated {new Date(data.generatedAt).toLocaleString()}</p>
            </>
          )}
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
