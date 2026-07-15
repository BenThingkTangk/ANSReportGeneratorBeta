#!/usr/bin/env node
/**
 * RAG knowledge-base migration runner (Akamai Managed PostgreSQL).
 *
 * Applies every db/migrations/*.sql file (ascending) to the dedicated
 * humanos-ans-rag-pg instance, INSIDE a single transaction guarded by a
 * PostgreSQL advisory lock so two concurrent runs can never race. Every
 * migration file is idempotent (CREATE ... IF NOT EXISTS, guarded DO blocks),
 * so this command is safe to run repeatedly.
 *
 * It creates ONLY schema objects (tables/indexes/triggers/optional pgvector).
 * It never writes patient data or PII. Seeding curated non-PII sources is a
 * separate, explicit command (npm run db:seed:rag).
 *
 * Required server env (sensitive — never logged):
 *   HUMANOS_DATABASE_URL       postgres:// connection string
 *   HUMANOS_DATABASE_CA_CERT   PEM CA certificate (verified TLS)
 *
 * Usage:
 *   npm run db:migrate:rag
 *   node scripts/migrate-rag.mjs
 *
 * Exit code: 0 on success, 1 on failure (secret-free message).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// A stable, arbitrary 63-bit key so `pg_advisory_xact_lock` serializes runs.
const RAG_MIGRATION_LOCK = 492770113;

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, "db", "migrations");

function readEnv(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length ? t : undefined;
}

function readCaCert() {
  const raw = process.env.HUMANOS_DATABASE_CA_CERT;
  if (typeof raw !== "string") return undefined;
  // Single-line Vercel paste encodes PEM newlines as literal "\n" — restore them.
  const n = raw.replace(/\\n/g, "\n").trim();
  return n.length ? n : undefined;
}

async function main() {
  const url = readEnv("HUMANOS_DATABASE_URL");
  const ca = readCaCert();
  const missing = [];
  if (!url) missing.push("HUMANOS_DATABASE_URL");
  if (!ca) missing.push("HUMANOS_DATABASE_CA_CERT");
  if (missing.length) {
    console.error(`✗ Missing required env var(s): ${missing.join(", ")}`);
    console.error("  Set them in your shell (do NOT paste secrets into logs) and retry.");
    process.exit(1);
  }

  let files = [];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.error(`✗ Cannot read migrations directory: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("✗ No .sql migration files found in db/migrations/");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { ca, rejectUnauthorized: true },
    // Fail fast rather than hang if the endpoint is wrong/unreachable.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });

  try {
    await client.connect();
  } catch (e) {
    // Never surface the connection string / host — just the class of failure.
    console.error("✗ Could not connect to the PostgreSQL backend (check HUMANOS_DATABASE_URL/CA, TLS, and that the instance is active).");
    console.error(`  ${classifyMessage(e)}`);
    process.exit(1);
  }

  try {
    await client.query("BEGIN");
    // Serialize concurrent migration runs for the whole transaction.
    await client.query("SELECT pg_advisory_xact_lock($1)", [RAG_MIGRATION_LOCK]);

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`→ applying ${file} … `);
      await client.query(sql);
      process.stdout.write("ok\n");
    }

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("\n✗ Migration failed and was rolled back.");
    console.error(`  ${classifyMessage(e)}`);
    await client.end().catch(() => {});
    process.exit(1);
  }

  // Post-migration readiness report (secret-free).
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public.ans_knowledge_sources')::text  AS sources,
              to_regclass('public.ans_knowledge_chunks')::text   AS chunks,
              to_regclass('public.ans_knowledge_versions')::text AS versions,
              to_regclass('public.ans_knowledge_audit')::text    AS audit,
              EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS vector_ext,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='ans_knowledge_chunks'
                  AND column_name='embedding'
              ) AS embedding_col`
    );
    const r = rows[0] ?? {};
    console.log("\n✓ Migration complete. Schema status:");
    console.log(`    ans_knowledge_sources   : ${r.sources ? "present" : "MISSING"}`);
    console.log(`    ans_knowledge_chunks    : ${r.chunks ? "present" : "MISSING"}`);
    console.log(`    ans_knowledge_versions  : ${r.versions ? "present" : "MISSING"}`);
    console.log(`    ans_knowledge_audit     : ${r.audit ? "present" : "MISSING"}`);
    console.log(
      `    pgvector extension      : ${r.vector_ext ? "enabled (embeddings ON)" : "not installed (embeddings OFF — text retrieval still works)"}`
    );
    console.log(`    chunks.embedding column : ${r.embedding_col ? "present" : "absent (optional)"}`);
    console.log("\nNext: seed curated non-PII sources with `npm run db:seed:rag` (optional).");
  } catch {
    console.log("\n✓ Migration committed (status report query skipped).");
  } finally {
    await client.end().catch(() => {});
  }
}

/** Return a short, SECRET-FREE description of a driver error. */
function classifyMessage(e) {
  const msg = String(e?.message ?? "");
  const code = String(e?.code ?? "");
  if (/ENOTFOUND|EAI_AGAIN/i.test(`${msg} ${code}`)) return "DNS lookup failed for the database host.";
  if (/ECONNREFUSED/i.test(`${msg} ${code}`)) return "Connection refused by the database host.";
  if (/ETIMEDOUT|timeout/i.test(`${msg} ${code}`)) return "Connection timed out.";
  if (/certificate|self.signed|CERT_|DEPTH_ZERO|UNABLE_TO_VERIFY|\btls\b/i.test(`${msg} ${code}`))
    return "TLS certificate verification failed (check HUMANOS_DATABASE_CA_CERT).";
  if (code) return `PostgreSQL error (SQLSTATE ${code}).`;
  return "See PostgreSQL server logs for details.";
}

main().catch((e) => {
  console.error("✗ Unexpected error:", String(e?.message ?? e));
  process.exit(1);
});
