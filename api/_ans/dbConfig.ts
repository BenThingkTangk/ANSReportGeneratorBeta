/**
 * api/_ans/dbConfig.ts
 *
 * SINGLE SOURCE OF TRUTH for the Supabase / Postgres connection contract.
 *
 * WHY THIS EXISTS
 * The project reference that shipped in earlier deployments
 * (`xsjwubnmcivsskumvgyy`) no longer resolves — the platform answers
 * `{"message":"Project not found"}` for every request. Previously that produced
 * either an opaque 500 ("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be
 * set") or a silent empty corpus, so an operator could not tell "misconfigured"
 * apart from "no knowledge loaded".
 *
 * This module makes the configuration:
 *   1. EASY TO CHANGE — the whole contract is a list of env var NAMES here.
 *      Point the deployment at a new project by changing SUPABASE_URL +
 *      SUPABASE_SERVICE_ROLE_KEY (and the VITE_ pair for the browser). No code
 *      edit, no hard-coded project ref anywhere in the runtime path.
 *   2. FAIL LOUDLY AND SPECIFICALLY — `describeDbError()` maps the real failure
 *      classes (project not found, bad key, missing table/column/function) to an
 *      actionable message naming the exact remediation.
 *   3. FAIL SAFELY WHERE SAFETY MATTERS — `tryCreateSupabaseAdmin()` (api/_supabase.ts) returns null
 *      instead of throwing, so a read-only, non-essential path (knowledge
 *      retrieval) degrades to report-only grounding rather than 500-ing an
 *      answer that does not need the database at all.
 *
 * NO SECRET VALUE is ever returned, logged or embedded here — only names,
 * booleans, and the (public) project ref parsed from the URL.
 *
 * This module performs NO clinical computation and never touches .ans parsing.
 */

/** Server-side (service-role) variables. Never expose to the client. */
export const SERVER_DB_ENV_VARS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
/** Browser (Vite) variables. Anon key only — safe to expose. */
export const CLIENT_DB_ENV_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;
/** Server-side AI/embedding provider variables. */
export const AI_ENV_VARS = ["PPLX_API_KEY"] as const;
/** Optional embedding tuning — must match the DB vector(N) column if changed. */
export const AI_OPTIONAL_ENV_VARS = ["EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS"] as const;

export type DbFailureKind =
  | "not_configured"
  | "project_not_found"
  | "unauthorized"
  | "unreachable"
  | "missing_relation"
  | "missing_column"
  | "missing_function"
  | "unknown";

export interface DbConfigResult {
  /** True only when BOTH server vars are present and the URL parses. */
  configured: boolean;
  /** Env var names that are absent or blank. Names only — never values. */
  missing: string[];
  /** Non-fatal or fatal configuration complaints, in plain language. */
  problems: string[];
  /** Supabase project ref parsed from the URL (public identifier), or null. */
  projectRef: string | null;
  /** Normalised base URL (no trailing slash), or null when unusable. */
  url: string | null;
}

/** Trimmed env read that treats "" and whitespace as absent. */
function envVal(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Parse the Supabase project ref out of a project URL.
 * `https://abcdefghijklmnop.supabase.co` → `abcdefghijklmnop`.
 * Returns null for self-hosted / non-matching hosts (which is legal, not an error).
 */
export function parseProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const m = /^([a-z0-9-]+)\.supabase\.(co|in|net)$/i.exec(host);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the server-side database configuration. Pure with respect to the
 * environment: no network call, no client construction, never throws.
 */
export function resolveDbConfig(): DbConfigResult {
  const missing: string[] = [];
  const problems: string[] = [];

  const rawUrl = envVal("SUPABASE_URL");
  const key = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!rawUrl) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  let url: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        problems.push("SUPABASE_URL must use https:// (only localhost may use http).");
      }
      url = `${u.origin}`;
    } catch {
      problems.push("SUPABASE_URL is not a valid absolute URL (expected https://<project-ref>.supabase.co).");
    }
  }

  const projectRef = parseProjectRef(url);
  const configured = missing.length === 0 && url !== null && problems.length === 0;
  if (missing.length > 0) {
    problems.push(`Missing required environment variable(s): ${missing.join(", ")}.`);
  }

  return { configured, missing, problems, projectRef, url };
}

/** True when the server-side database credentials are fully present. */
export function isDbConfigured(): boolean {
  return resolveDbConfig().configured;
}

/**
 * Thrown by paths that genuinely CANNOT proceed without a database (admin
 * ingestion, backfill, retrieval tests). Carries an HTTP status and a concrete
 * remediation string so the API surface can answer honestly instead of 500-ing
 * with a stack trace.
 */
export class DbConfigError extends Error {
  readonly statusCode: number;
  readonly kind: DbFailureKind;
  readonly remediation: string;
  readonly envVars: readonly string[];

  constructor(opts: {
    message: string;
    kind: DbFailureKind;
    remediation: string;
    statusCode?: number;
    envVars?: readonly string[];
  }) {
    super(opts.message);
    this.name = "DbConfigError";
    this.kind = opts.kind;
    this.remediation = opts.remediation;
    this.statusCode = opts.statusCode ?? 503;
    this.envVars = opts.envVars ?? SERVER_DB_ENV_VARS;
  }

  /** Safe JSON body for an API response. Contains no secret values. */
  toJSON() {
    return {
      success: false,
      error: this.message,
      kind: this.kind,
      remediation: this.remediation,
      requiredEnvVars: [...this.envVars],
    };
  }
}

/** Build the canonical "database is not configured" error. */
export function dbNotConfiguredError(cfg: DbConfigResult = resolveDbConfig()): DbConfigError {
  const detail = cfg.problems.length > 0 ? ` ${cfg.problems.join(" ")}` : "";
  return new DbConfigError({
    message: `Database is not configured.${detail}`,
    kind: "not_configured",
    statusCode: 503,
    envVars: SERVER_DB_ENV_VARS,
    remediation:
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only) for this deployment, plus " +
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the browser bundle, then redeploy. " +
      "The project ref is read from SUPABASE_URL at runtime — it is not hard-coded anywhere.",
  });
}

const PROJECT_NOT_FOUND_RE = /project not found|no project|project.*(does not exist|not exist)/i;
const NETWORK_RE = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i;

/**
 * Classify a Supabase/PostgREST error into an operator-actionable description.
 * Accepts anything (Error, PostgrestError, string) and never throws.
 */
export function describeDbError(err: unknown): {
  kind: DbFailureKind;
  message: string;
  remediation: string;
} {
  const e = (err ?? {}) as { code?: string; message?: string; status?: number; details?: string; hint?: string };
  const code = String(e.code ?? "");
  const msg = String(e.message ?? (typeof err === "string" ? err : "") ?? "");
  const blob = `${msg} ${e.details ?? ""} ${e.hint ?? ""}`;
  const ref = resolveDbConfig().projectRef;

  if (!isDbConfigured()) {
    const nc = dbNotConfiguredError();
    return { kind: "not_configured", message: nc.message, remediation: nc.remediation };
  }

  if (PROJECT_NOT_FOUND_RE.test(blob)) {
    return {
      kind: "project_not_found",
      message: `Supabase project not found${ref ? ` for ref "${ref}"` : ""}.`,
      remediation:
        "The project referenced by SUPABASE_URL no longer exists (deleted, paused past retention, or in " +
        "another organisation). Create/restore a project, apply supabase/migrations in order, then update " +
        "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    };
  }

  if (e.status === 401 || e.status === 403 || /invalid api key|jwt|unauthorized|permission denied/i.test(blob)) {
    return {
      kind: "unauthorized",
      message: "Supabase rejected the credential (unauthorized).",
      remediation:
        "SUPABASE_SERVICE_ROLE_KEY does not belong to the project in SUPABASE_URL, or has been rotated. " +
        "Re-copy both from Project Settings → API and redeploy.",
    };
  }

  if (NETWORK_RE.test(blob)) {
    return {
      kind: "unreachable",
      message: `Supabase project is unreachable${ref ? ` (ref "${ref}")` : ""}.`,
      remediation:
        "DNS/TLS could not reach the project host. Verify SUPABASE_URL, that the project is not paused, " +
        "and that egress from the serverless region is permitted.",
    };
  }

  if (code === "42P01" || /relation .* does not exist/i.test(blob)) {
    return {
      kind: "missing_relation",
      message: `Required table is missing: ${msg || "relation does not exist"}.`,
      remediation:
        "Apply supabase/migrations in order (0001 … 0007). public.ans_knowledge_sources and " +
        "public.ans_knowledge_chunks must exist before retrieval can work.",
    };
  }

  if (code === "42703" || /column .* does not exist/i.test(blob)) {
    return {
      kind: "missing_column",
      message: `Required column is missing: ${msg || "column does not exist"}.`,
      remediation:
        "The live schema drifted from the migrations. The real source columns are review_status and " +
        "active_in_ai_analysis (NOT status / is_active), and there is no citation column — citations are " +
        "composed from title/authors/year. Apply migrations 0005–0007 to reconcile.",
    };
  }

  if (code === "42883" || code === "PGRST202" || /function .* does not exist|could not find the function/i.test(blob)) {
    return {
      kind: "missing_function",
      message: `Required database function is missing: ${msg || "function does not exist"}.`,
      remediation:
        "Apply supabase/migrations/0006_rag_embeddings_and_match_repair.sql (match_ans_knowledge_chunks) " +
        "and 0007_rag_lexical_fallback_and_embedding_freshness.sql (match_ans_knowledge_chunks_lexical). " +
        "Until then retrieval stays on the in-process lexical fallback.",
    };
  }

  return {
    kind: "unknown",
    message: msg || "Unknown database error.",
    remediation:
      "Check the Supabase project logs. If the project ref in SUPABASE_URL is stale, re-point the " +
      "deployment at a live project and re-apply supabase/migrations.",
  };
}

/**
 * Public, secret-free configuration report for /api/health and admin diagnostics.
 * Reports PRESENCE only — never a key, never a fragment of a key.
 */
export function configReport(): {
  database: {
    configured: boolean;
    projectRef: string | null;
    missingEnvVars: string[];
    problems: string[];
    requiredEnvVars: string[];
    clientEnvVars: string[];
  };
  ai: {
    configured: boolean;
    missingEnvVars: string[];
    requiredEnvVars: string[];
    optionalEnvVars: string[];
  };
} {
  const db = resolveDbConfig();
  const aiMissing = AI_ENV_VARS.filter((n) => envVal(n) === null);
  return {
    database: {
      configured: db.configured,
      projectRef: db.projectRef,
      missingEnvVars: db.missing,
      problems: db.problems,
      requiredEnvVars: [...SERVER_DB_ENV_VARS],
      clientEnvVars: [...CLIENT_DB_ENV_VARS],
    },
    ai: {
      configured: aiMissing.length === 0,
      missingEnvVars: [...aiMissing],
      requiredEnvVars: [...AI_ENV_VARS],
      optionalEnvVars: [...AI_OPTIONAL_ENV_VARS],
    },
  };
}
