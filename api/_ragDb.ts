/**
 * api/_ragDb.ts
 * Direct PostgreSQL data layer for the admin-managed Knowledge / RAG library,
 * backed by the dedicated Akamai Managed PostgreSQL instance (humanos-ans-rag-pg).
 *
 * Replaces the Supabase REST dependency for the admin knowledge routes. Uses the
 * `pg` driver with a small, serverless-safe connection Pool that is reused across
 * warm Vercel invocations. TLS is mandatory (verified against
 * HUMANOS_DATABASE_CA_CERT with rejectUnauthorized:true). ALL SQL is parameterized
 * — no user input is ever concatenated into a statement. No secret (connection
 * string, CA, host, password) is ever logged or returned to a client.
 *
 * Server-only env:
 *   HUMANOS_DATABASE_URL      postgres:// connection string (sensitive)
 *   HUMANOS_DATABASE_CA_CERT  PEM CA certificate for TLS verification (sensitive)
 *   HUMANOS_DATABASE_POOL_MAX optional pool size override (default 3, capped 10)
 */
import pg from "pg";
import type { Pool as PgPool, PoolClient, QueryResult, QueryResultRow } from "pg";

// ── Env accessors (whitespace/newline tolerant, secret-safe) ─────────────────

/**
 * Read a RAG env var, tolerating stray surrounding whitespace / a trailing
 * newline. Values pasted into the Vercel dashboard or piped via
 * `echo … | vercel env add` very commonly acquire a leading/trailing "\n" or
 * space; a trailing newline on the connection string corrupts every connection
 * attempt. Returns undefined when unset or blank so "configured" stays honest.
 */
function readRagEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
}

export function ragDatabaseUrl(): string | undefined {
  return readRagEnv("HUMANOS_DATABASE_URL");
}

/**
 * The PEM CA certificate. When pasted as a single-line Vercel env value the
 * embedded newlines are commonly encoded as the literal two-character sequence
 * `\n`; restore them so OpenSSL can parse the certificate. A genuine multi-line
 * value (real newlines) is left untouched because a PEM never contains a literal
 * backslash-n.
 */
export function ragCaCert(): string | undefined {
  const raw = process.env["HUMANOS_DATABASE_CA_CERT"];
  if (typeof raw !== "string") return undefined;
  const normalized = raw.replace(/\\n/g, "\n").trim();
  return normalized.length ? normalized : undefined;
}

function ragPoolMax(): number {
  const raw = readRagEnv("HUMANOS_DATABASE_POOL_MAX");
  const n = raw ? parseInt(raw, 10) : NaN;
  // Serverless-safe: keep the per-instance pool tiny; hard-cap defensively.
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 3;
}

// ── Configuration status (precise, NON-SECRET) ───────────────────────────────

export interface RagConfigStatus {
  configured: boolean;
  /** Secret-free, human-readable reason when not configured. */
  detail?: string;
  /** Env var NAMES that need attention — names only, never values. */
  missing?: string[];
}

/**
 * Precise, NON-SECRET status of the Akamai PostgreSQL backend env. Reports which
 * variable NAME is missing or malformed without ever exposing a value, so the
 * API/UI can surface an actionable configuration message instead of a raw driver
 * error.
 */
export function ragConfigStatus(): RagConfigStatus {
  const url = ragDatabaseUrl();
  const ca = ragCaCert();
  const missing: string[] = [];
  if (!url) missing.push("HUMANOS_DATABASE_URL");
  if (!ca) missing.push("HUMANOS_DATABASE_CA_CERT");
  if (missing.length) {
    return {
      configured: false,
      missing,
      detail: `Missing server environment variable(s): ${missing.join(", ")}.`,
    };
  }
  // URL must be a well-formed postgres(ql):// connection string.
  try {
    const parsed = new URL(url as string);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return {
        configured: false,
        missing: ["HUMANOS_DATABASE_URL"],
        detail: "HUMANOS_DATABASE_URL must be a postgres:// or postgresql:// connection string.",
      };
    }
  } catch {
    return {
      configured: false,
      missing: ["HUMANOS_DATABASE_URL"],
      detail: "HUMANOS_DATABASE_URL is not a valid connection string.",
    };
  }
  return { configured: true };
}

// ── Error classification (transport vs schema vs query), secret-free ─────────

/**
 * True when a caught error is a transport/connectivity failure (unreachable
 * host, DNS, refused, reset, timeout, TLS/cert) rather than a legitimate query
 * error. Inspects the message, any `code`, and the wrapped `cause`.
 */
export function isRagUnreachable(err: unknown): boolean {
  const e = (err ?? {}) as {
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  const code = `${e.code ?? ""} ${e.cause?.code ?? ""}`;
  return (
    /timeout exceeded|connection terminated|connection refused|network|socket hang up|\btls\b|certificate|self.signed|getaddrinfo|could not connect/i.test(
      msg
    ) ||
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|EPIPE|CERT_|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY/i.test(
      `${msg} ${code}`
    )
  );
}

/**
 * Map a PostgreSQL failure to a precise, SECRET-FREE API error.
 *   - transport/connectivity failure → 503 naming HUMANOS_DATABASE_URL (never a
 *     value/host); the raw driver message (which can carry the host) is dropped.
 *   - undefined_table (SQLSTATE 42P01) → 503 telling the operator to run the
 *     migration; the schema simply hasn't been created yet.
 *   - any other (genuine, non-secret) query error → 400 with its message.
 */
export function ragBackendError(err: unknown): Error & { statusCode: number } {
  const e = (err ?? {}) as { message?: string; code?: string; statusCode?: number };
  // Idempotent: an error already carrying a precise statusCode (e.g. the 503
  // "not configured" from getPool, or an auth 401/403) passes through unchanged
  // so callers can safely funnel every failure through this mapper.
  if (typeof e.statusCode === "number") {
    return err as Error & { statusCode: number };
  }
  if (isRagUnreachable(e)) {
    return Object.assign(
      new Error(
        "Cannot reach the knowledge database backend. Verify HUMANOS_DATABASE_URL points to the correct, active Akamai PostgreSQL instance and HUMANOS_DATABASE_CA_CERT is valid (transport error contacting PostgreSQL)."
      ),
      { statusCode: 503 }
    );
  }
  if (e.code === "42P01") {
    return Object.assign(
      new Error(
        "Knowledge database schema is not initialized. Run the migration (npm run db:migrate:rag) to create the required tables."
      ),
      { statusCode: 503 }
    );
  }
  const message = e.message || "Database query failed";
  return Object.assign(new Error(message), { statusCode: 400 });
}

// ── Serverless-safe connection Pool (singleton, reused when warm) ─────────────

let _pool: PgPool | null = null;

export function getPool(): PgPool {
  if (_pool) return _pool;
  const cfg = ragConfigStatus();
  if (!cfg.configured) {
    // 503 (not 500): an environment/configuration state; message names the
    // offending variable(s) without exposing any value.
    throw Object.assign(
      new Error(`Knowledge database is not configured: ${cfg.detail}`),
      { statusCode: 503 }
    );
  }
  const PoolCtor = pg.Pool;
  _pool = new PoolCtor({
    connectionString: ragDatabaseUrl(),
    // Mandatory verified TLS against the provided CA. rejectUnauthorized:true
    // ensures we refuse a MITM / wrong-cert endpoint.
    ssl: { ca: ragCaCert() as string, rejectUnauthorized: true },
    // Serverless tuning: a tiny pool per warm instance, quick idle reclaim, and
    // a fast connect timeout so an unreachable backend fails fast (→ 503) rather
    // than hanging the function. allowExitOnIdle lets the runtime settle.
    max: ragPoolMax(),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    allowExitOnIdle: true,
  });
  // An idle client can emit 'error' (e.g. backend closed the socket); without a
  // listener that would crash the process. Log only a generic class, no secrets.
  _pool.on("error", (err: { message?: string }) => {
    console.error("[rag-db] idle client error:", err?.message ?? "unknown");
  });
  return _pool;
}

/** Parameterized query against the pooled backend. Never interpolate input. */
export async function ragQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params as unknown[] | undefined);
}

/** Run `fn` inside a single BEGIN/COMMIT transaction on one pooled client. */
export async function withRagTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure — surface the original error */
    }
    throw e;
  } finally {
    client.release();
  }
}

// ── Readiness (for the admin status endpoint) — all fields secret-free ────────

export interface RagReadiness {
  configured: boolean;
  reachable: boolean;
  schemaReady: boolean;
  vectorReady: boolean;
  counts?: { sources: number; chunks: number };
  /** Env var NAMES needing attention (names only, never values). */
  missing?: string[];
  /** Secret-free human-readable detail. */
  detail?: string;
}

export async function ragReadiness(): Promise<RagReadiness> {
  const cfg = ragConfigStatus();
  if (!cfg.configured) {
    return {
      configured: false,
      reachable: false,
      schemaReady: false,
      vectorReady: false,
      missing: cfg.missing,
      detail: cfg.detail,
    };
  }
  try {
    // Reachability + schema presence in one round trip: to_regclass yields NULL
    // when a table is absent (no error thrown), so this never depends on 42P01.
    const schemaRes = await ragQuery<{
      sources_tbl: string | null;
      chunks_tbl: string | null;
      versions_tbl: string | null;
      audit_tbl: string | null;
    }>(
      `SELECT to_regclass('public.ans_knowledge_sources')::text AS sources_tbl,
              to_regclass('public.ans_knowledge_chunks')::text  AS chunks_tbl,
              to_regclass('public.ans_knowledge_versions')::text AS versions_tbl,
              to_regclass('public.ans_knowledge_audit')::text    AS audit_tbl`
    );
    const row = schemaRes.rows[0];
    const schemaReady = Boolean(
      row?.sources_tbl && row?.chunks_tbl && row?.versions_tbl && row?.audit_tbl
    );

    let vectorReady = false;
    try {
      const vecRes = await ragQuery<{ present: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS present"
      );
      vectorReady = Boolean(vecRes.rows[0]?.present);
    } catch {
      vectorReady = false;
    }

    let counts: { sources: number; chunks: number } | undefined;
    if (schemaReady) {
      try {
        const c = await ragQuery<{ sources: string; chunks: string }>(
          `SELECT (SELECT count(*) FROM public.ans_knowledge_sources) AS sources,
                  (SELECT count(*) FROM public.ans_knowledge_chunks)  AS chunks`
        );
        counts = {
          sources: Number(c.rows[0]?.sources ?? 0),
          chunks: Number(c.rows[0]?.chunks ?? 0),
        };
      } catch {
        /* counts are best-effort */
      }
    }

    return { configured: true, reachable: true, schemaReady, vectorReady, counts };
  } catch (err) {
    if (isRagUnreachable(err)) {
      return {
        configured: true,
        reachable: false,
        schemaReady: false,
        vectorReady: false,
        detail: "Configured but unreachable: transport error contacting the PostgreSQL backend.",
      };
    }
    // Reached the server but a readiness query failed (e.g. auth/permission).
    return {
      configured: true,
      reachable: false,
      schemaReady: false,
      vectorReady: false,
      detail: "Configured but a readiness query failed.",
    };
  }
}

// ── Audit + version helpers ──────────────────────────────────────────────────

export interface RagActor {
  id: string | null;
  email: string;
}

export interface RagAuditReq {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

/**
 * Best-effort audit row. Never throws (a failed audit must not fail the action)
 * and never logs secrets. before/after are stored as jsonb.
 */
export async function logRagAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  actor: RagActor,
  req: RagAuditReq
): Promise<void> {
  try {
    const ip =
      (req.headers?.["x-forwarded-for"] as string) ||
      req.socket?.remoteAddress ||
      null;
    const ua = (req.headers?.["user-agent"] as string) ?? null;
    await ragQuery(
      `INSERT INTO public.ans_knowledge_audit
         (actor_id, actor_email, action, entity_type, entity_id, before, after, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        actor.id,
        actor.email || null,
        action,
        entityType,
        entityId,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        ip,
        ua,
      ]
    );
  } catch (e) {
    console.error("ans_knowledge_audit write failed:", (e as Error)?.message ?? "unknown");
  }
}

export type RagChangeAction =
  | "create"
  | "update"
  | "delete"
  | "activate"
  | "archive"
  | "import";

/**
 * Append an immutable version snapshot for a source. Runs on the caller's
 * transaction client so the version number and the data change commit together.
 * The (source_id, version) unique constraint is the backstop against races.
 */
export async function recordRagVersion(
  client: PoolClient,
  sourceId: string,
  changeAction: RagChangeAction,
  snapshot: Record<string, unknown>,
  actor: RagActor
): Promise<number> {
  const verRes = await client.query<{ next: string }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM public.ans_knowledge_versions WHERE source_id = $1",
    [sourceId]
  );
  const version = Number(verRes.rows[0]?.next ?? 1);
  await client.query(
    `INSERT INTO public.ans_knowledge_versions
       (source_id, version, change_action, snapshot, changed_by, changed_by_email)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [sourceId, version, changeAction, JSON.stringify(snapshot), actor.id, actor.email || null]
  );
  return version;
}

/** The full source column list, shared by SELECT/RETURNING so shapes stay identical. */
export const SOURCE_COLUMNS =
  "id, title, authors, year, publication_type, journal, publisher, doi, pubmed_id, url, " +
  "abstract, key_claims, diagnostic_relevance, ans_metrics, tags, used_in, " +
  "file_path, file_mime, file_size_bytes, " +
  "active_in_ai_analysis, active_in_report_citations, active_in_admin_review, " +
  "review_status, added_by, last_updated_by, created_at, updated_at";

/** Test-only: dispose the singleton pool so a fresh config/mock can take effect. */
export async function _resetPoolForTests(): Promise<void> {
  if (_pool) {
    try {
      await _pool.end();
    } catch {
      /* ignore */
    }
    _pool = null;
  }
}
