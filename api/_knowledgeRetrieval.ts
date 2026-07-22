/**
 * api/_knowledgeRetrieval.ts
 *
 * Deterministic, explainable term-overlap ranking used to select the MOST
 * RELEVANT knowledge sources for a given user query, instead of always
 * injecting the same static top-N. No embeddings (none exist in the schema
 * yet), so the ranking is fully transparent and testable offline.
 *
 * This is the same scoring approach as the admin retrieval-test endpoint,
 * factored out so the live Ask ATOM path can reuse it. When the query has no
 * searchable terms (only stopwords), callers fall back to the original order.
 */
import type { KnowledgeSource } from "./_knowledgeCache.js";

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "for", "on",
  "with", "as", "by", "at", "be", "this", "that", "it", "from", "what", "how",
  "why", "when", "which", "does", "do", "can", "should", "my", "i", "me",
  "you", "your", "about", "have", "has", "was", "were", "will", "would",
]);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
}

/** The searchable text of a source: title + abstract + key claims. */
function sourceText(s: KnowledgeSource): string {
  const claims = Array.isArray(s.key_claims)
    ? (s.key_claims as unknown[]).filter((c) => typeof c === "string").join(" ")
    : "";
  return [s.title ?? "", s.abstract ?? "", claims].join(" ");
}

/**
 * Transparent term-overlap score for a source against query terms. Breadth
 * (distinct query terms matched) is weighted above raw density so a source
 * touching many facets of the question ranks above one repeating a single word.
 */
export function scoreSource(
  s: KnowledgeSource,
  terms: string[],
): { score: number; matched: string[] } {
  const words = sourceText(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
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

/**
 * Rank knowledge sources by relevance to `query` and return the top `limit`.
 *
 * Scope/accuracy note: this REPLACES the previous "inject the first 12 sources
 * for every question" behavior with "inject the `limit` (default 6) MOST
 * RELEVANT sources". That is a deliberate trade — the set is smaller and more
 * focused, so total breadth can be LOWER than the old 12 when the corpus has
 * more than `limit` entries. What it does NOT do is drop a source that the old
 * path would have surfaced for THIS question while leaving a less-relevant one
 * in; ranking + backfill only re-order and cap.
 *
 * Behavior guarantees:
 *   - If the query has no searchable terms, return the first `limit` sources in
 *     their original (year-desc) order (a stable, relevance-agnostic fallback).
 *   - If fewer than `limit` sources match the query, backfill with the
 *     remaining sources in original order so the model still gets breadth.
 *   - Never returns more than `limit`; callers may pass a larger `limit` (e.g.
 *     12) to preserve the old breadth exactly while still ranking by relevance.
 */
export function rankKnowledgeSources(
  sources: KnowledgeSource[],
  query: string,
  limit = 6,
): KnowledgeSource[] {
  if (sources.length === 0) return [];
  const terms = tokenize(query);
  if (terms.length === 0) return sources.slice(0, limit);

  const scored = sources.map((s, idx) => ({ s, idx, ...scoreSource(s, terms) }));
  const matched = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const chosen: KnowledgeSource[] = matched.slice(0, limit).map((x) => x.s);
  if (chosen.length < limit) {
    const chosenIds = new Set(chosen.map((s) => s.id));
    for (const s of sources) {
      if (chosen.length >= limit) break;
      if (!chosenIds.has(s.id)) chosen.push(s);
    }
  }
  return chosen;
}
