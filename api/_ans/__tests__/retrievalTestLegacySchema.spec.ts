/**
 * Regression: POST /api/admin/retrieval-test must NOT crash on the LEGACY
 * ans_knowledge_chunks schema (no page/section columns). Reproduces the live
 * preview failure: `column ans_knowledge_chunks.page does not exist` (42703).
 *
 * We mock the Supabase layer so the chunk-column probes fail with 42703 for
 * page/section, the main chunk select succeeds (base columns only), and assert
 * the handler returns 200 with honest, page-less citations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { _resetChunkSchemaCache } from "../knowledgeSchema.js";

const CHUNK_ROWS = [
  {
    id: "c1", source_id: "s1", chunk_index: 0, tokens: 40,
    content:
      "Parasympathetic excess (PE) at rest is treated by relieving the underlying stress response; consider hydration, low-and-slow exercise, and clinician-directed therapy.",
    source: { id: "s1", title: "Clinical Autonomic Dysfunction", authors: "DePace, Colombo", year: 2019, publication_type: "book", url: null, active_in_ai_analysis: true, review_status: "approved" },
  },
  {
    id: "c2", source_id: "s2", chunk_index: 0, tokens: 30,
    content: "Valsalva ratio grades adrenergic baroreflex integrity during strain.",
    source: { id: "s2", title: "Baroreflex", authors: "X", year: 2020, publication_type: "journal", url: null, active_in_ai_analysis: true, review_status: "approved" },
  },
];

// Legacy schema: single-column probes for `page`/`section` fail with 42703; the
// base chunk select (with the joined source) resolves to rows. The builder is
// THENABLE (like the real PostgREST builder) so `await q` works whether or not
// `.limit()` was the last call.
function legacyChunkQuery() {
  const RESULT = { data: CHUNK_ROWS, error: null };
  const builder: any = {
    select(cols: string, _opts?: any) {
      if (cols.trim() === "page" || cols.trim() === "section") {
        return Promise.resolve({ error: { code: "42703", message: `column ans_knowledge_chunks.${cols.trim()} does not exist` } });
      }
      return this;
    },
    eq() { return this; },
    limit() { return this; },
    then(onFulfilled: any) { return Promise.resolve(RESULT).then(onFulfilled); },
  };
  return builder;
}

vi.mock("../../_supabase.js", () => ({
  createSupabaseFromRequest: () => ({
    from: (_t: string) => legacyChunkQuery(),
  }),
  requireRole: vi.fn().mockResolvedValue({ id: "admin", role: "super_admin" }),
  setCorsHeaders: () => {},
  handleError: (res: any, err: any) => res.status(500).json({ success: false, error: String(err?.message ?? err) }),
}));

async function invoke(body: any): Promise<{ status: number; json: any }> {
  const handler = (await import("../../admin/retrieval-test.ts")).default;
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = {};
  req.body = body;
  return new Promise((resolve, reject) => {
    const res: any = {
      _s: 200,
      status(c: number) { this._s = c; return this; },
      setHeader() { return this; },
      json(p: any) { resolve({ status: this._s, json: p }); return this; },
      end() { resolve({ status: this._s, json: null }); return this; },
    };
    handler(req, res).catch(reject);
  });
}

beforeEach(() => _resetChunkSchemaCache());

describe("retrieval-test on the legacy schema (no page/section)", () => {
  it("returns 200 and does NOT crash with 42703", async () => {
    const { status, json } = await invoke({ query: "parasympathetic excess treatment evidence" });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.schemaVersion).toBe("0001");
  });

  it("ranks the relevant chunk first and emits a page-less citation", async () => {
    const { json } = await invoke({ query: "parasympathetic excess treatment" });
    expect(json.results.length).toBeGreaterThan(0);
    const top = json.results[0];
    expect(top.sourceId).toBe("s1");
    expect(top.page).toBeNull();
    expect(top.section).toBeNull();
    // Falls back to a chunk-index locator, still honest.
    expect(top.citation).toMatch(/chunk 0/);
    expect(top.citation).toMatch(/Clinical Autonomic Dysfunction/);
  });
});
