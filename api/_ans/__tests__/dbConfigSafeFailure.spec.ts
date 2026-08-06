/**
 * Database configuration contract — safe, explicit failure.
 *
 * Live finding this locks down: the deployed Supabase project ref
 * `xsjwubnmcivsskumvgyy` answers `{"message":"Project not found"}`, and before
 * this change the app either 500-ed with an opaque "must be set" string or
 * silently behaved as if the knowledge corpus were empty. An operator could not
 * tell "misconfigured" from "nothing ingested".
 *
 * These tests assert that:
 *   1. configuration is expressed as env var NAMES only (easy to re-point),
 *   2. no secret value is ever returned by the diagnostics surface,
 *   3. each real failure class maps to a specific, actionable remediation,
 *   4. absence of config is a SAFE failure, not a crash.
 *
 * Pure unit tests: no network, no Supabase client.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SERVER_DB_ENV_VARS,
  CLIENT_DB_ENV_VARS,
  AI_ENV_VARS,
  parseProjectRef,
  resolveDbConfig,
  isDbConfigured,
  DbConfigError,
  dbNotConfiguredError,
  describeDbError,
  configReport,
} from "../dbConfig.js";
import { retrieveCandidates } from "../hybridRetrieval.js";

const SECRET_LOOKING_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-secret.signature";
const TOUCHED = [
  ...SERVER_DB_ENV_VARS,
  ...CLIENT_DB_ENV_VARS,
  ...AI_ENV_VARS,
] as readonly string[];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("env var contract", () => {
  it("names the server, client and AI variables without embedding any value", () => {
    expect([...SERVER_DB_ENV_VARS]).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect([...CLIENT_DB_ENV_VARS]).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);
    expect([...AI_ENV_VARS]).toEqual(["PPLX_API_KEY"]);
  });

  it("keeps the service-role key server-side only (never a VITE_ variable)", () => {
    for (const name of CLIENT_DB_ENV_VARS) {
      expect(name).not.toMatch(/SERVICE_ROLE/);
    }
    for (const name of SERVER_DB_ENV_VARS) {
      expect(name).not.toMatch(/^VITE_/);
    }
  });
});

describe("parseProjectRef", () => {
  it("extracts the public project ref from a Supabase URL", () => {
    expect(parseProjectRef("https://xsjwubnmcivsskumvgyy.supabase.co")).toBe("xsjwubnmcivsskumvgyy");
    expect(parseProjectRef("https://abcdefghij.supabase.co/")).toBe("abcdefghij");
  });

  it("returns null for self-hosted or malformed URLs instead of throwing", () => {
    expect(parseProjectRef("https://db.internal.example.com")).toBeNull();
    expect(parseProjectRef("not a url")).toBeNull();
    expect(parseProjectRef(null)).toBeNull();
    expect(parseProjectRef(undefined)).toBeNull();
  });
});

describe("resolveDbConfig", () => {
  it("reports both variables missing when the environment is empty", () => {
    const cfg = resolveDbConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(isDbConfigured()).toBe(false);
  });

  it("treats blank / whitespace-only values as absent", () => {
    process.env.SUPABASE_URL = "   ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(resolveDbConfig().configured).toBe(false);
    expect(resolveDbConfig().missing).toContain("SUPABASE_URL");
    expect(resolveDbConfig().missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("is configured, and re-pointable, purely from the environment", () => {
    process.env.SUPABASE_URL = "https://newprojectref.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_LOOKING_KEY;
    const cfg = resolveDbConfig();
    expect(cfg.configured).toBe(true);
    expect(cfg.projectRef).toBe("newprojectref");
    expect(cfg.missing).toEqual([]);
    expect(cfg.problems).toEqual([]);
  });

  it("rejects a non-https URL and a malformed URL with a stated problem", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_LOOKING_KEY;
    process.env.SUPABASE_URL = "http://someproject.supabase.co";
    expect(resolveDbConfig().configured).toBe(false);
    expect(resolveDbConfig().problems.join(" ")).toMatch(/https/i);

    process.env.SUPABASE_URL = "xsjwubnmcivsskumvgyy";
    expect(resolveDbConfig().configured).toBe(false);
    expect(resolveDbConfig().problems.join(" ")).toMatch(/valid absolute URL/i);
  });
});

describe("configReport (diagnostics surface)", () => {
  it("never leaks a secret value — presence only", () => {
    process.env.SUPABASE_URL = "https://liveproject.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_LOOKING_KEY;
    process.env.PPLX_API_KEY = "pplx-super-secret-value";

    const report = configReport();
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(SECRET_LOOKING_KEY);
    expect(serialised).not.toContain("pplx-super-secret-value");
    expect(serialised).not.toMatch(/eyJhbGciOi/);

    expect(report.database.configured).toBe(true);
    expect(report.database.projectRef).toBe("liveproject");
    expect(report.ai.configured).toBe(true);
  });

  it("lists exactly which names are missing when nothing is set", () => {
    const report = configReport();
    expect(report.database.configured).toBe(false);
    expect(report.database.missingEnvVars).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(report.ai.configured).toBe(false);
    expect(report.ai.missingEnvVars).toEqual(["PPLX_API_KEY"]);
    expect(report.database.clientEnvVars).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);
  });
});

describe("DbConfigError", () => {
  it("serialises an actionable, secret-free 503 body", () => {
    const err = dbNotConfiguredError();
    expect(err).toBeInstanceOf(DbConfigError);
    expect(err.statusCode).toBe(503);
    expect(err.kind).toBe("not_configured");
    const body = err.toJSON();
    expect(body.success).toBe(false);
    expect(body.requiredEnvVars).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(body.remediation).toMatch(/SUPABASE_URL/);
    expect(body.remediation).toMatch(/not hard-coded/i);
  });
});

describe("describeDbError — real failure classes", () => {
  beforeEach(() => {
    // Configured, so classification is not short-circuited by "not_configured".
    process.env.SUPABASE_URL = "https://xsjwubnmcivsskumvgyy.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_LOOKING_KEY;
  });

  it("classifies the observed 'Project not found' response and names the ref", () => {
    const d = describeDbError({ message: "Project not found" });
    expect(d.kind).toBe("project_not_found");
    expect(d.message).toContain("xsjwubnmcivsskumvgyy");
    expect(d.remediation).toMatch(/SUPABASE_URL/);
    expect(d.remediation).toMatch(/migrations/i);
  });

  it("classifies a rejected credential", () => {
    expect(describeDbError({ status: 401, message: "Invalid API key" }).kind).toBe("unauthorized");
    expect(describeDbError({ message: "permission denied for table x" }).kind).toBe("unauthorized");
  });

  it("classifies an unreachable host", () => {
    expect(describeDbError({ message: "fetch failed" }).kind).toBe("unreachable");
    expect(describeDbError({ message: "getaddrinfo ENOTFOUND" }).kind).toBe("unreachable");
  });

  it("classifies the missing table / missing column / missing function cases", () => {
    expect(describeDbError({ code: "42P01" }).kind).toBe("missing_relation");

    // The exact live defect: the old match function selected s.status,
    // s.is_active and s.citation, none of which exist.
    const col = describeDbError({ code: "42703", message: 'column s.is_active does not exist' });
    expect(col.kind).toBe("missing_column");
    expect(col.remediation).toMatch(/review_status/);
    expect(col.remediation).toMatch(/active_in_ai_analysis/);

    expect(describeDbError({ code: "PGRST202" }).kind).toBe("missing_function");
    expect(describeDbError({ code: "42883" }).remediation).toMatch(/match_ans_knowledge_chunks/);
  });

  it("falls back to 'unknown' without throwing on odd inputs", () => {
    expect(describeDbError(null).kind).toBe("unknown");
    expect(describeDbError("boom").kind).toBe("unknown");
    expect(describeDbError(new Error("something weird")).kind).toBe("unknown");
  });

  it("short-circuits to 'not_configured' when the env is empty", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(describeDbError({ code: "42P01" }).kind).toBe("not_configured");
  });
});

describe("safe failure when the database is absent", () => {
  it("retrieveCandidates(null) reports mode 'unavailable' instead of throwing", async () => {
    const outcome = await retrieveCandidates(null, "what does low RFa mean?", async () => []);
    expect(outcome.mode).toBe("unavailable");
    expect(outcome.rows).toEqual([]);
    expect(outcome.fallbackReason).toMatch(/SUPABASE_URL/);
    expect(outcome.fallbackReason).toMatch(/report only/i);
  });

  it("retrieveCandidates(undefined) is equally safe", async () => {
    const outcome = await retrieveCandidates(undefined, "question", async () => []);
    expect(outcome.mode).toBe("unavailable");
    expect(outcome.rows).toEqual([]);
  });

  it("never invokes the lexical loader when there is no database", async () => {
    let called = 0;
    await retrieveCandidates(null, "question", async () => {
      called += 1;
      return [];
    });
    expect(called).toBe(0);
  });
});
