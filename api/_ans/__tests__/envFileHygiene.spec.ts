/**
 * Secret-file hygiene regression.
 *
 * The documented local-QA procedure for the serverless routes uses `vercel dev`,
 * which loads local env from a `.env` file (and `vercel env pull` writes
 * `.env.local`). Those files hold REAL credentials (PPLX_API_KEY,
 * HUMANOS_DATABASE_*, ELEVENLABS_*, ADMIN_*). If they are not gitignored, a
 * routine `git add -A` during QA would stage the secrets. This test locks in
 * the ignore rules so that safety gap cannot silently return.
 *
 * It runs `git check-ignore` (the same resolver git itself uses) rather than
 * parsing `.gitignore` by hand, so it stays correct regardless of rule ordering
 * or negation. `.env.example` MUST stay tracked (placeholders only).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");

/** True iff git would ignore `relPath` (matching git's own precedence). */
function isIgnored(relPath: string): boolean {
  try {
    // Exit 0 => ignored, exit 1 => not ignored. `-q` suppresses output.
    execFileSync("git", ["check-ignore", "-q", "--", relPath], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("env-file hygiene (.gitignore)", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.production.local",
    ".env.build",
    ".env.somecustomtarget",
  ])("ignores secret-bearing env file %s", (file) => {
    expect(isIgnored(file)).toBe(true);
  });

  it("keeps the placeholder-only .env.example tracked", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });
});
