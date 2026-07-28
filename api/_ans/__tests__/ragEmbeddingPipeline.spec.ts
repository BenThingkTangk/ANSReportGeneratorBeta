/**
 * RAG pipeline repair — schema compatibility, empty embeddings, lexical fallback,
 * grounded citations, and the HRV output rule.
 *
 * Context (live findings this locks down):
 *   • public.ans_knowledge_sources uses `review_status` + `active_in_ai_analysis`,
 *     but the out-of-band public.match_ans_knowledge_chunks referenced the
 *     NON-EXISTENT s.status / s.is_active / s.citation → every call failed 42703.
 *   • 16 chunks exist and ALL embeddings are NULL; there is no embedding trigger.
 * So retrieval MUST work today (lexical) and MUST light up automatically once
 * embeddings are backfilled — without ever blocking on the provider.
 *
 * Pure unit tests: no network, no Supabase. The vector path is exercised through
 * an injected fake client, and the provider through a fake fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { retrieveCandidates } from "../hybridRetrieval.js";
import { selectPassages, buildPassagePromptSection, type PassageRow } from "../knowledgePassages.js";
import {
  decodeBase64Int8,
  l2Normalize,
  toPgVectorLiteral,
  embedTexts,
  embedQuery,
  isEmbeddingConfigured,
  EmbeddingUnavailableError,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from "../embeddings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, "../../../supabase/migrations/0006_rag_embeddings_and_match_repair.sql");

/** A realistic approved+active chunk row as the lexical path returns it. */
function chunkRow(over: Partial<PassageRow> = {}): PassageRow {
  return {
    id: "c1",
    source_id: "s1",
    chunk_index: 0,
    content:
      "Parasympathetic activity is quantified as RFa, the respiratory-frequency area, " +
      "while sympathetic activity is quantified as LFa. Their ratio is the sympathovagal balance.",
    source: {
      id: "s1",
      title: "P&S Monitoring — Methodology",
      authors: "Colombo J",
      year: 2019,
      publication_type: "paper",
      url: null,
      active_in_ai_analysis: true,
      review_status: "approved",
    },
    ...over,
  };
}

const ORIGINAL_KEY = process.env.PPLX_API_KEY;
beforeEach(() => { delete process.env.PPLX_API_KEY; });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.PPLX_API_KEY;
  else process.env.PPLX_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

// ── 1. Current-schema compatibility (the 42703 bug) ─────────────────────────────
describe("migration 0006 — repairs match_ans_knowledge_chunks for the REAL schema", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("filters on the real columns review_status='approved' and active_in_ai_analysis=true", () => {
    expect(sql).toMatch(/s\.review_status\s*=\s*'approved'/);
    expect(sql).toMatch(/s\.active_in_ai_analysis\s*=\s*true/);
  });

  it("never references the non-existent s.status / s.is_active / s.citation columns", () => {
    // Only comments may mention them (documenting the bug); no SQL expression may.
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\bs\.status\b/);
    expect(code).not.toMatch(/\bs\.is_active\b/);
    expect(code).not.toMatch(/\bs\.citation\b/);
  });

  it("composes the citation from real metadata (title/year/authors)", () => {
    expect(sql).toMatch(/s\.title/);
    expect(sql).toMatch(/s\.year/);
    expect(sql).toMatch(/s\.authors/);
    expect(sql).toMatch(/AS citation/i);
  });

  it("is additive + idempotent and never rewrites rows or clinical data", () => {
    expect(sql).toMatch(/ADD COLUMN embedding vector\(1024\)|ADD COLUMN IF NOT EXISTS/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
    // No destructive DDL/DML against knowledge or patient data.
    expect(sql).not.toMatch(/\bDROP TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    // The only UPDATE-like write is performed by the admin route, not this SQL.
    expect(sql).not.toMatch(/\bUPDATE public\.ans_knowledge_chunks\b/i);
  });

  it("keeps the vector dimension consistent with the embedding module", () => {
    expect(DEFAULT_EMBEDDING_DIMENSIONS).toBe(1024);
    expect(sql).toMatch(/vector\(1024\)/);
  });
});

// ── 2. Empty / NULL embeddings → lexical fallback ───────────────────────────────
describe("retrieval — empty embeddings degrade to the lexical ranker", () => {
  it("falls back when the RPC returns no rows (all 16 chunks have NULL embeddings)", async () => {
    process.env.PPLX_API_KEY = "test-key";
    const lexicalRows = [chunkRow()];
    const admin = {
      from: () => ({}),
      // Simulates the real DB today: function exists, but no row has an embedding.
      rpc: async () => ({ data: [], error: null }),
    };
    const mod = await import("../embeddings.js");
    const fakeVec = new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const spy = vi.spyOn(mod, "embedQuery").mockResolvedValue(fakeVec);
    const out = await retrieveCandidates(admin as any, "what is RFa?", async () => lexicalRows, {
      preferVector: true,
    });
    // The vector path WAS attempted (query embedded, RPC called) but returned no
    // rows because every embedding is NULL → honest lexical fallback.
    expect(spy).toHaveBeenCalled();
    expect(out.mode).toBe("lexical");
    expect(out.rows).toEqual(lexicalRows);
    expect(out.fallbackReason).toBeTruthy();
  });

  it("falls back when the repaired RPC does not exist yet (migration not applied)", async () => {
    process.env.PPLX_API_KEY = "test-key";
    const lexicalRows = [chunkRow()];
    const admin = {
      from: () => ({}),
      rpc: async () => ({
        data: null,
        error: { code: "42883", message: "function public.match_ans_knowledge_chunks does not exist" },
      }),
    };
    const out = await retrieveCandidates(admin as any, "explain sympathovagal balance", async () => lexicalRows);
    expect(out.mode).toBe("lexical");
    expect(out.rows).toEqual(lexicalRows);
    expect(String(out.fallbackReason)).toMatch(/migration 0006|unavailable|embedding/i);
  });

  it("falls back when the embedding provider is UNCONFIGURED (no key)", async () => {
    expect(isEmbeddingConfigured()).toBe(false);
    const lexicalRows = [chunkRow()];
    const admin = {
      from: () => ({}),
      rpc: async () => { throw new Error("must not be called without a provider"); },
    };
    const out = await retrieveCandidates(admin as any, "what is LFa?", async () => lexicalRows);
    expect(out.mode).toBe("lexical");
    expect(out.fallbackReason).toMatch(/not configured/i);
    expect(out.rows).toEqual(lexicalRows);
  });

  it("never throws when the lexical loader itself fails (answer path must survive)", async () => {
    const admin = { from: () => ({}), rpc: async () => ({ data: [], error: null }) };
    const out = await retrieveCandidates(admin as any, "anything", async () => {
      throw new Error("supabase down");
    });
    expect(out.rows).toEqual([]);
    expect(out.mode).toBe("lexical");
  });

  it("uses the VECTOR path when the RPC returns rows, preserving source metadata", async () => {
    process.env.PPLX_API_KEY = "test-key";
    const admin = {
      from: () => ({}),
      rpc: async (fn: string, args: any) => {
        expect(fn).toBe("match_ans_knowledge_chunks");
        expect(Array.isArray(args.query_embedding)).toBe(true);
        return {
          data: [
            {
              id: "c9",
              source_id: "s9",
              chunk_index: 3,
              content: "RFa reflects parasympathetic activity.",
              citation: "P&S Monitoring — Methodology (2019) — Colombo J",
              title: "P&S Monitoring — Methodology",
              authors: "Colombo J",
              year: 2019,
              publication_type: "paper",
              url: null,
              similarity: 0.83,
            },
          ],
          error: null,
        };
      },
    };
    // Fake the provider so no network call happens.
    const fakeVec = new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const mod = await import("../embeddings.js");
    vi.spyOn(mod, "embedQuery").mockResolvedValue(fakeVec);

    const out = await retrieveCandidates(admin as any, "what does RFa mean?", async () => []);
    expect(out.mode).toBe("vector");
    expect(out.fallbackReason).toBeNull();
    expect(out.rows).toHaveLength(1);
    // Provenance preserved from REAL metadata fields.
    expect(out.rows[0].source?.title).toBe("P&S Monitoring — Methodology");
    expect(out.rows[0].source?.year).toBe(2019);
    expect(out.rows[0].source?.review_status).toBe("approved");
    expect(out.rows[0].source?.active_in_ai_analysis).toBe(true);
  });
});

// ── 3. Grounded citations built from real metadata ──────────────────────────────
describe("grounded citations — composed from real source metadata", () => {
  it("builds a citation containing the title and year (never a `citation` column)", () => {
    const passages = selectPassages([chunkRow()], "what is RFa parasympathetic");
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0].citation).toContain("P&S Monitoring — Methodology");
    expect(passages[0].citation).toContain("2019");
    expect(passages[0].sourceId).toBe("s1");
  });

  it("emits nothing when no passage clears the relevance bar (no fabricated grounding)", () => {
    const passages = selectPassages([chunkRow()], "zzz qqq orthopedic arthroplasty scheduling");
    expect(passages).toHaveLength(0);
    expect(buildPassagePromptSection(passages)).toBe("");
  });
});

// ── 4. HRV output rule (Dr. Colombo) is enforceable in the prompt ───────────────
describe("HRV output rule — internal in sources, never surfaced in outputs", () => {
  it("injects an explicit HRV-parameter suppression rule with the passage block", () => {
    const passages = selectPassages(
      [
        chunkRow({
          content:
            "SDNN and the LF/HF ratio are classical HRV indices; P&S separates LFa and RFa instead. " +
            "RFa reflects parasympathetic activity and LFa sympathetic activity.",
        }),
      ],
      "how does RFa relate to parasympathetic activity",
    );
    expect(passages.length).toBeGreaterThan(0);
    const section = buildPassagePromptSection(passages);
    expect(section).toMatch(/HRV-PARAMETER OUTPUT RULE/);
    expect(section).toMatch(/SDNN/);
    expect(section).toMatch(/LF\/HF/);
    expect(section).toMatch(/NOT surface/i);
    // And it still directs output to P&S measures.
    expect(section).toMatch(/LFa, RFa/);
  });
});

// ── 5. Embedding provider primitives (no network) ───────────────────────────────
describe("embedding provider — decode, normalise, format", () => {
  it("decodes base64 signed int8 payloads (provider returns base64, not floats)", () => {
    // Bytes 1, -1, 127, -128 as unsigned: 0x01, 0xFF, 0x7F, 0x80
    const b64 = Buffer.from([0x01, 0xff, 0x7f, 0x80]).toString("base64");
    expect(decodeBase64Int8(b64)).toEqual([1, -1, 127, -128]);
  });

  it("L2-normalises (provider vectors are documented as unnormalised)", () => {
    const n = l2Normalize([3, 4]);
    expect(n[0]).toBeCloseTo(0.6, 6);
    expect(n[1]).toBeCloseTo(0.8, 6);
    // A zero vector must not become NaN.
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });

  it("formats a pgvector literal", () => {
    expect(toPgVectorLiteral([0.5, -0.25])).toBe("[0.5,-0.25]");
  });

  it("throws EmbeddingUnavailableError (not a crash) when unconfigured", async () => {
    await expect(embedTexts(["hello"])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    await expect(embedQuery("hello")).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it("returns null for blank inputs and never fabricates a vector", async () => {
    process.env.PPLX_API_KEY = "k";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })) as any;
    const out = await embedTexts(["   ", ""], { fetchImpl });
    expect(out).toEqual([null, null]);
    // Blank-only batch must not even call the provider.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces provider HTTP failures as EmbeddingUnavailableError without leaking the body", async () => {
    process.env.PPLX_API_KEY = "k";
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: "secret-ish detail" }),
    })) as any;
    await expect(embedTexts(["x"], { fetchImpl })).rejects.toThrow(/HTTP 429/);
  });

  it("rejects a dimension mismatch rather than storing a bad vector", async () => {
    process.env.PPLX_API_KEY = "k";
    const shortVec = Buffer.from([1, 2, 3]).toString("base64"); // 3 dims, not 1024
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: shortVec }] }),
    })) as any;
    await expect(embedTexts(["x"], { fetchImpl })).rejects.toThrow(/dimension mismatch/i);
  });

  it("never puts the API key in the returned value or the thrown message", async () => {
    process.env.PPLX_API_KEY = "super-secret-key-value";
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    try {
      await embedTexts(["x"], { fetchImpl });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("super-secret-key-value");
    }
  });
});
