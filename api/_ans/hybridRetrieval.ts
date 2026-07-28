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

export type RetrievalMode = "vector" | "lexical";

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
 * Retrieve candidate passages for a question.
 *
 * @param admin        service-role Supabase client
 * @param query        the user's latest question
 * @param lexicalFetch loader for the lexical path (usually getCandidatePassages)
 */
export async function retrieveCandidates(
  admin: SupabaseLike,
  query: string,
  lexicalFetch: () => Promise<PassageRow[]>,
  opts: { matchCount?: number; matchThreshold?: number; preferVector?: boolean } = {},
): Promise<RetrievalOutcome> {
  const matchCount = opts.matchCount ?? 12;
  const matchThreshold = opts.matchThreshold ?? 0.05;
  const preferVector = opts.preferVector ?? true;

  if (preferVector && (query ?? "").trim().length > 0) {
    const attempt = await tryVector(admin, query, { matchCount, matchThreshold });
    if ("rows" in attempt) {
      return { rows: attempt.rows, mode: "vector", fallbackReason: null };
    }
    // Fall through to lexical, remembering why.
    const rows = await safeLexical(lexicalFetch);
    return { rows, mode: "lexical", fallbackReason: attempt.unavailable };
  }

  const rows = await safeLexical(lexicalFetch);
  return {
    rows,
    mode: "lexical",
    fallbackReason: preferVector ? "no query terms to embed" : "vector retrieval disabled by caller",
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
