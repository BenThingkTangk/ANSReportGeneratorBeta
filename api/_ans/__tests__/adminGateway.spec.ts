import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  safeEquals,
} from "../../_adminGateway.js";

/**
 * Env-based admin perimeter gateway: password hashing + session signing.
 * Proves the username/password gateway is a real, functioning auth mechanism
 * (not magic-link-only) and that its primitives behave safely. Pure crypto —
 * no Supabase / network needed.
 */
describe("admin gateway — env username/password", () => {
  it("verifies a correct password against its scrypt hash and rejects wrong ones", () => {
    // Use small scrypt params to keep the test fast; format is identical.
    const stored = hashPassword("Correct-Horse-Battery-Staple!", { N: 16384, r: 8, p: 1 });
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Correct-Horse-Battery-Staple!", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$only$three")).toBe(false);
  });

  it("mints and verifies a signed session token (HMAC), rejecting tampering", () => {
    const secret = "test-session-secret-value";
    const token = signSession("admin-user", secret, 3600);
    const ok = verifySession(token, secret);
    expect(ok?.sub).toBe("admin-user");

    // Wrong secret → null.
    expect(verifySession(token, "different-secret")).toBeNull();
    // Tampered body → null.
    const [body, sig] = token.split(".");
    expect(verifySession(`${body}x.${sig}`, secret)).toBeNull();
  });

  it("treats an expired session as invalid", () => {
    const secret = "s";
    const expired = signSession("u", secret, -1); // already expired
    expect(verifySession(expired, secret)).toBeNull();
  });

  it("safeEquals is correct for equal and unequal inputs", () => {
    expect(safeEquals("abc", "abc")).toBe(true);
    expect(safeEquals("abc", "abd")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
  });
});
