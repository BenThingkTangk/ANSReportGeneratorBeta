import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * Admin Knowledge / RAG backend on Akamai Managed PostgreSQL (humanos-ans-rag-pg).
 *
 * Drives the REAL route handlers + the shared ../_ragDb helpers against a mocked
 * `pg` driver (no network, no live database). Pins the migrated contract:
 *   - auth is enforced (gateway session) BEFORE the database is ever queried;
 *   - all SQL is parameterized (SQL-injection safe);
 *   - a missing/malformed env yields a precise, SECRET-FREE 503 naming the var;
 *   - a transport failure → 503 (secret-free); an undefined_table (42P01) → 503
 *     with a "run the migration" hint; a genuine query error → 400;
 *   - the connection pool is a serverless-safe singleton with verified TLS;
 *   - readiness reports configured/reachable/schema/vector without leaking values;
 *   - CRUD (list/create/get/update/delete) + upload write to PostgreSQL;
 *   - no secret (URL value, host, CA) ever appears in an error/response.
 */

// ── Hoisted pg mock (shared, inspectable state) ──────────────────────────────
const h = vi.hoisted(() => {
  const state: {
    calls: Array<{ text: string; params?: unknown[] }>;
    queryImpl: ((text: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number }) | null;
    poolInstances: number;
    connectCount: number;
    lastPoolConfig: Record<string, unknown> | null;
  } = { calls: [], queryImpl: null, poolInstances: 0, connectCount: 0, lastPoolConfig: null };

  function dispatch(text: string, params?: unknown[]) {
    state.calls.push({ text, params });
    const t = text.trim().toUpperCase();
    if (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (!state.queryImpl) return { rows: [], rowCount: 0 };
    return state.queryImpl(text, params);
  }

  class MockPoolClient {
    async query(text: string, params?: unknown[]) {
      return dispatch(text, params);
    }
    release() {}
  }
  class MockPool {
    constructor(config: Record<string, unknown>) {
      state.poolInstances++;
      state.lastPoolConfig = config;
    }
    on() {
      return this;
    }
    async query(text: string, params?: unknown[]) {
      return dispatch(text, params);
    }
    async connect() {
      state.connectCount++;
      return new MockPoolClient();
    }
    async end() {}
  }
  return { state, MockPool };
});

vi.mock("pg", () => ({ default: { Pool: h.MockPool }, Pool: h.MockPool }));

import knowledgeHandler from "../../admin/knowledge.js";
import knowledgeIdHandler from "../../admin/knowledge/[id].js";
import knowledgeStatusHandler from "../../admin/knowledge-status.js";
import uploadHandler from "../../admin/knowledge/upload.js";
import {
  ragConfigStatus,
  isRagUnreachable,
  ragBackendError,
  ragReadiness,
  getPool,
  ragCaCert,
  ragDatabaseUrl,
  _resetPoolForTests,
} from "../../_ragDb.js";
import { hashPassword, signSession, GATEWAY_COOKIE } from "../../_adminGateway.js";
import { Readable } from "node:stream";

// ── Gateway auth fixtures ────────────────────────────────────────────────────
const GW_USER = "admin";
const GW_PASSWORD = "Rag-Pg-Route-Test!";
const GW_SECRET = "rag-pg-route-session-secret";

const VALID_URL = "postgres://u:p@db.example-ref.akamai.internal:5432/ans?sslmode=require";
const VALID_CA = "-----BEGIN CERTIFICATE-----\nMIIBmock\n-----END CERTIFICATE-----";

const SRC_ID = "11111111-1111-1111-1111-111111111111";

function mockRes() {
  const res: any = {
    _status: 200,
    _json: undefined as any,
    _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(p: any) { this._json = p; return this; },
    setHeader(k: string, v: any) { this._headers[String(k)] = String(v); return this; },
    getHeader(k: string) { return this._headers[String(k)]; },
    end() { return this; },
  };
  return res;
}

function mockReq(opts: { cookie?: string; method?: string; query?: Record<string, string>; body?: unknown } = {}): any {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    method: opts.method ?? "GET",
    query: opts.query ?? {},
    headers,
    cookies: {},
    body: opts.body,
    socket: { remoteAddress: "127.0.0.1" },
  };
}

/** A streaming multipart POST request for the upload handler. */
function multipartReq(
  fields: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
  cookie: string
): any {
  const boundary = "----ragtestboundary";
  let body = "";
  for (const f of fields) {
    body += `--${boundary}\r\n`;
    if (f.filename) {
      body += `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n`;
      body += `Content-Type: ${f.contentType ?? "text/plain"}\r\n\r\n`;
    } else {
      body += `Content-Disposition: form-data; name="${f.name}"\r\n\r\n`;
    }
    body += f.value + "\r\n";
  }
  body += `--${boundary}--\r\n`;
  const buf = Buffer.from(body, "binary");
  const req: any = Readable.from([buf]);
  req.method = "POST";
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, cookie };
  req.query = {};
  req.cookies = {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function gatewayCookie(): string {
  return `${GATEWAY_COOKIE}=${signSession(GW_USER, GW_SECRET)}`;
}

function setRag(url: string | undefined, ca: string | undefined) {
  if (url === undefined) delete (process.env as any).HUMANOS_DATABASE_URL;
  else process.env.HUMANOS_DATABASE_URL = url;
  if (ca === undefined) delete (process.env as any).HUMANOS_DATABASE_CA_CERT;
  else process.env.HUMANOS_DATABASE_CA_CERT = ca;
}

function sourceRow(over: Record<string, unknown> = {}) {
  return {
    id: SRC_ID,
    title: "Test Source",
    authors: "A. Author",
    year: 2024,
    publication_type: "book",
    journal: null,
    publisher: "Springer",
    doi: null,
    pubmed_id: null,
    url: null,
    abstract: "abstract text",
    key_claims: [],
    diagnostic_relevance: null,
    ans_metrics: [],
    tags: [],
    used_in: [],
    file_path: null,
    file_mime: null,
    file_size_bytes: null,
    active_in_ai_analysis: false,
    active_in_report_citations: false,
    active_in_admin_review: true,
    review_status: "draft",
    added_by: null,
    last_updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

/** A comprehensive happy-path query responder switching on SQL shape. */
function defaultImpl(text: string): { rows: unknown[] } {
  const t = text.toLowerCase();
  if (t.includes("count(*) over()")) return { rows: [{ ...sourceRow(), total_count: "1" }] };
  if (t.includes("to_regclass"))
    return {
      rows: [{
        sources_tbl: "public.ans_knowledge_sources",
        chunks_tbl: "public.ans_knowledge_chunks",
        versions_tbl: "public.ans_knowledge_versions",
        audit_tbl: "public.ans_knowledge_audit",
      }],
    };
  if (t.includes("pg_extension")) return { rows: [{ present: true }] };
  if (t.includes("count(*) from public.ans_knowledge_sources")) return { rows: [{ sources: "13", chunks: "40" }] };
  if (t.includes("insert into public.ans_knowledge_sources")) return { rows: [sourceRow()] };
  if (t.includes("update public.ans_knowledge_sources")) return { rows: [sourceRow({ review_status: "approved" })] };
  if (t.includes("delete from public.ans_knowledge_sources")) return { rows: [] };
  if (t.includes("from public.ans_knowledge_sources")) return { rows: [sourceRow()] };
  if (t.includes("count(*)::int as n from public.ans_knowledge_chunks")) return { rows: [{ n: 2 }] };
  if (t.includes("insert into public.ans_knowledge_chunks")) return { rows: [] };
  if (t.includes("delete from public.ans_knowledge_chunks")) return { rows: [] };
  if (t.includes("insert into public.ans_knowledge_files")) return { rows: [] };
  if (t.includes("from public.ans_knowledge_chunks"))
    return { rows: [{ id: "c1", chunk_index: 0, tokens: 10, content: "hello world chunk" }] };
  if (t.includes("coalesce(max(version)")) return { rows: [{ next: "1" }] };
  if (t.includes("insert into public.ans_knowledge_versions")) return { rows: [] };
  if (t.includes("from public.ans_knowledge_versions"))
    return { rows: [{ version: 1, change_action: "create", changed_by_email: "admin", created_at: "2024-01-01" }] };
  if (t.includes("insert into public.ans_knowledge_audit")) return { rows: [] };
  return { rows: [] };
}

const prev = {
  u: process.env.ADMIN_GATEWAY_USERNAME,
  hh: process.env.ADMIN_GATEWAY_PASSWORD_HASH,
  s: process.env.ADMIN_SESSION_SECRET,
  url: process.env.HUMANOS_DATABASE_URL,
  ca: process.env.HUMANOS_DATABASE_CA_CERT,
  max: process.env.HUMANOS_DATABASE_POOL_MAX,
  supaUrl: process.env.SUPABASE_URL,
  supaKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeAll(() => {
  process.env.ADMIN_GATEWAY_USERNAME = GW_USER;
  process.env.ADMIN_GATEWAY_PASSWORD_HASH = hashPassword(GW_PASSWORD);
  process.env.ADMIN_SESSION_SECRET = GW_SECRET;
});

afterAll(async () => {
  await _resetPoolForTests();
  const restore = (k: string, v: string | undefined) =>
    v === undefined ? delete (process.env as any)[k] : ((process.env as any)[k] = v);
  restore("ADMIN_GATEWAY_USERNAME", prev.u);
  restore("ADMIN_GATEWAY_PASSWORD_HASH", prev.hh);
  restore("ADMIN_SESSION_SECRET", prev.s);
  restore("HUMANOS_DATABASE_URL", prev.url);
  restore("HUMANOS_DATABASE_CA_CERT", prev.ca);
  restore("HUMANOS_DATABASE_POOL_MAX", prev.max);
  restore("SUPABASE_URL", prev.supaUrl);
  restore("SUPABASE_SERVICE_ROLE_KEY", prev.supaKey);
});

beforeEach(async () => {
  await _resetPoolForTests();
  h.state.calls = [];
  h.state.queryImpl = defaultImpl;
  h.state.poolInstances = 0;
  h.state.connectCount = 0;
  h.state.lastPoolConfig = null;
  setRag(VALID_URL, VALID_CA);
  delete (process.env as any).HUMANOS_DATABASE_POOL_MAX;
});

// ── ragConfigStatus + env accessors ──────────────────────────────────────────
describe("ragConfigStatus() — env presence, URL validity, whitespace/CA tolerance", () => {
  it("reports configured when URL + CA are present and the URL is a postgres:// URI", () => {
    setRag(VALID_URL, VALID_CA);
    expect(ragConfigStatus()).toEqual({ configured: true });
  });

  it("trims a pasted newline/space on the URL and restores literal \\n in the CA cert", () => {
    setRag(`  \n${VALID_URL}\n `, "-----BEGIN CERTIFICATE-----\\nMIIBmock\\n-----END CERTIFICATE-----\\n");
    expect(ragConfigStatus().configured).toBe(true);
    expect(ragDatabaseUrl()).toBe(VALID_URL);
    // literal backslash-n sequences become real newlines so OpenSSL can parse it
    expect(ragCaCert()).toContain("\n");
    expect(ragCaCert()).not.toContain("\\n");
  });

  it("flags a missing HUMANOS_DATABASE_URL by NAME", () => {
    setRag(undefined, VALID_CA);
    const cfg = ragConfigStatus();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain("HUMANOS_DATABASE_URL");
    expect(cfg.detail).toMatch(/HUMANOS_DATABASE_URL/);
  });

  it("flags a missing HUMANOS_DATABASE_CA_CERT by NAME", () => {
    setRag(VALID_URL, undefined);
    const cfg = ragConfigStatus();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain("HUMANOS_DATABASE_CA_CERT");
  });

  it("rejects a non-postgres URL scheme", () => {
    setRag("https://not-a-db.example.com", VALID_CA);
    expect(ragConfigStatus().configured).toBe(false);
    setRag("garbage-not-a-url", VALID_CA);
    expect(ragConfigStatus().configured).toBe(false);
  });
});

// ── isRagUnreachable + ragBackendError ───────────────────────────────────────
describe("isRagUnreachable() — transport vs query classification", () => {
  it("classifies pg transport/connect errors as unreachable", () => {
    expect(isRagUnreachable({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 1.2.3.4:5432" })).toBe(true);
    expect(isRagUnreachable({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND db.host" })).toBe(true);
    expect(isRagUnreachable({ message: "timeout exceeded when trying to connect" })).toBe(true);
    expect(isRagUnreachable({ message: "self signed certificate in certificate chain" })).toBe(true);
  });

  it("does NOT classify a genuine query error as unreachable", () => {
    expect(isRagUnreachable({ code: "42703", message: 'column "foo" does not exist' })).toBe(false);
    expect(isRagUnreachable({ code: "42P01", message: 'relation "x" does not exist' })).toBe(false);
  });
});

describe("ragBackendError() — precise, secret-free status mapping", () => {
  it("maps a transport failure to 503 naming HUMANOS_DATABASE_URL, hiding the host", () => {
    const e = ragBackendError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.20.30.40:5432" });
    expect(e.statusCode).toBe(503);
    expect(e.message).toMatch(/HUMANOS_DATABASE_URL/);
    expect(e.message).not.toContain("10.20.30.40");
    expect(e.message).not.toMatch(/ECONNREFUSED/);
  });

  it("maps undefined_table (42P01) to 503 with a run-the-migration hint", () => {
    const e = ragBackendError({ code: "42P01", message: 'relation "ans_knowledge_sources" does not exist' });
    expect(e.statusCode).toBe(503);
    expect(e.message).toMatch(/db:migrate:rag|migration/i);
  });

  it("preserves a genuine (non-secret) query error as 400", () => {
    const e = ragBackendError({ code: "42703", message: 'column "foo" does not exist' });
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('column "foo" does not exist');
  });

  it("is idempotent — an error already carrying a statusCode passes through", () => {
    const pre = Object.assign(new Error("already classified"), { statusCode: 503 });
    expect(ragBackendError(pre)).toBe(pre);
  });
});

// ── Serverless-safe connection pool ──────────────────────────────────────────
describe("getPool() — serverless-safe singleton with verified TLS", () => {
  it("builds ONE pool reused across calls, with rejectUnauthorized:true + CA and a small max", () => {
    getPool();
    getPool();
    expect(h.state.poolInstances).toBe(1);
    const cfg = h.state.lastPoolConfig as any;
    expect(cfg.ssl.rejectUnauthorized).toBe(true);
    expect(typeof cfg.ssl.ca).toBe("string");
    expect(cfg.ssl.ca.length).toBeGreaterThan(0);
    expect(cfg.max).toBe(3);
    expect(cfg.connectionString).toBe(VALID_URL);
    // fast-fail + serverless idle reclaim
    expect(cfg.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.idleTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.allowExitOnIdle).toBe(true);
  });

  it("honours HUMANOS_DATABASE_POOL_MAX and caps it at 10", async () => {
    process.env.HUMANOS_DATABASE_POOL_MAX = "7";
    getPool();
    expect((h.state.lastPoolConfig as any).max).toBe(7);
    await _resetPoolForTests();
    process.env.HUMANOS_DATABASE_POOL_MAX = "99";
    getPool();
    expect((h.state.lastPoolConfig as any).max).toBe(10);
  });

  it("throws a precise 503 (not a raw driver error) when unconfigured", () => {
    setRag(undefined, undefined);
    try {
      getPool();
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(503);
      expect(String(e.message)).toMatch(/HUMANOS_DATABASE_URL/);
      expect(String(e.message)).not.toMatch(/fetch failed|TypeError/i);
    }
  });
});

// ── ragReadiness ─────────────────────────────────────────────────────────────
describe("ragReadiness() — secret-free health for the admin UI", () => {
  it("returns not-configured (no query issued) when env is missing", async () => {
    setRag(undefined, undefined);
    const r = await ragReadiness();
    expect(r.configured).toBe(false);
    expect(r.reachable).toBe(false);
    expect(r.missing).toContain("HUMANOS_DATABASE_URL");
    expect(h.state.calls.length).toBe(0);
  });

  it("reports schema + vector ready with counts when everything is present", async () => {
    const r = await ragReadiness();
    expect(r).toMatchObject({ configured: true, reachable: true, schemaReady: true, vectorReady: true });
    expect(r.counts).toEqual({ sources: 13, chunks: 40 });
  });

  it("reports vectorReady:false when pgvector is unavailable (schema still ready)", async () => {
    h.state.queryImpl = (text: string) => {
      const t = text.toLowerCase();
      if (t.includes("pg_extension")) return { rows: [{ present: false }] };
      return defaultImpl(text);
    };
    const r = await ragReadiness();
    expect(r.schemaReady).toBe(true);
    expect(r.vectorReady).toBe(false);
  });

  it("reports reachable:false with a secret-free detail on transport failure", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error("connect ETIMEDOUT 9.9.9.9:5432"), { code: "ETIMEDOUT" });
    };
    const r = await ragReadiness();
    expect(r.configured).toBe(true);
    expect(r.reachable).toBe(false);
    expect(String(r.detail)).not.toContain("9.9.9.9");
  });
});

// ── Route: GET/POST /api/admin/knowledge ─────────────────────────────────────
describe("route /api/admin/knowledge — auth-first, list/create over PostgreSQL", () => {
  it("rejects an unauthenticated GET with 401 and NEVER touches the database", async () => {
    setRag(undefined, undefined); // even unconfigured, auth must fail first
    const res = mockRes();
    await knowledgeHandler(mockReq({ query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(401);
    expect(h.state.calls.length).toBe(0);
    expect(String(res._json.error)).not.toMatch(/HUMANOS_DATABASE_URL/);
  });

  it("returns a precise, secret-free 503 (not a raw error) when the backend is unconfigured", async () => {
    setRag(undefined, VALID_CA);
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).toMatch(/HUMANOS_DATABASE_URL/);
    expect(String(res._json.error)).not.toMatch(/fetch failed|TypeError/i);
  });

  it("names HUMANOS_DATABASE_CA_CERT in the 503 when only the CA is missing", async () => {
    setRag(VALID_URL, undefined);
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).toMatch(/HUMANOS_DATABASE_CA_CERT/);
  });

  it("lists sources with total from the window count and the expected contract", async () => {
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.data)).toBe(true);
    expect(res._json.meta).toEqual({ total: 1, page: 1, limit: 50 });
    // the helper column must be stripped from client rows
    expect(res._json.data[0]).not.toHaveProperty("total_count");
  });

  it("passes a malicious search string as a PARAMETER (SQL-injection safe)", async () => {
    const evil = "x%'; DROP TABLE ans_knowledge_sources; --";
    const res = mockRes();
    await knowledgeHandler(
      mockReq({ cookie: gatewayCookie(), query: { search: evil, page: "1", limit: "50" } }),
      res
    );
    expect(res._status).toBe(200);
    const listCall = h.state.calls.find((c) => c.text.toLowerCase().includes("count(*) over()"))!;
    expect(listCall).toBeTruthy();
    // The raw injection text must never be concatenated into the SQL...
    expect(listCall.text).not.toContain("DROP TABLE ans_knowledge_sources;");
    expect(listCall.text).toMatch(/ILIKE \$\d/i);
    // ...it is a bound parameter (LIKE-escaped, wrapped in %…%).
    expect((listCall.params ?? []).some((p) => typeof p === "string" && p.includes("DROP TABLE"))).toBe(true);
  });

  it("maps an undefined_table (42P01) query failure to 503 with a migration hint", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error('relation "ans_knowledge_sources" does not exist'), { code: "42P01" });
    };
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).toMatch(/db:migrate:rag|migration/i);
  });

  it("maps a transport failure to 503 without leaking the host", async () => {
    h.state.queryImpl = () => {
      throw Object.assign(new Error("connect ECONNREFUSED 172.16.0.9:5432"), { code: "ECONNREFUSED" });
    };
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), query: { page: "1", limit: "50" } }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).not.toContain("172.16.0.9");
    expect(String(res._json.error)).not.toMatch(/ECONNREFUSED/);
  });

  it("creates a source (201) using a transaction + parameterized insert + version snapshot", async () => {
    const res = mockRes();
    await knowledgeHandler(
      mockReq({
        cookie: gatewayCookie(),
        method: "POST",
        body: { title: "New Source", year: "2024", key_claims: ["c1"], tags: ["t"], ans_metrics: ["LFa"] },
      }),
      res
    );
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);
    // used a pooled client transaction
    expect(h.state.connectCount).toBeGreaterThanOrEqual(1);
    const insert = h.state.calls.find((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_sources"))!;
    expect(insert.text).toMatch(/\$1/);
    // the title is a bound param, never inlined
    expect(insert.text).not.toContain("New Source");
    expect((insert.params ?? [])[0]).toBe("New Source");
    // a version snapshot was written
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_versions"))).toBe(true);
  });

  it("rejects a create with no title (400)", async () => {
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie(), method: "POST", body: {} }), res);
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toMatch(/title/i);
  });
});

// ── Route: /api/admin/knowledge/[id] ─────────────────────────────────────────
describe("route /api/admin/knowledge/[id] — get/update/delete over PostgreSQL", () => {
  it("returns 404 for a non-uuid id without touching the database", async () => {
    const res = mockRes();
    await knowledgeIdHandler(mockReq({ cookie: gatewayCookie(), query: { id: "not-a-uuid" } }), res);
    expect(res._status).toBe(404);
    expect(h.state.calls.length).toBe(0);
  });

  it("returns 404 when the source row is absent", async () => {
    h.state.queryImpl = (text: string) => {
      if (text.toLowerCase().includes("from public.ans_knowledge_sources")) return { rows: [] };
      return defaultImpl(text);
    };
    const res = mockRes();
    await knowledgeIdHandler(mockReq({ cookie: gatewayCookie(), query: { id: SRC_ID } }), res);
    expect(res._status).toBe(404);
  });

  it("returns the source with chunkCount, chunk previews and version history", async () => {
    const res = mockRes();
    await knowledgeIdHandler(mockReq({ cookie: gatewayCookie(), query: { id: SRC_ID } }), res);
    expect(res._status).toBe(200);
    expect(res._json.data.id).toBe(SRC_ID);
    expect(res._json.data.chunkCount).toBe(2);
    expect(res._json.data.chunks[0]).toHaveProperty("preview");
    expect(Array.isArray(res._json.data.versions)).toBe(true);
  });

  it("updates a source and records a version snapshot (parameterized)", async () => {
    const res = mockRes();
    await knowledgeIdHandler(
      mockReq({
        cookie: gatewayCookie(),
        method: "PUT",
        query: { id: SRC_ID },
        body: { review_status: "approved", active_in_ai_analysis: true },
      }),
      res
    );
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    const upd = h.state.calls.find((c) => c.text.toLowerCase().includes("update public.ans_knowledge_sources"))!;
    expect(upd.text).toMatch(/\$\d/);
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_versions"))).toBe(true);
  });

  it("deletes a source (super_admin) and writes an audit row", async () => {
    const res = mockRes();
    await knowledgeIdHandler(mockReq({ cookie: gatewayCookie(), method: "DELETE", query: { id: SRC_ID } }), res);
    expect(res._status).toBe(200);
    expect(res._json.deleted).toBe(SRC_ID);
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("delete from public.ans_knowledge_sources"))).toBe(true);
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_audit"))).toBe(true);
  });
});

// ── Route: /api/admin/knowledge-status ───────────────────────────────────────
describe("route /api/admin/knowledge-status — readiness endpoint", () => {
  it("rejects an unauthenticated request with 401 and no DB probe", async () => {
    const res = mockRes();
    await knowledgeStatusHandler(mockReq({}), res);
    expect(res._status).toBe(401);
    expect(h.state.calls.length).toBe(0);
  });

  it("returns 200 with the readiness object (no secrets) when authenticated", async () => {
    const res = mockRes();
    await knowledgeStatusHandler(mockReq({ cookie: gatewayCookie() }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      success: true,
      backend: "akamai-postgres",
      configured: true,
      reachable: true,
      schemaReady: true,
      vectorReady: true,
    });
    // never leaks the connection value/host
    expect(JSON.stringify(res._json)).not.toContain("akamai.internal");
  });
});

// ── Route: /api/admin/knowledge/upload — chunks + binary to Akamai PG ─────────
describe("route /api/admin/knowledge/upload — chunks + binary to PostgreSQL (no Supabase Storage)", () => {
  it("persists extracted text chunks AND the file binary to PostgreSQL (bytea), no Supabase needed", async () => {
    // No Supabase env at all — the authoritative store is Akamai PG only.
    delete (process.env as any).SUPABASE_URL;
    delete (process.env as any).SUPABASE_SERVICE_ROLE_KEY;
    const res = mockRes();
    const req = multipartReq(
      [
        { name: "title", value: "Uploaded Doc" },
        { name: "file", value: "The quick brown fox. ".repeat(20), filename: "note.txt", contentType: "text/plain" },
      ],
      gatewayCookie()
    );
    await uploadHandler(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    // file_path is now the (non-secret) filename presence indicator, not a bucket key.
    expect(res._json.file_path).toBe("note.txt");
    expect(res._json.chunkCount).toBeGreaterThan(0);

    // chunks were inserted to PG, parameterized
    const chunkInsert = h.state.calls.find((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_chunks"))!;
    expect(chunkInsert).toBeTruthy();
    expect(chunkInsert.text).toMatch(/\$\d/);

    // the binary was upserted into ans_knowledge_files as a bytea Buffer, keyed on source_id
    const fileInsert = h.state.calls.find((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_files"))!;
    expect(fileInsert).toBeTruthy();
    expect(fileInsert.text.toLowerCase()).toContain("on conflict (source_id)");
    // filename/mime/bytes/content/sha256 are all bound params — the raw bytes never inlined
    const contentParam = (fileInsert.params ?? []).find((p) => Buffer.isBuffer(p));
    expect(Buffer.isBuffer(contentParam)).toBe(true);
    expect((contentParam as Buffer).length).toBeGreaterThan(0);
    // a sha256 provenance hash (64 lowercase hex) is among the params
    expect((fileInsert.params ?? []).some((p) => typeof p === "string" && /^[0-9a-f]{64}$/.test(p))).toBe(true);
  });

  it("rejects a disallowed MIME/extension (415) and NEVER creates a source or stores bytes", async () => {
    const res = mockRes();
    const req = multipartReq(
      [
        { name: "title", value: "Malware" },
        { name: "file", value: "MZ\x00\x00 not a document", filename: "evil.exe", contentType: "application/octet-stream" },
      ],
      gatewayCookie()
    );
    await uploadHandler(req, res);
    expect(res._status).toBe(415);
    expect(String(res._json.error)).toMatch(/PDF|text|Markdown/i);
    // No source row, no chunks, no binary — the allowlist rejects BEFORE any write.
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_sources"))).toBe(false);
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_files"))).toBe(false);
    expect(h.state.calls.some((c) => c.text.toLowerCase().includes("insert into public.ans_knowledge_chunks"))).toBe(false);
  });
});
