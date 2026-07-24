/**
 * RAG health honesty: computeRagStatus must NEVER report ragFunctional=true
 * when there are 0 full-text chunks. Reproduces the confirmed live state of
 * Supabase project xsjwubnmcivsskumvgyy: 13 approved sources, 0 chunks, legacy
 * schema (no section column → metadataOnlyChunks indeterminable/null).
 */
import { describe, it, expect } from "vitest";
import { computeRagStatus } from "../ragStatus.js";

describe("computeRagStatus", () => {
  it("LIVE STATE: 13 sources, 0 chunks, legacy schema → not functional", () => {
    const r = computeRagStatus({ totalSources: 13, totalChunks: 0, metadataOnlyChunks: null });
    expect(r.ragFunctional).toBe(false);
    expect(r.ragStatus).toBe("sources_present_no_chunks");
    expect(r.fullTextChunks).toBeNull();
    expect(r.activation).toMatch(/0 chunks/i);
  });

  it("no sources, no chunks → empty, not functional", () => {
    const r = computeRagStatus({ totalSources: 0, totalChunks: 0, metadataOnlyChunks: 0 });
    expect(r.ragFunctional).toBe(false);
    expect(r.ragStatus).toBe("empty");
  });

  it("all chunks are metadata placeholders → NOT full-text RAG", () => {
    const r = computeRagStatus({ totalSources: 13, totalChunks: 13, metadataOnlyChunks: 13 });
    expect(r.ragFunctional).toBe(false);
    expect(r.ragStatus).toBe("metadata_only");
    expect(r.fullTextChunks).toBe(0);
    expect(r.activation).toMatch(/NOT full-text RAG/i);
  });

  it("real document chunks present → functional (indexed)", () => {
    const r = computeRagStatus({ totalSources: 13, totalChunks: 40, metadataOnlyChunks: 0 });
    expect(r.ragFunctional).toBe(true);
    expect(r.ragStatus).toBe("indexed");
    expect(r.fullTextChunks).toBe(40);
  });

  it("mix of document + metadata chunks → functional (indexed_mixed)", () => {
    const r = computeRagStatus({ totalSources: 13, totalChunks: 20, metadataOnlyChunks: 5 });
    expect(r.ragFunctional).toBe(true);
    expect(r.ragStatus).toBe("indexed_mixed");
    expect(r.fullTextChunks).toBe(15);
  });

  it("legacy schema with chunks present (kind indeterminable) → functional, not asserted metadata", () => {
    // section column absent → metadataOnlyChunks null → cannot prove they are
    // placeholders; chunks exist so retrieval works.
    const r = computeRagStatus({ totalSources: 13, totalChunks: 13, metadataOnlyChunks: null });
    expect(r.ragFunctional).toBe(true);
    expect(r.ragStatus).toBe("indexed");
    expect(r.fullTextChunks).toBeNull();
  });
});
