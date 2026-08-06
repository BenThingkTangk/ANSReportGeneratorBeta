/**
 * Retrieval contract — source gating, duplicate weighting, provenance, and the
 * tiered fallback chain.
 *
 * Requirements pinned here:
 *   • Only APPROVED and AI-ACTIVE sources may reach the prompt (review_status /
 *     active_in_ai_analysis — NOT the non-existent status / is_active columns).
 *   • No passage may be weighted twice (same chunk id, or identical text under a
 *     re-ingested chunk row).
 *   • Every returned row carries source provenance for citation.
 *   • Tier chain: vector → database full-text → in-process lexical → unavailable,
 *     each degrading without throwing and reporting WHY.
 *
 * Pure unit tests with injected fake Supabase clients. No network, no DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  retrieveCandidates,
  dedupePassages,
  isGatedApprovedActive,
} from "../hybridRetrieval.js";
import { selectPassages, type PassageRow } from "../knowledgePassages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0007 = resolve(
  __dirname,
  "../../../supabase/migrations/0007_rag_lexical_fallback_and_embedding_freshness.sql",
);

const APPROVED_SOURCE = {
  id: "s1",
  title: "P&S Monitoring — Methodology",
  authors: "Colombo J",
  year: 2019,
  publication_type: "paper",
  url: null,
  active_in_ai_analysis: true,
  review_status: "approved",
};

function row(over: Partial<PassageRow> = {}): PassageRow {
  return {
    id: "c1",
    source_id: "s1",
    chunk_index: 0,
    content:
      "Parasympathetic activity is quantified as RFa and sympathetic activity as LFa; " +
      "their ratio is the sympathovagal balance reported by the PhysioPS method.",
    source: { ...APPROVED_SOURCE },
    ...over,
  };
}

/** RPC-shaped row (flat source metadata), as both match functions return. */
function rpcRow(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    source_id: "s1",
    chunk_index: 0,
    content: "RFa quantifies parasympathetic activity in the PhysioPS method.",
    citation: "Colombo J (2019), P&S Monitoring — Methodology",
    title: "P&S Monitoring — Methodology",
    authors: "Colombo J",
    year: 2019,
    publication_type: "paper",
    url: null,
    similarity: 0.71,
    ...over,
  };
}

const ORIGINAL_KEY = process.env.PPLX_API_KEY;
beforeEach(() => {
  delete process.env.PPLX_API_KEY;
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.PPLX_API_KEY;
  else process.env.PPLX_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

// ── Gating ────────────────────────────────────────────────────────────────────
describe("isGatedApprovedActive — only approved + AI-active sources", () => {
  it("accepts an approved, AI-active source", () => {
    expect(isGatedApprovedActive(row())).toBe(true);
  });

  it("rejects every non-approved review_status", () => {
    for (const status of ["draft", "pending_review", "archived", "needs_review", "", "APPROVED"]) {
      expect(
        isGatedApprovedActive(row({ source: { ...APPROVED_SOURCE, review_status: status } })),
      ).toBe(false);
    }
  });

  it("rejects a source that is switched off for AI analysis", () => {
    expect(
      isGatedApprovedActive(row({ source: { ...APPROVED_SOURCE, active_in_ai_analysis: false } })),
    ).toBe(false);
    expect(
      isGatedApprovedActive(row({ source: { ...APPROVED_SOURCE, active_in_ai_analysis: null } })),
    ).toBe(false);
  });

  it("rejects a row that cannot PROVE its status (missing/absent source join)", () => {
    expect(isGatedApprovedActive(row({ source: null }))).toBe(false);
    expect(isGatedApprovedActive({ id: "x", content: "text" })).toBe(false);
    expect(
      isGatedApprovedActive(row({ source: { ...APPROVED_SOURCE, review_status: undefined } })),
    ).toBe(false);
  });
});

describe("gating is applied to every tier, not just the SQL", () => {
  it("restates approved+active on RPC rows, which the SQL already gated", async () => {
    // Both match functions filter in SQL; matchRowToPassage restates the flags so
    // downstream gating sees explicit values instead of an absent join.
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) =>
        fn === "match_ans_knowledge_chunks_lexical"
          ? { data: [rpcRow()], error: null }
          : { data: [], error: null },
    };
    const outcome = await retrieveCandidates(admin as never, "what is RFa?", async () => []);
    expect(outcome.mode).toBe("fulltext");
    expect(outcome.rows).toHaveLength(1);
    expect(isGatedApprovedActive(outcome.rows[0])).toBe(true);
  });

  it("drops unapproved rows returned by the in-process lexical loader", async () => {
    const lexical = [
      row({ id: "ok", source: { ...APPROVED_SOURCE } }),
      row({ id: "draft", source: { ...APPROVED_SOURCE, review_status: "draft" } }),
      row({ id: "inactive", source: { ...APPROVED_SOURCE, active_in_ai_analysis: false } }),
      row({ id: "orphan", source: null }),
    ];
    const admin = { from: () => ({}), rpc: async () => ({ data: [], error: null }) };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical);
    expect(outcome.mode).toBe("lexical");
    expect(outcome.rows.map((r) => r.id)).toEqual(["ok"]);
  });
});

// ── Duplicate weighting ───────────────────────────────────────────────────────
describe("dedupePassages — no passage is weighted twice", () => {
  it("collapses repeated chunk ids, keeping the highest-ranked first occurrence", () => {
    const out = dedupePassages([
      row({ id: "c1", content: "first" }),
      row({ id: "c1", content: "second" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("first");
  });

  it("collapses identical text re-ingested under a different chunk id", () => {
    const out = dedupePassages([
      row({ id: "c1", content: "RFa quantifies parasympathetic activity." }),
      row({ id: "c2", content: "  rfa   QUANTIFIES parasympathetic   activity.  " }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c1");
  });

  it("keeps identical text belonging to DIFFERENT sources (independent evidence)", () => {
    const out = dedupePassages([
      row({ id: "c1", source_id: "s1", content: "same sentence" }),
      row({ id: "c2", source_id: "s2", content: "same sentence" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps genuinely distinct passages and preserves order", () => {
    const out = dedupePassages([
      row({ id: "c1", content: "alpha" }),
      row({ id: "c2", content: "beta" }),
      row({ id: "c3", content: "gamma" }),
    ]);
    expect(out.map((r) => r.content)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("tolerates empty input and null-ish members without throwing", () => {
    expect(dedupePassages([])).toEqual([]);
    expect(dedupePassages([null as never, row()])).toHaveLength(1);
  });

  it("de-duplicates across tiers so a vector+full-text overlap is not double-weighted", async () => {
    const admin = { from: () => ({}), rpc: async () => ({ data: [], error: null }) };
    const dup = [row({ id: "c1" }), row({ id: "c1" }), row({ id: "c2", content: "other text" })];
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => dup);
    expect(outcome.rows).toHaveLength(2);
  });
});

// ── Provenance ────────────────────────────────────────────────────────────────
describe("provenance", () => {
  it("carries source metadata through the full-text tier for citation", async () => {
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) =>
        fn === "match_ans_knowledge_chunks_lexical"
          ? { data: [rpcRow()], error: null }
          : { data: [], error: null },
    };
    const outcome = await retrieveCandidates(admin as never, "what is RFa?", async () => []);
    expect(outcome.mode).toBe("fulltext");
    expect(outcome.rows[0].source?.title).toBe("P&S Monitoring — Methodology");
    expect(outcome.rows[0].source?.authors).toBe("Colombo J");
    expect(outcome.rows[0].source?.year).toBe(2019);
    expect(outcome.rows[0].source_id).toBe("s1");
  });

  it("produces a grounded citation string from that metadata", async () => {
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) =>
        fn === "match_ans_knowledge_chunks_lexical"
          ? { data: [rpcRow()], error: null }
          : { data: [], error: null },
    };
    const outcome = await retrieveCandidates(admin as never, "RFa parasympathetic", async () => []);
    const selected = selectPassages(outcome.rows, "RFa parasympathetic", { limit: 3 });
    expect(selected.length).toBeGreaterThan(0);
    // passageCitation composes title + year (+ section/chunk locator) — never a
    // fabricated reference.
    expect(selected[0].citation).toMatch(/P&S Monitoring/);
    expect(selected[0].citation).toMatch(/2019/);
  });
});

// ── Tiered fallback ───────────────────────────────────────────────────────────
describe("tier chain: vector → full-text → lexical → unavailable", () => {
  const lexical = [row()];

  it("uses the DB full-text tier when no embedding provider is configured", async () => {
    // No PPLX_API_KEY: the vector tier must not even be attempted.
    const calls: string[] = [];
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        calls.push(fn);
        return fn === "match_ans_knowledge_chunks_lexical"
          ? { data: [rpcRow()], error: null }
          : { data: [], error: null };
      },
    };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical);
    expect(outcome.mode).toBe("fulltext");
    expect(calls).not.toContain("match_ans_knowledge_chunks");
    expect(outcome.fallbackReason).toMatch(/embedding provider not configured/);
  });

  it("falls through to the in-process lexical ranker when migration 0007 is absent", async () => {
    const admin = {
      from: () => ({}),
      rpc: async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
      }),
    };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical);
    expect(outcome.mode).toBe("lexical");
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.fallbackReason).toMatch(/apply migration 0007/);
  });

  it("falls through when the full-text tier finds nothing", async () => {
    const admin = { from: () => ({}), rpc: async () => ({ data: [], error: null }) };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical);
    expect(outcome.mode).toBe("lexical");
    expect(outcome.fallbackReason).toMatch(/no rows/);
  });

  it("never throws when the RPC itself throws", async () => {
    const admin = {
      from: () => ({}),
      rpc: async () => {
        throw new Error("Project not found");
      },
    };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical);
    expect(outcome.mode).toBe("lexical");
    expect(outcome.fallbackReason).toMatch(/Project not found/);
  });

  it("never throws when the lexical loader itself throws — degrades to empty", async () => {
    const admin = { from: () => ({}), rpc: async () => ({ data: [], error: null }) };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => {
      throw new Error("relation \"ans_knowledge_chunks\" does not exist");
    });
    expect(outcome.mode).toBe("lexical");
    expect(outcome.rows).toEqual([]);
  });

  it("reports 'unavailable' — not an empty corpus — when there is no database", async () => {
    const outcome = await retrieveCandidates(null, "RFa", async () => lexical);
    expect(outcome.mode).toBe("unavailable");
    expect(outcome.rows).toEqual([]);
    expect(outcome.fallbackReason).toMatch(/not configured/);
  });

  it("skips the query-dependent tiers for a blank question", async () => {
    const calls: string[] = [];
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        calls.push(fn);
        return { data: [], error: null };
      },
    };
    const outcome = await retrieveCandidates(admin as never, "   ", async () => lexical);
    expect(calls).toEqual([]);
    expect(outcome.mode).toBe("lexical");
  });

  it("honours preferVector:false / preferFullText:false", async () => {
    process.env.PPLX_API_KEY = "test-key";
    const calls: string[] = [];
    const admin = {
      from: () => ({}),
      rpc: async (fn: string) => {
        calls.push(fn);
        return { data: [], error: null };
      },
    };
    const outcome = await retrieveCandidates(admin as never, "RFa", async () => lexical, {
      preferVector: false,
      preferFullText: false,
    });
    expect(calls).toEqual([]);
    expect(outcome.mode).toBe("lexical");
    expect(outcome.fallbackReason).toMatch(/disabled by caller/);
  });
});

// ── Migration 0007 contract ───────────────────────────────────────────────────
describe("migration 0007 — lexical fallback SQL contract", () => {
  const sql = readFileSync(MIGRATION_0007, "utf8");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("creates the full-text RPC the fallback tier calls, by exact name", () => {
    expect(code).toMatch(/create\s+or\s+replace\s+function\s+public\.match_ans_knowledge_chunks_lexical/i);
    expect(code).toMatch(/websearch_to_tsquery/i);
    expect(code).toMatch(/ts_rank_cd/i);
  });

  it("gates on the REAL source columns inside SQL as well", () => {
    expect(code).toMatch(/review_status\s*=\s*'approved'/);
    expect(code).toMatch(/active_in_ai_analysis\s*=\s*true/);
    expect(code).not.toMatch(/\bs\.status\b/);
    expect(code).not.toMatch(/\bs\.is_active\b/);
    expect(code).not.toMatch(/\bs\.citation\b/);
  });

  it("de-duplicates in SQL so the RPC cannot double-weight a passage", () => {
    expect(code).toMatch(/distinct\s+on/i);
    expect(code).toMatch(/md5/i);
  });

  it("adds the GIN full-text index and is idempotent", () => {
    expect(code).toMatch(/create\s+index\s+if\s+not\s+exists/i);
    expect(code).toMatch(/using\s+gin/i);
  });

  it("invalidates a stale embedding when chunk content changes", () => {
    expect(code).toMatch(/create\s+trigger|create\s+or\s+replace\s+trigger/i);
    expect(code).toMatch(/embedding\s*=\s*null|embedding\s*:=\s*null/i);
  });

  it("is non-destructive — no DROP TABLE / TRUNCATE / DELETE FROM", () => {
    expect(code).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
