import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { ragReadiness } from "../_ragDb.js";

/**
 * GET /api/admin/knowledge-status — Akamai PostgreSQL backend readiness.
 *
 * For the admin UI's backend health indicator. Reports, WITHOUT exposing any
 * host/credential/value:
 *   configured   — required env vars present & the URL is a valid postgres:// URI
 *   reachable    — a lightweight query round-trips over verified TLS
 *   schemaReady  — the knowledge tables exist (run db:migrate:rag if false)
 *   vectorReady  — the pgvector extension is installed (embeddings; optional)
 *   counts       — row counts (best-effort) when the schema is ready
 *   missing      — env var NAMES needing attention (names only, never values)
 *
 * Auth is enforced FIRST via the admin gateway session, so an unauthenticated
 * caller can never probe backend state. Always responds 200 with the status
 * object (the health is in the body, not the HTTP code) unless auth fails.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
    const readiness = await ragReadiness();
    return res.status(200).json({
      success: true,
      backend: "akamai-postgres",
      ...readiness,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
