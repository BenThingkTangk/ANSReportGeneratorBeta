/**
 * POST /api/admin/knowledge/ingest-chunks — behaviour contract.
 *
 * Mocks the Supabase layer so we can assert the endpoint's safety rules without
 * a live DB: approved-source gating, idempotent replace (delete-then-insert for
 * ONLY the target source), NULL-embedding rows (no vectors written), dry-run
 * writing nothing, and fail-closed validation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetChunkSchemaCache } from "../knowledgeSchema.js";

const SRC = "b90cf06b-3141-4ba2-86cc-a165565faed5";

/** Mutable fixture state the mock reads/records. */
const state: {
  source: any;
  priorChunks: number;
  deletes: Array<{ table: string; sourceId: string }>;
  inserts: Array<{ table: string; rows: any[] }>;
  audits: string[];
} = { source: null, priorChunks: 0, deletes: [], inserts: [], audits: [] };

function chunkBuilder() {
  const b: any = {
    _eq: null as string | null,
    select(cols: string, opts?: any) {
      // Schema probes for page/section: report the 0005 schema (both present).
      const c = cols.trim();
      if (c === "page" || c === "section") return Promise.resolve({ error: null, count: 0 });
      if (opts?.head) {
        // count query for prior chunks
        return { eq: (_k: string, _v: string) => Promise.resolve({ count: state.priorChunks, error: null }) };
      }
      return this;
    },
    delete() {
      return {
        eq: (_k: string, v: string) => {
          state.deletes.push({ table: "ans_knowledge_chunks", sourceId: v });
          state.priorChunks = 0;
          return Promise.resolve({ error: null });
        },
      };
    },
    insert(rows: any[]) {
      state.inserts.push({ table: "ans_knowledge_chunks", rows });
      return Promise.resolve({ error: null });
    },
  };
  return b;
}

function sourceBuilder() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.source, error: null }) }),
    }),
  };
}

vi.mock("../../_supabase.js", () => ({
  createSupabaseFromRequest: () => ({ from: () => sourceBuilder() }),
  createSupabaseAdmin: () => ({
    from: (t: string) => (t === "ans_knowledge_chunks" ? chunkBuilder() : sourceBuilder()),
  }),
  requireRole: vi.fn().mockResolvedValue({ id: "admin", role: "super_admin" }),
  logAudit: vi.fn(async (_s: any, action: string) => { state.audits.push(action); }),
  setCorsHeaders: () => {},
  handleError: (res: any, err: any) =>
    res.status(err?.statusCode ?? 500).json({ success: false, error: String(err?.message ?? err) }),
}));

function mockRes() {
  const r: any = {
    _status: 200, _json: null as any,
    status(c: number) { this._status = c; return this; },
    json(p: any) { this._json = p; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return r;
}

const CHUNKS = [
  { chunk_index: 0, content: "Sympathovagal balance is LFa over RFa.", section: "Foundations", source_id: SRC },
  { chunk_index: 1, content: "Parasympathetic excess is like driving with the brakes on.", section: "Analogies", source_id: SRC },
];

async function call(body: any) {
  const handler = (await import("../../admin/knowledge/ingest-chunks.js")).default;
  const req: any = { method: "POST", body, headers: {} };
  const res = mockRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  _resetChunkSchemaCache();
  state.source = { id: SRC, title: "Colombo Consultation", active_in_ai_analysis: true, review_status: "approved" };
  state.priorChunks = 0;
  state.deletes = [];
  state.inserts = [];
  state.audits = [];
});

describe("ingest-chunks — happy path", () => {
  it("writes the curated rows and reports them as full text", async () => {
    const res = await call({ sourceId: SRC, chunks: CHUNKS });
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.chunksWritten).toBe(2);
    expect(res._json.chunkKind).toBe("fulltext");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].rows).toHaveLength(2);
  });

  it("writes NO embedding column — retrieval is lexical, vectors are not required", async () => {
    await call({ sourceId: SRC, chunks: CHUNKS });
    for (const row of state.inserts[0].rows) {
      expect(row).not.toHaveProperty("embedding");
      expect(row.source_id).toBe(SRC);
      expect(typeof row.tokens).toBe("number");
    }
  });

  it("never stamps the reserved section='metadata' marker", async () => {
    await call({ sourceId: SRC, chunks: CHUNKS });
    for (const row of state.inserts[0].rows) expect(row.section).not.toBe("metadata");
  });

  it("records an audit entry", async () => {
    await call({ sourceId: SRC, chunks: CHUNKS });
    expect(state.audits).toContain("ingest_curated_chunks");
  });
});

describe("ingest-chunks — idempotency", () => {
  it("deletes only THIS source's chunks before inserting (re-run is a replace)", async () => {
    state.priorChunks = 2;
    const res = await call({ sourceId: SRC, chunks: CHUNKS });
    expect(state.deletes).toEqual([{ table: "ans_knowledge_chunks", sourceId: SRC }]);
    expect(res._json.replacedChunks).toBe(2);
    expect(state.inserts[0].rows).toHaveLength(2);
  });

  it("re-running yields the same corpus size, not duplicates", async () => {
    await call({ sourceId: SRC, chunks: CHUNKS });
    const firstCount = state.inserts[0].rows.length;
    state.priorChunks = firstCount;
    state.inserts = [];
    await call({ sourceId: SRC, chunks: CHUNKS });
    expect(state.inserts[0].rows).toHaveLength(firstCount);
    expect(state.deletes.length).toBe(2); // one delete per run
  });

  it("replace:false skips the delete (explicit append)", async () => {
    await call({ sourceId: SRC, chunks: CHUNKS, replace: false });
    expect(state.deletes).toEqual([]);
  });
});

describe("ingest-chunks — dry run", () => {
  it("validates and writes nothing", async () => {
    const res = await call({ sourceId: SRC, chunks: CHUNKS, dryRun: true });
    expect(res._status).toBe(200);
    expect(res._json.dryRun).toBe(true);
    expect(res._json.wouldWriteChunks).toBe(2);
    expect(state.inserts).toEqual([]);
    expect(state.deletes).toEqual([]);
  });
});

describe("ingest-chunks — refusals (nothing written)", () => {
  it("404s an unknown source", async () => {
    state.source = null;
    const res = await call({ sourceId: SRC, chunks: CHUNKS });
    expect(res._status).toBe(404);
    expect(state.inserts).toEqual([]);
  });

  it("409s a source that is not approved+active", async () => {
    state.source = { id: SRC, title: "Draft", active_in_ai_analysis: false, review_status: "pending" };
    const res = await call({ sourceId: SRC, chunks: CHUNKS });
    expect(res._status).toBe(409);
    expect(state.inserts).toEqual([]);
  });

  it("400s an invalid batch and writes nothing", async () => {
    const res = await call({ sourceId: SRC, chunks: [{ chunk_index: 0, content: "" }] });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/validation failed/i);
    expect(state.inserts).toEqual([]);
    expect(state.deletes).toEqual([]);
  });

  it("400s a batch containing patient data (fail closed)", async () => {
    const res = await call({
      sourceId: SRC,
      chunks: [{ chunk_index: 0, content: "Patient DOB: 9/17/1975, MRN: 4412" }],
    });
    expect(res._status).toBe(400);
    expect(JSON.stringify(res._json.errors)).toMatch(/no patient data/i);
    expect(state.inserts).toEqual([]);
  });

  it("405s a non-POST", async () => {
    const handler = (await import("../../admin/knowledge/ingest-chunks.js")).default;
    const res = mockRes();
    await handler({ method: "GET", headers: {} } as any, res);
    expect(res._status).toBe(405);
  });
});
