/**
 * Ask ATOM relevance-ranked retrieval — deterministic unit tests.
 *
 * Guarantees the safe-improvement contract: retrieval RANKS sources by query
 * relevance but never *removes* grounding relative to the old static top-N
 * behavior (falls back to original order for empty/stopword queries, backfills
 * to `limit` when few sources match).
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreSource,
  rankKnowledgeSources,
} from "../../_knowledgeRetrieval.js";
import type { KnowledgeSource } from "../../_knowledgeCache.js";

function src(
  id: string,
  title: string,
  abstract = "",
  claims: string[] = [],
): KnowledgeSource {
  return {
    id,
    title,
    authors: "Author",
    year: 2020,
    url: null,
    publication_type: "journal",
    abstract,
    key_claims: claims,
  };
}

const CORPUS: KnowledgeSource[] = [
  src("a", "Sympathovagal balance in orthostatic intolerance",
    "LFa/RFa ratio and standing sympathetic response in POTS patients.",
    ["Standing sympathetic excess raises LFa/RFa", "POTS shows exaggerated heart rate rise"]),
  src("b", "Deep breathing and parasympathetic vagal tone",
    "E/I ratio reflects cardiovagal function during deep breathing.",
    ["E/I ratio is a cardiovagal reflex measure"]),
  src("c", "Valsalva maneuver adrenergic baroreflex",
    "Valsalva ratio quantifies adrenergic and baroreflex integrity.",
    ["Valsalva ratio grades baroreflex"]),
  src("d", "Sudomotor sweat testing overview",
    "QSART and sudomotor axon reflex testing for small fiber neuropathy.",
    ["Sudomotor testing detects small fiber loss"]),
  src("e", "General autonomic testing review",
    "Overview of the Ewing battery and cardiovascular autonomic reflex tests.",
    ["Ewing battery includes E/I, Valsalva, 30:15"]),
];

describe("tokenize", () => {
  it("drops stopwords and short tokens, lowercases", () => {
    expect(tokenize("What is the LFa RFa balance?")).toEqual(["lfa", "rfa", "balance"]);
  });
  it("returns empty for a stopword-only query", () => {
    expect(tokenize("what is the a an of")).toEqual([]);
  });
});

describe("scoreSource", () => {
  it("scores breadth of matched query terms above single-term repetition", () => {
    const broad = scoreSource(CORPUS[0], ["sympathetic", "standing", "pots"]);
    const narrow = scoreSource(CORPUS[3], ["sympathetic", "standing", "pots"]);
    expect(broad.score).toBeGreaterThan(narrow.score);
    expect(broad.matched.length).toBeGreaterThan(0);
  });
  it("returns zero when nothing matches", () => {
    expect(scoreSource(CORPUS[3], ["valsalva", "baroreflex"]).score).toBe(0);
  });
});

describe("rankKnowledgeSources", () => {
  it("ranks the most relevant source first for a focused query", () => {
    const ranked = rankKnowledgeSources(CORPUS, "standing sympathetic POTS response", 3);
    expect(ranked[0].id).toBe("a");
    expect(ranked.length).toBe(3);
  });

  it("surfaces the Valsalva source for a Valsalva question", () => {
    const ranked = rankKnowledgeSources(CORPUS, "what does my Valsalva ratio and baroreflex mean", 2);
    expect(ranked[0].id).toBe("c");
  });

  it("falls back to original order for a stopword-only query (no grounding lost)", () => {
    const ranked = rankKnowledgeSources(CORPUS, "what is the of", 3);
    expect(ranked.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("backfills to `limit` when fewer sources match the query", () => {
    // Only 'd' matches 'sudomotor', but limit 3 → backfill with original order.
    const ranked = rankKnowledgeSources(CORPUS, "sudomotor", 3);
    expect(ranked[0].id).toBe("d");
    expect(ranked.length).toBe(3);
    expect(new Set(ranked.map((s) => s.id)).size).toBe(3); // no duplicates
  });

  it("never returns more than `limit`, and is stable/deterministic", () => {
    const a = rankKnowledgeSources(CORPUS, "autonomic reflex Ewing", 4);
    const b = rankKnowledgeSources(CORPUS, "autonomic reflex Ewing", 4);
    expect(a.length).toBeLessThanOrEqual(4);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it("handles an empty corpus", () => {
    expect(rankKnowledgeSources([], "anything", 5)).toEqual([]);
  });
});
