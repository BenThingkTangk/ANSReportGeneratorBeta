/**
 * Curated-chunk ingestion contract (api/_ans/curatedChunks.ts).
 *
 * Retrieval in this app is deterministic lexical term-overlap over
 * ans_knowledge_chunks.content; the `embedding` column is never read or written
 * by any code path, so chunks with a NULL embedding are immediately
 * retrievable. These tests lock the validation/row-building rules for ingesting
 * externally-curated chunks: identity, idempotent indices, token recomputation,
 * schema-aware section/page, the reserved 'metadata' marker, and fail-closed
 * PHI rejection. Pure — no DB, no network.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  validateCuratedChunks,
  buildSectionLocator,
  scanForPhi,
  MAX_CHUNKS,
  MAX_CONTENT_CHARS,
  MAX_SECTION_CHARS,
} from "../curatedChunks.js";
import { scoreChunk, tokenizeQuery } from "../knowledgeChunking.js";

const SRC = "b90cf06b-3141-4ba2-86cc-a165565faed5";
const full = { sourceId: SRC, hasSection: true, hasPage: true };

const chunk = (i: number, content: string, extra: Record<string, unknown> = {}) => ({
  chunk_index: i,
  content,
  ...extra,
});

describe("validateCuratedChunks — happy path", () => {
  const res = validateCuratedChunks(
    [
      chunk(0, "Sympathovagal balance is the ratio of LFa to RFa.", { section: "Foundations" }),
      chunk(1, "Parasympathetic excess behaves like driving with the brakes on.", { section: "Analogies", page: 4 }),
    ],
    full,
  );

  it("accepts the batch and returns insertable rows", () => {
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
  });

  it("stamps the target source_id on every row", () => {
    for (const r of res.rows) expect(r.source_id).toBe(SRC);
  });

  it("recomputes tokens from content (never trusts the file)", () => {
    const withBogusTokens = validateCuratedChunks(
      [chunk(0, "abcd".repeat(25), { tokens: 999999 })],
      full,
    );
    expect(withBogusTokens.ok).toBe(true);
    expect(withBogusTokens.rows[0].tokens).toBe(Math.ceil(100 / 4));
  });

  it("preserves the curator's section and page when the schema has them", () => {
    expect(res.rows[0].section).toBe("Foundations");
    expect(res.rows[1].page).toBe(4);
  });

  it("emits no embedding field — retrieval is lexical, vectors are not required", () => {
    for (const r of res.rows) expect(r).not.toHaveProperty("embedding");
  });

  it("sorts rows by chunk_index regardless of input order", () => {
    const out = validateCuratedChunks([chunk(2, "third"), chunk(0, "first"), chunk(1, "second")], full);
    expect(out.rows.map((r) => r.chunk_index)).toEqual([0, 1, 2]);
  });

  it("accepts string chunk_index / page (JSON files often stringify them)", () => {
    const out = validateCuratedChunks([{ chunk_index: "3", content: "text", page: "7" }], full);
    expect(out.ok).toBe(true);
    expect(out.rows[0].chunk_index).toBe(3);
    expect(out.rows[0].page).toBe(7);
  });
});

describe("extra curator fields are accepted, not rejected", () => {
  // The real batches carry timestamp_start / timestamp_end / provenance_note
  // alongside the known fields. Ingestion must not fail on them.
  const withExtras = {
    chunk_index: 0,
    content: "So the problem with the wellness score from the P&S test is that it is not a health rating.",
    section: "Wellness Score - Conceptual Foundations",
    timestamp_start: "00:08:27",
    timestamp_end: "00:11:54",
    provenance_note: "Speaker 3 (Joseph Colombo) only. Wording preserved verbatim.",
    source_id: SRC,
  };

  it("accepts a chunk carrying transcript metadata", () => {
    const r = validateCuratedChunks([withExtras], full);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("folds the timecodes into the section locator (provenance preserved compactly)", () => {
    const r = validateCuratedChunks([withExtras], full);
    expect(r.rows[0].section).toBe("Wellness Score - Conceptual Foundations — 00:08:27–00:11:54");
  });

  it("falls back to the provenance note when there is no section or timecode", () => {
    const r = validateCuratedChunks(
      [{ chunk_index: 0, content: "body", provenance_note: "Speaker 3 only" }],
      full,
    );
    expect(r.rows[0].section).toBe("Speaker 3 only");
  });

  it("handles a one-sided timecode", () => {
    expect(buildSectionLocator({ section: "S", timestamp_start: "00:01:00" })).toBe("S — from 00:01:00");
    expect(buildSectionLocator({ section: "S", timestamp_end: "00:02:00" })).toBe("S — to 00:02:00");
  });

  it("caps an over-long locator so it cannot crowd out the citation", () => {
    const loc = buildSectionLocator({ section: "x".repeat(400) });
    expect(loc.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
    expect(loc.endsWith("…")).toBe(true);
  });

  it("ignores unknown keys entirely rather than failing", () => {
    const r = validateCuratedChunks(
      [{ chunk_index: 0, content: "body", speaker: "S3", confidence: 0.9, _internal: { x: 1 } }],
      full,
    );
    expect(r.ok).toBe(true);
    expect(r.rows[0]).not.toHaveProperty("speaker");
    expect(r.rows[0]).not.toHaveProperty("confidence");
  });

  it("drops the enriched locator (with a warning) on a legacy DB", () => {
    const r = validateCuratedChunks([withExtras], { sourceId: SRC, hasSection: false, hasPage: false });
    expect(r.ok).toBe(true);
    expect(r.rows[0]).not.toHaveProperty("section");
    expect(r.warnings.join(" ")).toMatch(/section/i);
  });
});

describe("validateCuratedChunks — schema awareness (no migration 0005)", () => {
  const legacy = { sourceId: SRC, hasSection: false, hasPage: false };
  const res = validateCuratedChunks([chunk(0, "body text", { section: "Intro", page: 2 })], legacy);

  it("omits section/page rather than emitting a column the DB lacks", () => {
    expect(res.ok).toBe(true);
    expect(res.rows[0]).not.toHaveProperty("section");
    expect(res.rows[0]).not.toHaveProperty("page");
  });

  it("warns that the locator metadata was dropped", () => {
    expect(res.warnings.join(" ")).toMatch(/section/i);
    expect(res.warnings.join(" ")).toMatch(/page/i);
  });
});

describe("validateCuratedChunks — reserved 'metadata' section marker", () => {
  it("never writes section='metadata' (that marker means NOT full-text RAG)", () => {
    const res = validateCuratedChunks([chunk(0, "real full text", { section: "metadata" })], full);
    expect(res.ok).toBe(true);
    expect(res.rows[0].section).not.toBe("metadata");
    expect(res.rows[0].section).toMatch(/^curated: /);
  });
});

describe("validateCuratedChunks — fail closed", () => {
  const bad = (input: unknown, opts = full) => validateCuratedChunks(input, opts);

  it("rejects a non-UUID sourceId", () => {
    const r = bad([chunk(0, "x")], { ...full, sourceId: "not-a-uuid" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not a valid UUID/);
  });

  it("rejects a non-array, an empty array, and an oversized batch", () => {
    expect(bad({}).ok).toBe(false);
    expect(bad([]).ok).toBe(false);
    const huge = Array.from({ length: MAX_CHUNKS + 1 }, (_, i) => chunk(i, "x"));
    const r = bad(huge);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/too many chunks/);
  });

  it("rejects a chunk whose own source_id disagrees with the target", () => {
    const r = bad([{ chunk_index: 0, content: "x", source_id: "11111111-2222-3333-4444-555555555555" }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/does not match target/);
  });

  it("rejects duplicate, negative, and non-integer chunk_index", () => {
    expect(bad([chunk(0, "a"), chunk(0, "b")]).errors[0]).toMatch(/duplicate chunk_index/);
    expect(bad([chunk(-1, "a")]).errors[0]).toMatch(/non-negative integer/);
    expect(bad([{ chunk_index: "abc", content: "a" }]).errors[0]).toMatch(/non-negative integer/);
  });

  it("rejects empty and oversized content", () => {
    expect(bad([chunk(0, "   ")]).errors[0]).toMatch(/content is empty/);
    expect(bad([chunk(0, "x".repeat(MAX_CONTENT_CHARS + 1))]).errors[0]).toMatch(/content too long/);
  });

  it("rejects the WHOLE batch when any chunk fails (no partial corpus)", () => {
    const r = bad([chunk(0, "good text"), chunk(1, "")]);
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
  });
});

describe("PHI guard — knowledge chunks must carry no patient data", () => {
  it("flags identifiers", () => {
    expect(scanForPhi("SSN 123-45-6789")).toContain("SSN-like number");
    expect(scanForPhi("MRN: 8842119")).toContain("medical record number");
    expect(scanForPhi("DOB: 9/17/1975")).toContain("date of birth");
    expect(scanForPhi("contact soleary@physiops.com")).toContain("email address");
    expect(scanForPhi("recorded 7/11/2024")).toContain("explicit calendar date (possible DOB)");
  });

  it("does NOT flag ordinary clinical teaching prose", () => {
    expect(scanForPhi("This patient's body is constantly hitting the brakes.")).toEqual([]);
    expect(scanForPhi("A 48-year-old with an E/I ratio of 1.22 and SB = 2.59.")).toEqual([]);
    expect(scanForPhi("Parasympathetic excess (PE) is treated with low-dose nortriptyline 10 mg.")).toEqual([]);
  });

  it("refuses a batch containing PHI", () => {
    const r = validateCuratedChunks([chunk(0, "fine"), chunk(1, "Patient DOB: 1/2/1980")], full);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/no patient data/i);
    expect(r.rows).toEqual([]);
  });
});

describe("ingested rows are retrievable by the lexical ranker (no embeddings)", () => {
  it("scoreChunk matches a query against the stored content", () => {
    const res = validateCuratedChunks(
      [chunk(0, "The wellness score from the P&S test measures sympathovagal balance, not overall health.")],
      full,
    );
    const terms = tokenizeQuery("What does the wellness score measure?");
    const { score, matched } = scoreChunk(res.rows[0].content, terms);
    expect(score).toBeGreaterThan(0);
    expect(matched).toContain("wellness");
    expect(matched).toContain("score");
  });
});

/**
 * The actual curated batch this endpoint was built for. The file lives outside
 * the repo (it is operator input, not committed content), so the suite skips
 * when it is absent rather than failing on another machine.
 */
describe("real curated batch — colombo_0409_rag_chunks.json", () => {
  const REAL = "/home/user/workspace/colombo_0409_rag_chunks.json";
  const present = existsSync(REAL);
  const load = () => JSON.parse(readFileSync(REAL, "utf8"));

  it.skipIf(!present)("validates cleanly on the 0005 schema (16 rows, no PHI)", () => {
    const r = validateCuratedChunks(load(), full);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(16);
    expect(r.rows.map((x) => x.chunk_index)).toEqual([...Array(16).keys()]);
    for (const row of r.rows) {
      expect(row.source_id).toBe(SRC);
      expect(row.tokens).toBeGreaterThan(0);
      expect(row.section).toBeTruthy();
      expect(row.section).not.toBe("metadata");
      // The batch's timestamp_start/timestamp_end are preserved in the locator.
      expect(row.section).toMatch(/\d{2}:\d{2}:\d{2}–\d{2}:\d{2}:\d{2}/);
    }
  });

  it.skipIf(!present)("also validates on a legacy DB, warning that section is dropped", () => {
    const r = validateCuratedChunks(load(), { sourceId: SRC, hasSection: false, hasPage: false });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(16);
    expect(r.warnings.join(" ")).toMatch(/section/i);
  });

  it.skipIf(!present)("produces chunks the lexical ranker actually retrieves", () => {
    const r = validateCuratedChunks(load(), full);
    const terms = tokenizeQuery("What does the wellness score actually measure?");
    const hits = r.rows.filter((row) => scoreChunk(row.content, terms).score > 0);
    expect(hits.length).toBeGreaterThan(0);
  });
});
