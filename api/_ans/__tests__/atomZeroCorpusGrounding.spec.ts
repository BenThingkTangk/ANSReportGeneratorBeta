/**
 * ATOM grounding regression: when the private knowledge corpus has 0 retrievable
 * chunks (the confirmed live state — 13 metadata sources, 0 chunks, 0 storage
 * objects), the prompt must NOT present the source metadata as a citable
 * evidence base, and must forbid unsupported diagnostic-performance / prognosis
 * / treatment claims. Deterministic (prompt-construction) — no network.
 */
import { describe, it, expect } from "vitest";
import { buildKnowledgePromptSection } from "../../_knowledgeCache.js";
import { SYSTEM_PROMPT } from "../../ask-atom.js";
import type { KnowledgeSource } from "../../_knowledgeCache.js";

const SOURCES: KnowledgeSource[] = [
  { id: "1", title: "Clinical Autonomic Dysfunction", authors: "DePace, Colombo", year: 2019, url: null, publication_type: "book", abstract: "P&S monitoring…", key_claims: ["LFa/RFa 0.4–3.0 is normal."] },
  { id: "2", title: "POTS and the Stand Response", authors: "X", year: 2022, url: null, publication_type: "journal", abstract: "HR rise on standing…", key_claims: ["≥30 bpm meets POTS."] },
];

describe("buildKnowledgePromptSection — RAG functional (chunks > 0)", () => {
  const section = buildKnowledgePromptSection(SOURCES, true);
  it("presents the sources as a usable evidence base with abstracts/claims", () => {
    expect(section).toMatch(/KNOWLEDGE LIBRARY — Active Sources/);
    expect(section).toMatch(/ground your response/i);
    expect(section).toContain("Clinical Autonomic Dysfunction");
    expect(section).toContain("Summary:");
  });
});

describe("buildKnowledgePromptSection — RAG NON-functional (0 chunks)", () => {
  const section = buildKnowledgePromptSection(SOURCES, false);

  it("labels the corpus METADATA ONLY / no full-text", () => {
    expect(section).toMatch(/METADATA ONLY|NO FULL-TEXT CORPUS/i);
    expect(section).toMatch(/0 retrievable chunks/i);
  });

  it("forbids bracketed citations and diagnostic-performance/prognosis/treatment claims", () => {
    expect(section).toMatch(/Do NOT cite these entries/i);
    expect(section).toMatch(/sensitivity, specificity/i);
    expect(section).toMatch(/prognosis|risk reduction|treatment efficacy/i);
  });

  it("directs external evidence to be labeled with a resolvable URL", () => {
    expect(section).toMatch(/External \(web\)/);
    expect(section).toMatch(/resolvable URL/i);
  });

  it("lists titles only (no abstract/claims presented as retrieved passages)", () => {
    // Titles appear as background reading, but the abstract 'Summary:' framing
    // used in the functional path must be absent.
    expect(section).toContain("Clinical Autonomic Dysfunction");
    expect(section).not.toContain("Summary:");
    expect(section).toMatch(/not retrieved/i);
  });
});

describe("SYSTEM_PROMPT — evidence-grounding discipline present", () => {
  it("carries the zero-corpus grounding rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/METADATA ONLY/);
    expect(SYSTEM_PROMPT).toMatch(/sensitivity, specificity/i);
    expect(SYSTEM_PROMPT).toMatch(/resolvable URL/i);
    expect(SYSTEM_PROMPT).toMatch(/near-term risk|lower risk/i);
  });
});
