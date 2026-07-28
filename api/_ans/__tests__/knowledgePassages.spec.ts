/**
 * Live ATOM full-text passage retrieval (api/_ans/knowledgePassages.ts).
 *
 * Before this, /api/ask-atom ranked only source METADATA; chunk rows merely
 * flipped a COUNT-based citation gate. These tests lock the passage selection
 * and prompt contract:
 *   • a relevant chunk IS injected, an irrelevant one is NOT;
 *   • inactive / unapproved sources can never be quoted;
 *   • section='metadata' placeholders are not full-text grounding;
 *   • passages are explanatory context only — they can never fill a patient
 *     value, alter a deterministic score, or become a computed diagnosis;
 *   • transcript passages are attributed speech needing clinician verification;
 *   • nothing relevant ⇒ empty block ⇒ caller falls back to metadata/no-RAG.
 * Pure — no DB, no network, no model call.
 */
import { describe, it, expect } from "vitest";
import {
  selectPassages,
  buildPassagePromptSection,
  isEligiblePassage,
  passageCitation,
  DEFAULT_MIN_SCORE,
  type PassageRow,
} from "../knowledgePassages.js";

const approvedSource = (over: Record<string, unknown> = {}) => ({
  id: "src-1",
  title: "Clinical Autonomic Dysfunction",
  authors: "DePace, Colombo",
  year: 2019,
  publication_type: "book",
  url: null,
  active_in_ai_analysis: true,
  review_status: "approved",
  ...over,
});

const row = (over: Partial<PassageRow> = {}): PassageRow => ({
  id: "c1",
  source_id: "src-1",
  chunk_index: 0,
  content: "Sympathovagal balance is the ratio of LFa to RFa measured at rest.",
  source: approvedSource(),
  ...over,
});

const WELLNESS = row({
  id: "c-wellness",
  chunk_index: 3,
  section: "Wellness Score — Foundations",
  content:
    "The wellness score from the P&S test reflects autonomic reserve; it is not a measure of overall health and should not be read as a general wellness rating.",
});
const UNRELATED = row({
  id: "c-unrelated",
  chunk_index: 9,
  section: "Sudomotor Testing",
  content:
    "Quantitative sudomotor axon reflex testing evaluates postganglionic sympathetic cholinergic fibers using iontophoresis of acetylcholine.",
});

const WELLNESS_QUERY = "What does the wellness score actually measure?";

describe("relevance selection", () => {
  it("INJECTS a chunk that is relevant to the question", () => {
    const sel = selectPassages([WELLNESS, UNRELATED], WELLNESS_QUERY);
    expect(sel.length).toBeGreaterThan(0);
    expect(sel[0].content).toMatch(/wellness score/i);
    expect(sel[0].score).toBeGreaterThanOrEqual(DEFAULT_MIN_SCORE);
  });

  it("EXCLUDES the irrelevant chunk from the same corpus", () => {
    const sel = selectPassages([WELLNESS, UNRELATED], WELLNESS_QUERY);
    expect(sel.map((p) => p.content).join(" ")).not.toMatch(/sudomotor|iontophoresis/i);
  });

  it("returns NOTHING when no chunk is relevant (safe fallback)", () => {
    const sel = selectPassages([UNRELATED], "How do I read my Valsalva ratio?");
    expect(sel).toEqual([]);
    expect(buildPassagePromptSection(sel)).toBe("");
  });

  it("returns NOTHING for a stopword-only question", () => {
    expect(selectPassages([WELLNESS], "what is it about?")).toEqual([]);
  });

  it("returns NOTHING for an empty corpus", () => {
    expect(selectPassages([], WELLNESS_QUERY)).toEqual([]);
  });

  it("ranks the better match first and respects the limit", () => {
    const weak = row({ id: "c-weak", chunk_index: 1, content: "The score is discussed elsewhere in the chapter." });
    const sel = selectPassages([weak, WELLNESS], WELLNESS_QUERY, { limit: 1 });
    expect(sel).toHaveLength(1);
    expect(sel[0].content).toMatch(/wellness score/i);
  });

  it("truncates an over-long passage rather than flooding the prompt", () => {
    const long = row({ content: "wellness score " + "filler ".repeat(2000) });
    const sel = selectPassages([long], WELLNESS_QUERY, { maxChars: 200 });
    expect(sel[0].content.length).toBeLessThanOrEqual(201);
    expect(sel[0].content.endsWith("…")).toBe(true);
  });
});

describe("source gating — only approved + active sources can be quoted", () => {
  it("excludes an INACTIVE source", () => {
    const inactive = row({ content: WELLNESS.content, source: approvedSource({ active_in_ai_analysis: false }) });
    expect(isEligiblePassage(inactive)).toBe(false);
    expect(selectPassages([inactive], WELLNESS_QUERY)).toEqual([]);
  });

  it("excludes an UNAPPROVED (pending/rejected) source", () => {
    for (const status of ["pending", "rejected", "draft"]) {
      const unapproved = row({ content: WELLNESS.content, source: approvedSource({ review_status: status }) });
      expect(isEligiblePassage(unapproved)).toBe(false);
      expect(selectPassages([unapproved], WELLNESS_QUERY)).toEqual([]);
    }
  });

  it("excludes a row with no joined source, and keeps the approved sibling", () => {
    const orphan = row({ content: WELLNESS.content, source: null });
    expect(isEligiblePassage(orphan)).toBe(false);
    const sel = selectPassages([orphan, WELLNESS], WELLNESS_QUERY);
    expect(sel).toHaveLength(1);
    expect(sel[0].sourceId).toBe("src-1");
  });
});

describe("metadata placeholders are NOT full-text grounding", () => {
  it("excludes section='metadata' chunks even when they match the query", () => {
    const meta = row({
      id: "c-meta",
      section: "metadata",
      content: "Wellness score wellness score autonomic reserve measure of wellness.",
    });
    expect(isEligiblePassage(meta)).toBe(false);
    expect(selectPassages([meta], WELLNESS_QUERY)).toEqual([]);
  });

  it("is case/whitespace insensitive about the marker", () => {
    for (const s of ["Metadata", " METADATA "]) {
      expect(isEligiblePassage(row({ section: s }))).toBe(false);
    }
  });

  it("a corpus of ONLY metadata chunks yields no passage block", () => {
    const metas = [0, 1, 2].map((i) =>
      row({ id: `m${i}`, chunk_index: i, section: "metadata", content: "wellness score meaning" }),
    );
    expect(buildPassagePromptSection(selectPassages(metas, WELLNESS_QUERY))).toBe("");
  });
});

describe("citations", () => {
  it("prefers page, then section, then chunk index", () => {
    expect(passageCitation(row({ page: 42, section: "Ignored" }))).toMatch(/p\.42$/);
    expect(passageCitation(row({ section: "Wellness Score" }))).toMatch(/Wellness Score$/);
    expect(passageCitation(row({ chunk_index: 7 }))).toMatch(/chunk 7$/);
  });

  it("includes source title and year", () => {
    expect(passageCitation(row({ page: 42 }))).toBe("Clinical Autonomic Dysfunction (2019), p.42");
  });

  it("survives a missing title/year without crashing", () => {
    const c = passageCitation(row({ source: approvedSource({ title: null, year: null }), chunk_index: 2 }));
    expect(c).toBe("(untitled source), chunk 2");
  });

  it("renders each selected passage's citation in the prompt block", () => {
    const block = buildPassagePromptSection(selectPassages([WELLNESS], WELLNESS_QUERY));
    expect(block).toContain("Clinical Autonomic Dysfunction (2019), Wellness Score — Foundations");
    expect(block).toMatch(/\[P1\]/);
  });
});

describe("prompt block — strict separation from patient data", () => {
  const block = buildPassagePromptSection(selectPassages([WELLNESS], WELLNESS_QUERY));

  it("labels the block explanatory context, not patient data", () => {
    expect(block).toMatch(/EXPLANATORY CONTEXT ONLY — NOT this patient's data/);
    expect(block).toMatch(/GENERAL reference material/);
  });

  it("forbids filling a missing or Not assessed patient value", () => {
    expect(block).toMatch(/NEVER use a passage to supply, infer, estimate, or fill in a patient value/);
    expect(block).toMatch(/Not assessed/);
    expect(block).toMatch(/can never tell you what THIS patient's value was/);
  });

  it("forbids altering deterministic scores or vendor findings", () => {
    expect(block).toMatch(/NEVER let a passage change, override, or re-grade any deterministic score/);
    expect(block).toMatch(/vendor-reported finding/);
    expect(block).toMatch(/report\/vendor blocks win/);
  });

  it("forbids turning a quoted threshold into a computed diagnosis", () => {
    expect(block).toMatch(/NEVER convert a threshold, cut-off, or rule-of-thumb .* into a computed/s);
    expect(block).toMatch(/Do not apply a passage's numbers to this patient's data/);
  });
});

describe("transcript attribution", () => {
  const transcriptRow = row({
    section: "Wellness Score — Foundations",
    content: WELLNESS.content,
    source: approvedSource({
      title: "Colombo P&S Clinical Consultation (Transcript)",
      publication_type: "transcript",
      year: 2026,
    }),
  });

  it("detects transcript sources by publication_type and by title", () => {
    expect(selectPassages([transcriptRow], WELLNESS_QUERY)[0].isTranscript).toBe(true);
    const byTitle = row({
      content: WELLNESS.content,
      source: approvedSource({ title: "Recorded Consultation with Dr. Colombo", publication_type: "other" }),
    });
    expect(selectPassages([byTitle], WELLNESS_QUERY)[0].isTranscript).toBe(true);
  });

  it("marks the passage [TRANSCRIPT] and requires clinician verification", () => {
    const block = buildPassagePromptSection(selectPassages([transcriptRow], WELLNESS_QUERY));
    expect(block).toMatch(/\[TRANSCRIPT\]/);
    expect(block).toMatch(/attributed EXPLANATORY SPEECH/);
    expect(block).toMatch(/not a peer-reviewed finding or a\s*\n?\s*validated protocol/);
    expect(block).toMatch(/may require verification with the treating clinician/);
  });

  it("omits the transcript caveat when no transcript passage was selected", () => {
    const block = buildPassagePromptSection(selectPassages([WELLNESS], WELLNESS_QUERY));
    expect(block).not.toMatch(/\[TRANSCRIPT\]/);
    expect(block).not.toMatch(/EXPLANATORY SPEECH/);
  });

  it("does not misclassify a book chapter as a transcript", () => {
    expect(selectPassages([WELLNESS], WELLNESS_QUERY)[0].isTranscript).toBe(false);
  });
});
