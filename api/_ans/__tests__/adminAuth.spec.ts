/**
 * Admin username/password auth — end-to-end unit/integration coverage.
 *
 * Exercises the REAL serverless handlers (login/session/logout) and the shared
 * session module + requireRole protection, with ADMIN_USERNAME / ADMIN_PASSWORD /
 * ADMIN_SESSION_SECRET set to TEST values (never real credentials). Pure crypto +
 * handler doubles — no Supabase or network needed.
 *
 * Covers: correct login, wrong username, wrong password, missing fields,
 * non-JSON / cross-origin rejection, session persistence via the minted cookie,
 * tampered + expired cookie rejection, logout clears the cookie, and
 * requireRole route protection (unauthenticated 401, authenticated ok).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  signSession,
  verifySession,
  verifyRequest,
  readSessionToken,
  ADMIN_SESSION_COOKIE,
  ADMIN_SUBJECT,
} from "../../_adminSession.js";
import { _resetRateLimit } from "../../_adminGateway.js";

const USER = "test-admin";
const PASS = "test-Password-123!";
const SECRET = "test-session-secret-value-please-rotate";

beforeEach(() => {
  process.env.ADMIN_USERNAME = USER;
  process.env.ADMIN_PASSWORD = PASS;
  process.env.ADMIN_SESSION_SECRET = SECRET;
  delete process.env.ADMIN_GATEWAY_USERNAME; // ensure legacy gateway is inactive
  _resetRateLimit();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── Vercel handler doubles ──────────────────────────────────────────────────
interface Result {
  status: number;
  json: any;
  headers: Record<string, string | string[]>;
}
function makeReq(opts: {
  method: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  host?: string;
  contentType?: string | null;
}): any {
  const req = new EventEmitter() as any;
  req.method = opts.method;
  req.headers = {};
  const host = opts.host ?? "humanos-ans-diagnostic.vercel.app";
  req.headers.host = host;
  if (opts.origin !== null) req.headers.origin = opts.origin ?? `https://${host}`;
  if (opts.contentType !== null) req.headers["content-type"] = opts.contentType ?? "application/json";
  if (opts.cookie) req.headers.cookie = opts.cookie;
  req.socket = { remoteAddress: "127.0.0.1" };
  req.body = opts.body;
  return req;
}
async function invoke(handlerPath: string, req: any): Promise<Result> {
  const mod = await import(handlerPath);
  const handler = mod.default;
  return await new Promise<Result>((resolve, reject) => {
    const headers: Record<string, string | string[]> = {};
    const res: any = {
      _status: 200,
      status(code: number) { this._status = code; return this; },
      setHeader(k: string, v: string | string[]) { headers[k] = v; return this; },
      json(payload: any) { resolve({ status: this._status, json: payload, headers }); return this; },
      end() { resolve({ status: this._status, json: null, headers }); return this; },
    };
    handler(req, res).catch(reject);
  });
}

/** Extract the session cookie VALUE from a Set-Cookie header. */
function cookieFromSetCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const m = raw.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}

describe("admin auth — session module", () => {
  it("mints and verifies a signed session, rejecting tamper/wrong-secret/expiry", () => {
    const token = signSession(ADMIN_SUBJECT, SECRET, 3600);
    expect(verifySession(token, SECRET)?.sub).toBe(ADMIN_SUBJECT);
    expect(verifySession(token, "other-secret")).toBeNull();
    const [body, sig] = token.split(".");
    expect(verifySession(`${body}x.${sig}`, SECRET)).toBeNull();
    expect(verifySession(signSession(ADMIN_SUBJECT, SECRET, -1), SECRET)).toBeNull();
  });

  it("verifyRequest reads the cookie and validates it", () => {
    const token = signSession(ADMIN_SUBJECT, SECRET, 3600);
    const req = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}` });
    expect(verifyRequest(req)?.sub).toBe(ADMIN_SUBJECT);
    // Tampered cookie → null.
    const bad = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}TAMPER` });
    expect(verifyRequest(bad)).toBeNull();
    // No cookie → null.
    expect(verifyRequest(makeReq({ method: "GET" }))).toBeNull();
  });
});

describe("POST /api/admin/login", () => {
  it("accepts correct credentials and sets an HttpOnly/Secure/SameSite=Strict cookie", async () => {
    const req = makeReq({ method: "POST", body: { username: USER, password: PASS } });
    const r = await invoke("../../admin/login.ts", req);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    const setCookie = r.headers["Set-Cookie"] as string;
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    // The minted cookie is a valid session.
    const token = cookieFromSetCookie(setCookie)!;
    expect(verifySession(token, SECRET)?.sub).toBe(ADMIN_SUBJECT);
  });

  it("rejects a wrong password (401)", async () => {
    const r = await invoke("../../admin/login.ts", makeReq({ method: "POST", body: { username: USER, password: "nope" } }));
    expect(r.status).toBe(401);
    expect(r.json.success).toBe(false);
    expect(r.headers["Set-Cookie"]).toBeUndefined();
  });

  it("rejects a wrong username (401, indistinguishable from wrong password)", async () => {
    const r = await invoke("../../admin/login.ts", makeReq({ method: "POST", body: { username: "someone-else", password: PASS } }));
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("Invalid username or password");
  });

  it("rejects missing fields (400)", async () => {
    const r = await invoke("../../admin/login.ts", makeReq({ method: "POST", body: { username: USER } }));
    expect(r.status).toBe(400);
  });

  it("rejects a cross-origin POST (403)", async () => {
    const req = makeReq({ method: "POST", body: { username: USER, password: PASS }, origin: "https://evil.example.com" });
    const r = await invoke("../../admin/login.ts", req);
    expect(r.status).toBe(403);
  });

  it("rejects a non-JSON content type (415)", async () => {
    const req = makeReq({ method: "POST", body: { username: USER, password: PASS }, contentType: "application/x-www-form-urlencoded" });
    const r = await invoke("../../admin/login.ts", req);
    expect(r.status).toBe(415);
  });
});

describe("GET /api/admin/session", () => {
  it("reports authenticated for a valid cookie and unauthenticated otherwise", async () => {
    const token = signSession(ADMIN_SUBJECT, SECRET, 3600);
    const ok = await invoke("../../admin/session.ts", makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}` }));
    expect(ok.status).toBe(200);
    expect(ok.json.configured).toBe(true);
    expect(ok.json.authenticated).toBe(true);
    expect(ok.json.username).toBe(USER);

    const anon = await invoke("../../admin/session.ts", makeReq({ method: "GET" }));
    expect(anon.json.authenticated).toBe(false);
    expect(anon.json.username).toBeNull();
  });

  it("treats an expired cookie as unauthenticated", async () => {
    const expired = signSession(ADMIN_SUBJECT, SECRET, -1);
    const r = await invoke("../../admin/session.ts", makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${expired}` }));
    expect(r.json.authenticated).toBe(false);
  });
});

describe("POST /api/admin/logout", () => {
  it("clears the cookie (Max-Age=0)", async () => {
    const r = await invoke("../../admin/logout.ts", makeReq({ method: "POST" }));
    expect(r.status).toBe(200);
    const setCookie = r.headers["Set-Cookie"] as string;
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=;`);
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("requireRole — route protection via the session cookie", () => {
  it("throws 401 without a valid cookie and returns super_admin with one", async () => {
    const { requireRole } = await import("../../_supabase.js");
    // Unauthenticated → 401
    await expect(requireRole(makeReq({ method: "GET" }), ["super_admin", "clinical_admin", "reviewer"]))
      .rejects.toMatchObject({ statusCode: 401 });

    // Authenticated with a minted cookie → resolves as super_admin.
    const token = signSession(ADMIN_SUBJECT, SECRET, 3600);
    const req = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}` });
    const user = await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
    expect(user.role).toBe("super_admin");
    expect(user.email).toBe(USER);
  });

  it("rejects a tampered cookie (401)", async () => {
    const { requireRole } = await import("../../_supabase.js");
    const token = signSession(ADMIN_SUBJECT, SECRET, 3600);
    const req = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}TAMPER` });
    await expect(requireRole(req, ["super_admin"])).rejects.toMatchObject({ statusCode: 401 });
  });

  it("full flow: login → use minted cookie to pass requireRole → logout invalidates client state", async () => {
    // Login
    const login = await invoke("../../admin/login.ts", makeReq({ method: "POST", body: { username: USER, password: PASS } }));
    const token = cookieFromSetCookie(login.headers["Set-Cookie"] as string)!;
    expect(token).toBeTruthy();

    // Use the cookie to authorize an admin action.
    const { requireRole } = await import("../../_supabase.js");
    const req = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${token}` });
    const user = await requireRole(req, ["super_admin"]);
    expect(user.role).toBe("super_admin");

    // Logout clears the cookie; a cleared (empty) cookie no longer authorizes.
    const logout = await invoke("../../admin/logout.ts", makeReq({ method: "POST" }));
    expect((logout.headers["Set-Cookie"] as string)).toContain("Max-Age=0");
    const emptyReq = makeReq({ method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=` });
    expect(readSessionToken(emptyReq) || null).toBeNull(); // empty value → no usable token
    await expect(requireRole(emptyReq, ["super_admin"])).rejects.toMatchObject({ statusCode: 401 });
  });
});
