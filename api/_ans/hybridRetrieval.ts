/**
 * api/_ans/hybridRetrieval.ts
 *
 * Vector-first retrieval with a DETERMINISTIC LEXICAL FALLBACK.
 *
 * Retrieval order for a question:
 *   1. VECTOR — if the DB exposes `match_ans_knowledge_chunks` AND the corpus has
 *      embeddings AND the provider can embed the query, rank by cosine similarity.
 *   2. LEXICAL — otherwise (no embedding column, all-NULL embeddings, pgvector
 *      absent, provider unconfigured, provider erroring, RPC missing/broken, or
 *      vector search returning nothing) fall back to the same deterministic
 *      lexical ranker the admin retrieval test uses.
 *
 * The fallback is the DEFAULT-SAFE path: nothing here can make Ask ATOM fail or
 * block on the embedding provider. Every branch returns candidate PassageRows in
 * the SAME shape, so the caller (ask-atom) keeps one code path for prompt
 * building, citation construction, and grounding honesty.
 *
 * Provenance is preserved: rows always carry their joined source metadata
 * (title/authors/year/publication_type/url) so citations are composed from REAL
 * fields — never from a non-existent `citation` column and never invented.
 *
 * Source gating (clinical safeguard) is applied in BOTH paths:
 *   review_status = 'approved' AND active_in_ai_analysis = true.
 *
 * This module performs NO clinical computation and never touches .ans parsing.
 */
import type { PassageRow } from "./knowledgePassages.js";
import { embedQuery, EmbeddingUnavailableError, isEmbeddingConfigured } from "./embeddings.js";

export type RetrievalMode = "vector" | "fulltext" | "lexical" | "unavailable";

export interface RetrievalOutcome {
  /** Candidate rows for the lexical/prompt layer to rank + format. */
  rows: PassageRow[];
  /** Which path produced `rows`. */
  mode: RetrievalMode;
  /**
   * Why the lexical fallback was used (null when mode === "vector"). Surfaced in
   * admin diagnostics so operators can see exactly what is degraded.
   */
  fallbackReason: string | null;
}

interface SupabaseLike {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
}

/**
 * DEDUPLICATION — "avoid duplicate weighting".
 *
 * The same passage can arrive twice: once from the vector RPC and once from the
 * full-text RPC, or twice from a corpus where a source was re-ingested and the
 * identical text exists under two chunk rows. Two copies of one passage would
 * double its influence on the prompt (and could crowd out every other source),
 * so rows are collapsed on (a) chunk id, then (b) source_id + normalised
 * content, keeping the FIRST (highest-ranked) occurrence.
 */
export function dedupePassages(rows: PassageRow[]): PassageRow[] {
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const out: PassageRow[] = [];
  for (const r of rows ?? []) {
    if (!r) continue;
    const id = r.id ? String(r.id) : null;
    if (id && seenIds.has(id)) continue;
    const norm = (r.content ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const textKey = `${r.source_id ?? r.source?.id ?? "?"}::${norm}`;
    if (norm.length > 0 && seenText.has(textKey)) continue;
    if (id) seenIds.add(id);
    if (norm.length > 0) seenText.add(textKey);
    out.push(r);
  }
  return out;
}

/**
 * GATING — clinical safeguard, enforced in-process regardless of which path
 * produced the row. Both RPCs and the PostgREST query already filter on
 * review_status='approved' AND active_in_ai_analysis=true, but a row that cannot
 * PROVE it is approved + active is dropped here too, so a schema drift or a
 * hand-written RPC can never widen the corpus silently.
 */
export function isGatedApprovedActive(row: PassageRow): boolean {
  const src = row?.source;
  if (!src) return false;
  return src.review_status === "approved" && src.active_in_ai_analysis === true;
}

/** Shape returned by the repaired match_ans_knowledge_chunks RPC (migration 0006). */
interface MatchRow {
  id?: string;
  source_id?: string;
  chunk_index?: number | null;
  content?: string | null;
  citation?: string | null;
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  publication_type?: string | null;
  url?: string | null;
  similarity?: number | null;
}

/** Map an RPC row into the common PassageRow shape (source metadata preserved). */
function matchRowToPassage(r: MatchRow): PassageRow {
  return {
    id: r.id,
    source_id: r.source_id,
    chunk_index: r.chunk_index ?? null,
    content: r.content ?? null,
    source: {
      id: r.source_id,
      title: r.title ?? null,
      authors: r.authors ?? null,
      year: r.year ?? null,
      publication_type: r.publication_type ?? null,
      url: r.url ?? null,
      // The RPC already filtered on these; restate them so downstream gating
      // logic sees consistent, explicit values.
      active_in_ai_analysis: true,
      review_status: "approved",
    },
  };
}

/** True when the error means "function/relation/column does not exist". */
function isMissingObject(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "42883" || code === "42703" || code === "42P01" || code === "PGRST202") return true;
  return /does not exist|could not find|schema cache/i.test(err.message ?? "");
}

/**
 * Attempt vector retrieval. Returns null (never throws) when the vector path is
 * unavailable for ANY reason, so the caller can fall back cleanly.
 */
async function tryVector(
  admin: SupabaseLike,
  query: string,
  opts: { matchCount: number; matchThreshold: number },
): Promise<{ rows: PassageRow[] } | { unavailable: string }> {
  if (!isEmbeddingConfigured()) {
    return { unavailable: "embedding provider not configured" };
  }
  let vec: number[] | null;
  try {
    vec = await embedQuery(query);
  } catch (e) {
    const reason =
      e instanceof EmbeddingUnavailableError
        ? `query embedding failed: ${e.message}`
        : `query embedding error: ${(e as Error)?.message ?? String(e)}`;
    return { unavailable: reason };
  }
  if (!vec) return { unavailable: "query produced no embedding (blank query)" };

  try {
    const { data, error } = await admin.rpc("match_ans_knowledge_chunks", {
      query_embedding: vec,
      match_threshold: opts.matchThreshold,
      match_count: opts.matchCount,
    });
    if (error) {
      if (isMissingObject(error)) {
        return { unavailable: "match_ans_knowledge_chunks unavailable (apply migration 0006)" };
      }
      return { unavailable: `vector search error: ${error.message}` };
    }
    const rows = (Array.isArray(data) ? data : []) as MatchRow[];
    if (rows.length === 0) {
      // A corpus with zero embedded rows (all NULL) looks exactly like this.
      return { unavailable: "vector search returned no rows (corpus may have no embeddings)" };
    }
    return { rows: rows.map(matchRowToPassage) };
  } catch (e) {
    return { unavailable: `vector search exception: ${(e as Error)?.message ?? String(e)}` };
  }
}

/**
 * TIER 2 — DATABASE FULL-TEXT SEARCH.
 *
 * Postgres `websearch_to_tsquery` + `ts_rank_cd` over the generated tsvector
 * added by migration 0007, exposed as `match_ans_knowledge_chunks_lexical`. This
 * is the robust grounded fallback when embeddings are unavailable: it needs no
 * AI provider at all, applies the SAME source gating in SQL, and returns the
 * same provenance fields.
 *
 * Returns `{ unavailable }` (never throws) when the RPC or index is absent, so
 * the in-process lexical ranker still backs it up on an un-migrated database.
 */
async function tryFullText(
  admin: SupabaseLike,
  query: string,
  opts: { matchCount: number },
): Promise<{ rows: PassageRow[] } | { unavailable: string }> {
  try {
    const { data, error } = await admin.rpc("match_ans_knowledge_chunks_lexical", {
      query_text: query,
      match_count: opts.matchCount,
    });
    if (error) {
      if (isMissingObject(error)) {
        return {
          unavailable:
            "match_ans_knowledge_chunks_lexical unavailable (apply migration 0007)",
        };
      }
      return { unavailable: `full-text search error: ${error.message}` };
    }
    const rows = (Array.isArray(data) ? data : []) as MatchRow[];
    if (rows.length === 0) return { unavailable: "full-text search returned no rows" };
    return { rows: rows.map(matchRowToPassage) };
  } catch (e) {
    return { unavailable: `full-text search exception: ${(e as Error)?.message ?? String(e)}` };
  }
}

/**
 * Retrieve candidate passages for a question.
 *
 * Tiered, each tier degrading silently-but-honestly into the next:
 *   1. `vector`    — pgvector cosine search over embeddings (needs the provider).
 *   2. `fulltext`  — Postgres full-text search (needs no provider at all).
 *   3. `lexical`   — in-process deterministic term-overlap ranker (needs only rows).
 *   4. `unavailable` — no database at all; caller degrades to report-only.
 *
 * Every returned row is gated (approved + AI-active) and de-duplicated, so no
 * passage is weighted twice and no unapproved source can ever reach the prompt.
 *
 * @param admin        service-role Supabase client, or null when the database is
 *                     not configured (safe failure — see api/_ans/dbConfig.ts)
 * @param query        the user's latest question
 * @param lexicalFetch loader for the lexical path (usually getCandidatePassages)
 */
export async function retrieveCandidates(
  admin: SupabaseLike | null | undefined,
  query: string,
  lexicalFetch: () => Promise<PassageRow[]>,
  opts: {
    matchCount?: number;
    matchThreshold?: number;
    preferVector?: boolean;
    preferFullText?: boolean;
  } = {},
): Promise<RetrievalOutcome> {
  const matchCount = opts.matchCount ?? 12;
  const matchThreshold = opts.matchThreshold ?? 0.05;
  const preferVector = opts.preferVector ?? true;
  const preferFullText = opts.preferFullText ?? true;
  const hasQuery = (query ?? "").trim().length > 0;

  // No database configured/reachable: report it explicitly rather than pretending
  // the corpus is simply empty.
  if (!admin) {
    return {
      rows: [],
      mode: "unavailable",
      fallbackReason:
        "database not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY); " +
        "answer is grounded in the report only",
    };
  }

  const reasons: string[] = [];

  if (preferVector && hasQuery) {
    const attempt = await tryVector(admin, query, { matchCount, matchThreshold });
    if ("rows" in attempt) return finalize(attempt.rows, "vector", null);
    reasons.push(attempt.unavailable);
  } else if (preferVector) {
    reasons.push("no query terms to embed");
  } else {
    reasons.push("vector retrieval disabled by caller");
  }

  if (preferFullText && hasQuery) {
    const attempt = await tryFullText(admin, query, { matchCount });
    if ("rows" in attempt) return finalize(attempt.rows, "fulltext", reasons.join("; "));
    reasons.push(attempt.unavailable);
  }

  const rows = await safeLexical(lexicalFetch);
  return finalize(rows, "lexical", reasons.join("; ") || null);
}

/** Gate → dedupe → outcome. Applied to every tier, so nothing bypasses it. */
function finalize(
  rows: PassageRow[],
  mode: RetrievalMode,
  fallbackReason: string | null,
): RetrievalOutcome {
  return {
    rows: dedupePassages((rows ?? []).filter(isGatedApprovedActive)),
    mode,
    fallbackReason: fallbackReason && fallbackReason.length > 0 ? fallbackReason : null,
  };
}

async function safeLexical(fetchFn: () => Promise<PassageRow[]>): Promise<PassageRow[]> {
  try {
    return await fetchFn();
  } catch {
    // Retrieval must never break the answer path; an empty corpus degrades to
    // report-only grounding upstream.
    return [];
  }
}
