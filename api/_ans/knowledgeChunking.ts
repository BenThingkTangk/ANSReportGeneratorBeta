/**
 * api/_ans/knowledgeChunking.ts
 *
 * Pure, DB-free helpers for the knowledge/RAG pipeline: text chunking, a
 * built-from-metadata fallback text, deterministic term-overlap chunk scoring,
 * and citation shaping. Extracted so both the admin upload/reindex paths and the
 * live Ask ATOM retrieval share ONE implementation, and so the scoring/citation
 * contract can be unit-tested without a Supabase instance.
 */

const CHUNK_SIZE = 3000; // ~800 tokens
const CHUNK_OVERLAP = 100;

/** Split text into ~800-token chunks with a small overlap. */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = (text ?? "").replace(/\r\n/g, "\n");
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    const piece = clean.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

/** Rough token estimate for a chunk (used only for the `tokens` column). */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * A knowledge source's metadata text (title + abstract + key claims), used to
 * seed chunks when no uploaded FILE exists. This is how the 13 seeded sources
 * become searchable without a file re-upload. `key_claims` may be an array of
 * strings or JSON.
 */
export function sourceMetadataText(src: {
  title?: string | null;
  abstract?: string | null;
  key_claims?: unknown;
}): string {
  const claims = Array.isArray(src.key_claims)
    ? (src.key_claims as unknown[]).filter((c) => typeof c === "string").join("\n")
    : "";
  return [src.title ?? "", src.abstract ?? "", claims]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "for", "on",
  "with", "as", "by", "at", "be", "this", "that", "it", "from", "what", "how",
  "why", "when", "which", "does", "do", "can", "should", "my", "i", "me",
  "you", "your", "about", "have", "has", "was", "were", "will", "would",
]);

export function tokenizeQuery(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
}

/**
 * Transparent term-overlap score for a chunk against query terms. Breadth
 * (distinct query terms matched) is weighted above raw density so a chunk
 * touching many facets of the question ranks above one repeating a single word.
 * Identical formula to the admin retrieval-test endpoint (kept in sync here).
 */
export function scoreChunk(content: string, terms: string[]): { score: number; matched: string[] } {
  const words = (content ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const total = Math.max(words.length, 1);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  const matched: string[] = [];
  let freqScore = 0;
  for (const term of terms) {
    const c = counts.get(term) ?? 0;
    if (c > 0) {
      matched.push(term);
      freqScore += c;
    }
  }
  if (matched.length === 0) return { score: 0, matched };
  const density = freqScore / total;
  const breadth = matched.length / terms.length;
  const score = Number((breadth * 0.7 + density * 100 * 0.3).toFixed(4));
  return { score, matched };
}

export interface RankedChunk<T> {
  chunk: T;
  score: number;
  matched: string[];
}

/**
 * Rank chunks by relevance to a query, returning the top `limit` with score>0.
 * Ties break by original order (stable). `getContent` reads the chunk text.
 */
export function rankChunks<T>(
  chunks: T[],
  query: string,
  getContent: (c: T) => string,
  limit = 6,
): RankedChunk<T>[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];
  return chunks
    .map((chunk, idx) => ({ chunk, idx, ...scoreChunk(getContent(chunk), terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map(({ chunk, score, matched }) => ({ chunk, score, matched }));
}
