import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import knowledgeHandler from "../../admin/knowledge.js";
import {
  backendConfigStatus,
  isBackendUnreachable,
  backendError,
  supabaseUrl,
  supabaseServiceRoleKey,
} from "../../_supabase.js";
import { _resetPoolForTests } from "../../_ragDb.js";
import {
  hashPassword,
  signSession,
  GATEWAY_COOKIE,
} from "../../_adminGateway.js";

/**
 * Admin Knowledge (RAG inventory) route — backend connection + error contract.
 *
 * The knowledge routes now read/write the dedicated Akamai Managed PostgreSQL
 * instance (humanos-ans-rag-pg) via api/_ragDb — NOT Supabase REST. Block 1
 * pins the fixed contract on the REAL route handler:
 *   - auth is enforced via the gateway session cookie BEFORE the backend is
 *     touched (no config probing pre-auth, no backend var leaked to anon);
 *   - a missing / malformed HUMANOS_DATABASE_URL (or missing
 *     HUMANOS_DATABASE_CA_CERT) yields a precise, SECRET-FREE 503 that names the
 *     offending variable — never a raw `TypeError: fetch failed`;
 *   - no secret (connection string value, host, password) ever appears in an
 *     error message.
 * These config-error paths short-circuit in getPool() BEFORE a pg Pool is ever
 * constructed, so no network / live PostgreSQL is required. (Full CRUD, SQL
 * injection, schema-missing, vector, and pool behaviour are covered against a
 * mocked `pg` in ragKnowledgePg.spec.ts.)
 *
 * Blocks 2-4 pin the retained Supabase config/error helpers in _supabase.ts —
 * still used for the OPTIONAL knowledge-file Storage upload path and the gated
 * evidence-retrieval read path — which are unchanged by the PostgreSQL move.
 *
 * Pure handler-level drive with mock req/res — no network, no live backend.
 */

const GW_USER = "admin";
const GW_PASSWORD = "Knowledge-Route-Test!";
const GW_SECRET = "knowledge-route-session-secret";

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

function mockReq(opts: { cookie?: string; query?: Record<string, string> } = {}): any {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    method: "GET",
    query: opts.query ?? { page: "1", limit: "50" },
    headers,
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function gatewayCookie(): string {
  return `${GATEWAY_COOKIE}=${signSession(GW_USER, GW_SECRET)}`;
}

/** Set or clear the Supabase backend env for a single test (blocks 2-4). */
function setBackend(url: string | undefined, key: string | undefined) {
  if (url === undefined) delete (process.env as any).SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete (process.env as any).SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
}

/** Set or clear the Akamai PostgreSQL (RAG) backend env for a single test. */
function setRagBackend(url: string | undefined, ca: string | undefined) {
  if (url === undefined) delete (process.env as any).HUMANOS_DATABASE_URL;
  else process.env.HUMANOS_DATABASE_URL = url;
  if (ca === undefined) delete (process.env as any).HUMANOS_DATABASE_CA_CERT;
  else process.env.HUMANOS_DATABASE_CA_CERT = ca;
}

// A syntactically-plausible PEM so the CA-present branch is exercised; never a
// real certificate, and never asserted on (it must never appear in any error).
const VALID_CA =
  "-----BEGIN CERTIFICATE-----\nMIIBcTESTONLYTESTONLYTESTONLYTESTONLY==\n-----END CERTIFICATE-----\n";

const prev = {
  u: process.env.ADMIN_GATEWAY_USERNAME,
  h: process.env.ADMIN_GATEWAY_PASSWORD_HASH,
  s: process.env.ADMIN_SESSION_SECRET,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ragUrl: process.env.HUMANOS_DATABASE_URL,
  ragCa: process.env.HUMANOS_DATABASE_CA_CERT,
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
  restore("ADMIN_GATEWAY_PASSWORD_HASH", prev.h);
  restore("ADMIN_SESSION_SECRET", prev.s);
  restore("SUPABASE_URL", prev.url);
  restore("SUPABASE_SERVICE_ROLE_KEY", prev.key);
  restore("HUMANOS_DATABASE_URL", prev.ragUrl);
  restore("HUMANOS_DATABASE_CA_CERT", prev.ragCa);
});

describe("admin knowledge route — auth-first + precise Akamai PostgreSQL config status", () => {
  // Each test only exercises config-error paths (no pool is ever built), but
  // reset the singleton defensively so no state leaks between tests.
  afterEach(async () => {
    await _resetPoolForTests();
  });

  it("rejects an unauthenticated GET with 401 (gateway session enforced, backend untouched)", async () => {
    setRagBackend(undefined, undefined); // even with no backend env, auth must fail first
    const res = mockRes();
    await knowledgeHandler(mockReq(/* no cookie */), res);
    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({ success: false });
    // Must not leak backend config state to an unauthenticated caller.
    expect(String(res._json.error)).not.toMatch(/HUMANOS_DATABASE_URL/);
  });

  it("returns a precise, secret-free 503 (not a raw TypeError) when HUMANOS_DATABASE_URL is unset", async () => {
    setRagBackend(undefined, VALID_CA);
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie() }), res);
    expect(res._status).toBe(503);
    expect(res._json.success).toBe(false);
    expect(String(res._json.error)).toMatch(/HUMANOS_DATABASE_URL/);
    // The precise contract: NOT the raw low-level transport error.
    expect(String(res._json.error)).not.toMatch(/fetch failed|TypeError/i);
  });

  it("names HUMANOS_DATABASE_CA_CERT in the 503 when only the CA certificate is missing", async () => {
    setRagBackend(
      "postgres://u:p@db.example-ref.akamai.internal:5432/ans?sslmode=require",
      undefined
    );
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie() }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).toMatch(/HUMANOS_DATABASE_CA_CERT/);
  });

  it("returns 503 with a connection-string hint when HUMANOS_DATABASE_URL is malformed", async () => {
    setRagBackend("not-a-valid-url", VALID_CA);
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie() }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).toMatch(/HUMANOS_DATABASE_URL/);
    expect(String(res._json.error)).toMatch(/postgres|connection string/i);
  });

  it("never echoes the HUMANOS_DATABASE_URL VALUE in an error (no secret leakage)", async () => {
    const secretishUrl =
      "postgres://admin:sup3rs3cretpw@supersecrethost.akamai.internal:5432/ans";
    setRagBackend(secretishUrl, undefined); // CA missing → 503 config path
    const res = mockRes();
    await knowledgeHandler(mockReq({ cookie: gatewayCookie() }), res);
    expect(res._status).toBe(503);
    expect(String(res._json.error)).not.toContain(secretishUrl);
    expect(String(res._json.error)).not.toContain("sup3rs3cretpw");
    expect(String(res._json.error)).not.toContain("supersecrethost");
  });
});

describe("backendConfigStatus() — env presence, URL validity, whitespace tolerance", () => {
  it("reports configured when both vars are present and the URL is a valid https URL", () => {
    setBackend("https://ref123.supabase.co", "service-role-key");
    expect(backendConfigStatus()).toEqual({ configured: true });
  });

  it("trims a Vercel-pasted leading/trailing newline/space on both vars", () => {
    setBackend("  \nhttps://ref123.supabase.co\n ", "\n service-role-key \n");
    expect(backendConfigStatus().configured).toBe(true);
    // The trimmed value is what the client would actually be built with.
    expect(supabaseUrl()).toBe("https://ref123.supabase.co");
    expect(supabaseServiceRoleKey()).toBe("service-role-key");
  });

  it("flags a missing SUPABASE_URL by NAME", () => {
    setBackend(undefined, "service-role-key");
    const cfg = backendConfigStatus();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain("SUPABASE_URL");
    expect(cfg.detail).toMatch(/SUPABASE_URL/);
  });

  it("flags a missing SUPABASE_SERVICE_ROLE_KEY by NAME", () => {
    setBackend("https://ref123.supabase.co", undefined);
    const cfg = backendConfigStatus();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("treats a whitespace-only value as unset", () => {
    setBackend("   \n  ", "service-role-key");
    expect(backendConfigStatus().missing).toContain("SUPABASE_URL");
  });

  it("rejects a non-http(s) or malformed URL", () => {
    setBackend("ftp://ref123.supabase.co", "service-role-key");
    expect(backendConfigStatus().configured).toBe(false);
    setBackend("garbage-not-a-url", "service-role-key");
    expect(backendConfigStatus().configured).toBe(false);
  });
});

describe("isBackendUnreachable() — transport vs query classification", () => {
  it("classifies a bare undici fetch failure as unreachable", () => {
    expect(isBackendUnreachable({ message: "TypeError: fetch failed" })).toBe(true);
  });

  it("classifies DNS / connection errors in the PostgREST details as unreachable", () => {
    expect(
      isBackendUnreachable({ message: "fetch failed", details: "Error: getaddrinfo ENOTFOUND ref.supabase.co" })
    ).toBe(true);
    expect(isBackendUnreachable({ message: "x", details: "connect ECONNREFUSED 1.2.3.4:443" })).toBe(true);
  });

  it("does NOT classify a genuine PostgREST query error as unreachable", () => {
    expect(isBackendUnreachable({ message: 'column "foo" does not exist', code: "42703" })).toBe(false);
    expect(isBackendUnreachable({ message: "permission denied for table", code: "42501" })).toBe(false);
  });
});

describe("backendError() — precise, secret-free status mapping", () => {
  it("maps a transport failure to 503 naming SUPABASE_URL, hiding the raw TypeError", () => {
    const e = backendError({ message: "TypeError: fetch failed", details: "getaddrinfo ENOTFOUND secret-ref.supabase.co" });
    expect(e.statusCode).toBe(503);
    expect(e.message).toMatch(/SUPABASE_URL/);
    expect(e.message).not.toMatch(/fetch failed|TypeError/i);
    // Underlying host / details are never forwarded.
    expect(e.message).not.toContain("secret-ref.supabase.co");
    expect(e.message).not.toContain("ENOTFOUND");
  });

  it("preserves a genuine (non-secret) query error as 400", () => {
    const e = backendError({ message: 'column "foo" does not exist', code: "42703" });
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('column "foo" does not exist');
  });
});
