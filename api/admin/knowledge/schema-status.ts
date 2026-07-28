import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  requireRole,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";
import { detectChunkSchema } from "../../_ans/knowledgeSchema.js";

/**
 * GET /api/admin/knowledge/schema-status  (super_admin / clinical_admin)
 *
 * Reports — HONESTLY — whether the optional ans_knowledge_chunks columns from
 * migration 0005 (page, section) exist in the LIVE database, and returns the
 * exact SQL to run if they do not.
 *
 * Why not a "apply migration" button? The Supabase JS client cannot execute
 * DDL (ALTER TABLE) — that requires a privileged SQL/RPC surface which does not
 * exist here and which would be an unsafe thing to expose to an HTTP endpoint.
 * So this endpoint NEVER claims the migration was applied; it only detects and
 * instructs. The application already runs correctly WITHOUT migration 0005 via
 * the runtime schema-compatibility fallback — page/section are optional
 * enhancements (page-accurate citations), not a requirement for retrieval.
 */
const MIGRATION_SQL = `-- Optional: adds page-accurate citation columns (migration 0005).
-- Retrieval works WITHOUT this; run it only to enable page/section citations.
ALTER TABLE public.ans_knowledge_chunks
  ADD COLUMN IF NOT EXISTS page    int,
  ADD COLUMN IF NOT EXISTS section text;`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "GET only" });

  const supabase = createSupabaseFromRequest(req);
  try {
    await requireRole(req, ["super_admin", "clinical_admin"]);
    const schema = await detectChunkSchema(supabase, true);
    const upToDate = schema.hasPage && schema.hasSection;
    return res.status(200).json({
      success: true,
      // Explicitly NOT a claim that anything was applied — just observed state.
      applied: false,
      detected: schema,
      upToDate,
      compatibilityMode: upToDate ? "native" : "fallback",
      note: upToDate
        ? "Optional page/section columns are present. Page-accurate citations are available."
        : "Legacy schema (page/section absent). Retrieval works via the compatibility fallback (chunk-index locators). To enable page-accurate citations, run the SQL below in the Supabase SQL editor — this endpoint cannot and does not apply DDL itself.",
      migrationSql: upToDate ? null : MIGRATION_SQL,
      migrationFile: "supabase/migrations/0005_rag_chunk_metadata.sql",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
