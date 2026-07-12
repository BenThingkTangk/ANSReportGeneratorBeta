/**
 * /admin/retrieval-test — RAG retrieval diagnostic.
 *
 * Type a clinical question and see exactly which approved knowledge chunks
 * would be surfaced to ground an answer, with a transparent relevance score
 * and the matched terms. Lets admins confirm the corpus actually covers a
 * topic before trusting the chat on it.
 */
import { useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

interface RetrievalResult {
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  tokens: number | null;
  score: number;
  matchedTerms: string[];
  snippet: string;
  source: {
    id: string;
    title: string;
    authors: string | null;
    year: number | null;
    publicationType: string | null;
    active: boolean;
    reviewStatus: string | null;
  };
}

export default function RetrievalTestPage() {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [meta, setMeta] = useState<{ terms: string[]; candidatesScanned: number; resultCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTest(e?: React.FormEvent) {
    e?.preventDefault();
    if (!session?.access_token || !query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/admin/retrieval-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query: query.trim(), activeOnly, limit: 15 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setResults(json.results);
      setMeta({ terms: json.terms, candidatesScanned: json.candidatesScanned, resultCount: json.resultCount });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminGuard>
      <AdminLayout title="Retrieval Test">
        <div data-testid="retrieval-test-page" style={{ maxWidth: 820 }}>
          <form onSubmit={runTest} style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>
              Query — a clinical question or topic to retrieve against the knowledge chunks
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                data-testid="retrieval-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. parasympathetic excess treatment, cardiovagal neuropathy…"
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: 8, fontSize: 13,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "var(--color-text-primary, #e5e7eb)",
                }}
              />
              <button
                type="submit"
                data-testid="retrieval-run"
                disabled={loading || !query.trim()}
                style={{
                  padding: "10px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  background: "hsl(185 85% 42%)", border: "none", color: "#04141b", fontWeight: 600,
                  opacity: loading || !query.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
            <label style={{ fontSize: 12, opacity: 0.7, display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} data-testid="retrieval-active-only" />
              Only active + approved sources (what the live AI path retrieves)
            </label>
          </form>

          {error && (
            <div style={{ padding: 14, borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 13 }} data-testid="retrieval-error">
              {error}
            </div>
          )}

          {meta && (
            <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }} data-testid="retrieval-meta">
              Scanned {meta.candidatesScanned} chunk(s); {meta.resultCount} matched. Search terms: {meta.terms.map((t) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}
            </p>
          )}

          {results && results.length === 0 && (
            <p style={{ fontSize: 13, opacity: 0.6 }} data-testid="retrieval-empty">
              No chunks matched. Either the corpus doesn't cover this topic, or no active+approved source contains these terms.
            </p>
          )}

          {results && results.map((r, i) => (
            <div
              key={r.chunkId}
              data-testid="retrieval-result"
              style={{
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 16, marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>
                  #{i + 1} · {r.source.title}
                  {r.source.year ? <span style={{ opacity: 0.6 }}> ({r.source.year})</span> : null}
                </strong>
                <span style={{ fontSize: 12, opacity: 0.7, whiteSpace: "nowrap" }}>score {r.score}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
                {r.source.authors ? r.source.authors + " · " : ""}chunk #{r.chunkIndex}
                {r.tokens ? ` · ${r.tokens} tokens` : ""}
                {" · "}matched: {r.matchedTerms.join(", ")}
                {!r.source.active && <span style={{ color: "#fbbf24" }}> · source inactive</span>}
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.6, opacity: 0.85, margin: 0 }}>{r.snippet}</p>
            </div>
          ))}
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
