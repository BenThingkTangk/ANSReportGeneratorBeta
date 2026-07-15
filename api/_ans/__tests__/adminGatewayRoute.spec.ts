import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import gatewayHandler from "../../admin-gateway.js";
import { requireRole } from "../../_supabase.js";
import {
  hashPassword,
  signSession,
  GATEWAY_COOKIE,
  _resetRateLimit,
} from "../../_adminGateway.js";

/**
 * Admin perimeter gateway — HTTP route + route-protection integration.
 *
 * Proves the env-configured username/password gateway is the real, enforced
 * admin auth path (NOT the removed Supabase magic-link flow):
 *   - valid credentials mint a signed HttpOnly/Secure/SameSite session cookie;
 *   - wrong username AND wrong password both fail with the same generic 401;
 *   - repeated failures trip a rate-limit lockout (429 + Retry-After);
 *   - logout clears the cookie;
 *   - requireRole() authorizes admin APIs off the gateway cookie alone and
 *     rejects unauthenticated / under-privileged requests;
 *   - no secret (password, hash, or session secret) ever appears in a response.
 *
 * Pure handler-level drive with mock req/res — no network, no Supabase.
 */

const USERNAME = "op-admin";
const PASSWORD = "S3cure-Gateway-Pass!";
const SECRET = "unit-test-session-secret-please-ignore";

function mockRes() {
  const res: any = {
    _status: 200,
    _json: undefined as any,
    _sent: undefined as any,
    _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(p: any) { this._json = p; return this; },
    send(p: any) { this._sent = p; return this; },
    setHeader(k: string, v: any) { this._headers[String(k)] = String(v); return this; },
    getHeader(k: string) { return this._headers[String(k)]; },
    end() { return this; },
  };
  return res;
}

function mockReq(
  method: string,
  opts: { body?: any; cookie?: string; xff?: string } = {},
): any {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.xff) headers["x-forwarded-for"] = opts.xff;
  return { method, body: opts.body, headers, cookies: {}, socket: { remoteAddress: "127.0.0.1" } };
}

/** Extract the gateway token minted into a Set-Cookie header, if any. */
function cookieTokenFrom(res: ReturnType<typeof mockRes>): string | null {
  const sc = res._headers["Set-Cookie"];
  if (!sc) return null;
  const m = sc.match(new RegExp(`${GATEWAY_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}

describe("admin gateway route — login / lockout / logout / protection", () => {
  const prev = {
    u: process.env.ADMIN_GATEWAY_USERNAME,
    h: process.env.ADMIN_GATEWAY_PASSWORD_HASH,
    s: process.env.ADMIN_SESSION_SECRET,
    max: process.env.ADMIN_GATEWAY_MAX_ATTEMPTS,
  };

  beforeAll(() => {
    process.env.ADMIN_GATEWAY_USERNAME = USERNAME;
    process.env.ADMIN_GATEWAY_PASSWORD_HASH = hashPassword(PASSWORD);
    process.env.ADMIN_SESSION_SECRET = SECRET;
    process.env.ADMIN_GATEWAY_MAX_ATTEMPTS = "5";
  });

  afterAll(() => {
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? delete (process.env as any)[k] : ((process.env as any)[k] = v);
    restore("ADMIN_GATEWAY_USERNAME", prev.u);
    restore("ADMIN_GATEWAY_PASSWORD_HASH", prev.h);
    restore("ADMIN_SESSION_SECRET", prev.s);
    restore("ADMIN_GATEWAY_MAX_ATTEMPTS", prev.max);
  });

  beforeEach(() => _resetRateLimit());

  it("accepts valid credentials and mints a hardened session cookie", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: PASSWORD } }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ success: true, authenticated: true });

    const sc = res._headers["Set-Cookie"];
    expect(sc).toContain(`${GATEWAY_COOKIE}=`);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Secure");
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toContain("Path=/");
    // The minted cookie is a signed token, never the plaintext password/secret.
    const token = cookieTokenFrom(res)!;
    expect(token.length).toBeGreaterThan(0);
    expect(token).not.toContain(PASSWORD);
    expect(token).not.toContain(SECRET);
  });

  it("rejects a wrong password with a generic 401 (no enumeration)", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: "nope" } }), res);
    expect(res._status).toBe(401);
    expect(res._json.success).toBe(false);
    expect(res._json.error).toMatch(/invalid username or password/i);
    expect(res._headers["Set-Cookie"]).toBeUndefined();
  });

  it("rejects a wrong username with the SAME generic 401", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: "someone-else", password: PASSWORD } }), res);
    expect(res._status).toBe(401);
    expect(res._json.error).toMatch(/invalid username or password/i);
  });

  it("requires both fields", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME } }), res);
    expect(res._status).toBe(400);
    expect(res._json.success).toBe(false);
  });

  it("locks out after repeated failures (429 + Retry-After)", async () => {
    // Distinct IP so the shared limiter starts clean for this case.
    const ip = "203.0.113.7";
    let last = mockRes();
    for (let i = 0; i < 4; i++) {
      last = mockRes();
      await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: "bad" }, xff: ip }), last);
      expect(last._status).toBe(401);
    }
    // 5th failure hits the threshold → lockout.
    const locked = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: "bad" }, xff: ip }), locked);
    expect(locked._status).toBe(429);
    expect(Number(locked._json.retryAfterSec)).toBeGreaterThan(0);
    expect(locked._headers["Retry-After"]).toBeTruthy();

    // Even the correct password is refused while locked out.
    const stillLocked = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: PASSWORD }, xff: ip }), stillLocked);
    expect(stillLocked._status).toBe(429);
  });

  it("GET reports configured + authenticated state from the cookie", async () => {
    const unauth = mockRes();
    await gatewayHandler(mockReq("GET"), unauth);
    expect(unauth._json).toMatchObject({ configured: true, authenticated: false });

    const token = signSession(USERNAME, SECRET);
    const auth = mockRes();
    await gatewayHandler(mockReq("GET", { cookie: `${GATEWAY_COOKIE}=${token}` }), auth);
    expect(auth._json).toMatchObject({ configured: true, authenticated: true });
  });

  it("DELETE clears the session cookie (logout)", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("DELETE"), res);
    expect(res._status).toBe(200);
    expect(res._headers["Set-Cookie"]).toMatch(/Max-Age=0/);
  });

  it("requireRole authorizes admin APIs off a valid gateway cookie", async () => {
    const token = signSession(USERNAME, SECRET);
    const req = mockReq("GET", { cookie: `${GATEWAY_COOKIE}=${token}` });
    const admin = await requireRole(req, ["super_admin", "clinical_admin"]);
    expect(admin.role).toBe("super_admin");
    expect(admin.id).toBeNull(); // no per-user Supabase identity in gateway mode
    expect(admin.email).toBe(USERNAME);
  });

  it("requireRole rejects a request with no gateway cookie (401)", async () => {
    await expect(requireRole(mockReq("GET"), ["super_admin"])).rejects.toMatchObject({ statusCode: 401 });
  });

  it("requireRole forbids when super_admin is not an allowed role (403)", async () => {
    const token = signSession(USERNAME, SECRET);
    const req = mockReq("GET", { cookie: `${GATEWAY_COOKIE}=${token}` });
    await expect(requireRole(req, ["reviewer"])).rejects.toMatchObject({ statusCode: 403 });
  });

  it("requireRole rejects a tampered/forged cookie (401)", async () => {
    const forged = signSession(USERNAME, "attacker-guessed-secret");
    const req = mockReq("GET", { cookie: `${GATEWAY_COOKIE}=${forged}` });
    await expect(requireRole(req, ["super_admin"])).rejects.toMatchObject({ statusCode: 401 });
  });

  it("never leaks the password, hash, or session secret in any response", async () => {
    const res = mockRes();
    await gatewayHandler(mockReq("POST", { body: { username: USERNAME, password: PASSWORD } }), res);
    const serialized = JSON.stringify(res._json) + JSON.stringify(res._headers);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(process.env.ADMIN_GATEWAY_PASSWORD_HASH as string);
  });
});
