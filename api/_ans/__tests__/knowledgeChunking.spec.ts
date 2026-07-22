/**
 * RAG chunking + retrieval contract (DB-free).
 *
 * Exercises the shared pipeline that both the admin ingestion/reindex path and
 * the retrieval-test endpoint use: metadata→text, chunking, term-overlap
 * scoring, ranking, and source/page citation shaping. Uses a SEEDED corpus that
 * mirrors the shape of the 13 approved knowledge sources (title + abstract +
 * key_claims) so we assert real retrieval relevance and citation output without
 * a Supabase instance.
 */
import { describe, it, expect } from "vitest";
import {
  chunkText,
  estimateTokens,
  sourceMetadataText,
  tokenizeQuery,
  scoreChunk,
  rankChunks,
} from "../knowledgeChunking.js";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("Sympathovagal balance is LFa over RFa.")).toEqual([
      "Sympathovagal balance is LFa over RFa.",
    ]);
  });
  it("splits long text with overlap and drops empties", () => {
    const text = "x".repeat(7000);
    const chunks = chunkText(text, 3000, 100);
    expect(chunks.length).toBe(3); // 3000, 3000, remainder (with 100 overlap)
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });
  it("estimateTokens is ~chars/4", () => {
    expect(estimateTokens("abcd".repeat(25))).toBe(25);
  });
});

describe("sourceMetadataText — builds searchable text from seeded source rows", () => {
  it("joins title + abstract + string key_claims (jsonb array)", () => {
    const text = sourceMetadataText({
      title: "Clinical Autonomic Dysfunction",
      abstract: "Independent P&S monitoring of parasympathetic and sympathetic activity.",
      key_claims: [
        "LFa/RFa ratio between 0.4 and 3.0 defines the resting normal window.",
        "Six-phase test is the diagnostic standard.",
      ],
    });
    expect(text).toContain("Clinical Autonomic Dysfunction");
    expect(text).toContain("0.4 and 3.0");
    expect(text).toContain("Six-phase test");
  });
  it("tolerates null abstract / non-array key_claims", () => {
    expect(sourceMetadataText({ title: "T", abstract: null, key_claims: null })).toBe("T");
  });
});

// A seeded corpus shaped like the real approved sources → one metadata chunk each.
const SEED = [
  {
    id: "src-cad",
    title: "Clinical Autonomic Dysfunction: Measurement, Indications, Therapies",
    year: 2019,
    abstract: "Independent parasympathetic (RFa) and sympathetic (LFa) monitoring; six-phase P&S protocol.",
    key_claims: ["LFa/RFa between 0.4 and 3.0 is the resting normal window; below 0.4 is parasympathetic excess."],
    page: 12,
  },
  {
    id: "src-pots",
    title: "Postural Orthostatic Tachycardia and the Stand Response",
    year: 2022,
    abstract: "Excessive heart rate rise on standing defines POTS; sympathetic overactivation on tilt.",
    key_claims: ["A stand heart-rate increment >=30 bpm meets POTS criteria."],
    page: 4,
  },
  {
    id: "src-valsalva",
    title: "Valsalva Ratio and Baroreflex Integrity",
    year: 2020,
    abstract: "The Valsalva ratio grades adrenergic baroreflex function during strain.",
    key_claims: ["A reduced Valsalva ratio indicates impaired baroreflex."],
    page: 7,
  },
] as const;

// Simulate the chunk rows the reindex/ingest path would write.
interface ChunkRow { source_id: string; chunk_index: number; content: string; page: number; title: string; year: number; }
const CHUNKS: ChunkRow[] = SEED.map((s) => ({
  source_id: s.id,
  chunk_index: 0,
  content: sourceMetadataText(s),
  page: s.page,
  title: s.title,
  year: s.year,
}));

describe("tokenizeQuery + scoreChunk", () => {
  it("drops stopwords and matches multiple distinct query terms (breadth)", () => {
    const terms = tokenizeQuery("what does my sympathovagal balance and parasympathetic mean");
    expect(terms).not.toContain("what");
    expect(terms).toEqual(expect.arrayContaining(["sympathovagal", "balance", "parasympathetic", "mean"]));
    // A realistic passage touching 3 of the query terms matches broadly.
    const broad = scoreChunk(
      "The sympathovagal balance reflects parasympathetic and sympathetic tone across the six-phase autonomic protocol used in clinical practice.",
      terms,
    );
    expect(broad.matched).toEqual(expect.arrayContaining(["sympathovagal", "balance", "parasympathetic"]));
    expect(broad.score).toBeGreaterThan(0);
    // A passage matching only one term (in a comparably long document) scores lower.
    const narrow = scoreChunk(
      "The balance of a patient's fluid intake and daily activity is discussed at length across many unrelated clinical topics here.",
      terms,
    );
    expect(broad.score).toBeGreaterThan(narrow.score);
  });
  it("scores zero when nothing matches", () => {
    expect(scoreChunk("unrelated content about weather", tokenizeQuery("valsalva baroreflex")).score).toBe(0);
  });
});

describe("rankChunks — query-ranked retrieval over the seeded corpus", () => {
  it("returns the POTS chunk first for a standing-tachycardia question", () => {
    const ranked = rankChunks(CHUNKS, "why does my heart rate spike when I stand up (POTS)?", (c) => c.content, 3);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].chunk.source_id).toBe("src-pots");
  });

  it("returns the Valsalva chunk first for a baroreflex question", () => {
    const ranked = rankChunks(CHUNKS, "what does the Valsalva ratio say about baroreflex?", (c) => c.content, 3);
    expect(ranked[0].chunk.source_id).toBe("src-valsalva");
  });

  it("returns the CAD chunk first for a sympathovagal-window question", () => {
    const ranked = rankChunks(CHUNKS, "what is the normal resting LFa/RFa sympathovagal window?", (c) => c.content, 3);
    expect(ranked[0].chunk.source_id).toBe("src-cad");
  });

  it("returns nothing for a stopword-only query (no fabricated grounding)", () => {
    expect(rankChunks(CHUNKS, "what is the of a an", (c) => c.content, 3)).toEqual([]);
  });

  it("emits a source/page citation for each ranked chunk", () => {
    const ranked = rankChunks(CHUNKS, "POTS standing heart rate", (c) => c.content, 3);
    const top = ranked[0].chunk;
    const citation = `${top.title} (${top.year}), p.${top.page}`;
    expect(citation).toBe("Postural Orthostatic Tachycardia and the Stand Response (2022), p.4");
    // matched terms are surfaced for explainability
    expect(ranked[0].matched.length).toBeGreaterThan(0);
  });

  it("caps results at `limit`", () => {
    const ranked = rankChunks(CHUNKS, "autonomic sympathetic parasympathetic balance POTS valsalva", (c) => c.content, 2);
    expect(ranked.length).toBeLessThanOrEqual(2);
  });
});

describe("RAG honesty — 0 chunks means no retrieval", () => {
  it("an empty corpus yields no results (never invented)", () => {
    expect(rankChunks([], "sympathovagal balance", (c: any) => c.content, 5)).toEqual([]);
  });
});
