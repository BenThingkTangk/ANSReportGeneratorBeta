#!/usr/bin/env node
/**
 * RAG knowledge-base seed runner (Akamai Managed PostgreSQL).
 *
 * Applies every db/seed/*.sql file (ascending) to the humanos-ans-rag-pg
 * instance inside a single advisory-locked transaction. The seed files contain
 * ONLY the curated, NON-PII Dr. Colombo / DePace autonomic-medicine bibliography
 * (published references + one internal chart-explanation transcript). They are
 * idempotent (ON CONFLICT (lower(title)) DO NOTHING), so re-running never
 * duplicates rows or overwrites operator edits.
 *
 * This command MUST NOT be used to load patient reports or any PHI. It only runs
 * the checked-in curated seed SQL.
 *
 * Required server env (sensitive — never logged):
 *   HUMANOS_DATABASE_URL       postgres:// connection string
 *   HUMANOS_DATABASE_CA_CERT   PEM CA certificate (verified TLS)
 *
 * Usage:
 *   npm run db:seed:rag
 *   node scripts/seed-rag.mjs
 *
 * Exit code: 0 on success, 1 on failure (secret-free message).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAG_SEED_LOCK = 492770114;

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SEED_DIR = join(REPO_ROOT, "db", "seed");

function readEnv(name) {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length ? t : undefined;
}

function readCaCert() {
  const raw = process.env.HUMANOS_DATABASE_CA_CERT;
  if (typeof raw !== "string") return undefined;
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
    process.exit(1);
  }

  let files = [];
  try {
    files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.error(`✗ Cannot read seed directory: ${SEED_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("✗ No .sql seed files found in db/seed/");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });

  try {
    await client.connect();
  } catch (e) {
    console.error("✗ Could not connect to the PostgreSQL backend (check HUMANOS_DATABASE_URL/CA, TLS, and that the instance is active).");
    console.error(`  ${classifyMessage(e)}`);
    process.exit(1);
  }

  // Refuse to seed if the schema isn't there — tell the operator to migrate first.
  try {
    const { rows } = await client.query(
      "SELECT to_regclass('public.ans_knowledge_sources')::text AS t"
    );
    if (!rows[0]?.t) {
      console.error("✗ Schema not initialized (ans_knowledge_sources missing). Run `npm run db:migrate:rag` first.");
      await client.end().catch(() => {});
      process.exit(1);
    }
  } catch (e) {
    console.error("✗ Could not verify schema before seeding.");
    console.error(`  ${classifyMessage(e)}`);
    await client.end().catch(() => {});
    process.exit(1);
  }

  const before = await countSources(client);

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [RAG_SEED_LOCK]);
    for (const file of files) {
      const sql = await readFile(join(SEED_DIR, file), "utf8");
      process.stdout.write(`→ seeding ${file} … `);
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
    console.error("\n✗ Seed failed and was rolled back.");
    console.error(`  ${classifyMessage(e)}`);
    await client.end().catch(() => {});
    process.exit(1);
  }

  const after = await countSources(client);
  console.log(`\n✓ Seed complete. Sources: ${before} → ${after} (idempotent; existing rows untouched).`);
  await client.end().catch(() => {});
}

async function countSources(client) {
  try {
    const { rows } = await client.query("SELECT count(*)::int AS n FROM public.ans_knowledge_sources");
    return Number(rows[0]?.n ?? 0);
  } catch {
    return NaN;
  }
}

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
