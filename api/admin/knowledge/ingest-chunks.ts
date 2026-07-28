import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";
import { detectChunkSchema } from "../../_ans/knowledgeSchema.js";
import { validateCuratedChunks } from "../../_ans/curatedChunks.js";

/**
 * POST /api/admin/knowledge/ingest-chunks
 *
 * Ingest PRE-CURATED full-text chunks for an EXISTING approved knowledge source.
 *
 * Why this exists (neither existing path can do it):
 *   • /api/admin/knowledge/upload needs a multipart PDF/text FILE and re-derives
 *     its own chunk boundaries, discarding a curator's section titles/indices.
 *   • /api/admin/knowledge/reindex only chunks a source's own metadata
 *     (title/abstract/key_claims) and stamps section='metadata', which
 *     computeRagStatus() intentionally reports as NOT functional RAG.
 *
 * No embeddings are involved: retrieval is deterministic lexical term-overlap
 * over `content` (api/admin/retrieval-test.ts + api/_ans/knowledgeChunking.ts),
 * and the `embedding` column is never read or written by any code path. Rows
 * inserted here with a NULL embedding are immediately retrievable.
 *
 * Body: {
 *   sourceId: string (uuid, must already exist),
 *   chunks: Array<{ chunk_index, content, section?, page?, source_id? }>,
 *   dryRun?: boolean,               // validate + report, write nothing
 *   requireApproved?: boolean,      // default true
 *   replace?: boolean,              // default true — idempotent rewrite
 * }
 *
 * IDEMPOTENCY: the table has no unique constraint on (source_id, chunk_index),
 * so a naive re-POST would duplicate rows. With `replace` (the default) we
 * delete this source's existing chunks inside the same request before
 * inserting, exactly as upload/reindex do — re-running yields the same corpus.
 *
 * SAFETY:
 *   • Admin-only (super_admin / clinical_admin), same guard as the sibling routes.
 *   • Writes ONLY to ans_knowledge_chunks for the one requested source; never
 *     touches other sources, patient reports, or deterministic scoring.
 *   • Refuses the whole batch if any chunk looks like patient data.
 *   • Refuses unknown / unapproved sources (unless explicitly overridden).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  const supabase = createSupabaseFromRequest(req);
  const admin = createSupabaseAdmin();

  try {
    await requireRole(req, ["super_admin", "clinical_admin"]);

    const body: any = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const sourceId: string = String(body.sourceId ?? "");
    const dryRun = body.dryRun === true;
    const requireApproved = body.requireApproved !== false; // default true
    const replace = body.replace !== false; // default true

    // The source must already exist — this endpoint never creates one, so it
    // cannot smuggle unreviewed material into the corpus.
    const { data: src, error: srcErr } = await admin
      .from("ans_knowledge_sources")
      .select("id, title, active_in_ai_analysis, review_status")
      .eq("id", sourceId)
      .maybeSingle();
    if (srcErr) throw Object.assign(new Error(srcErr.message), { statusCode: 500 });
    if (!src) {
      return res.status(404).json({
        success: false,
        error: `knowledge source ${sourceId || "(missing sourceId)"} not found — create and approve it first`,
      });
    }
    if (requireApproved && (src.review_status !== "approved" || !src.active_in_ai_analysis)) {
      return res.status(409).json({
        success: false,
        error:
          `source "${src.title}" is not approved+active ` +
          `(review_status=${src.review_status}, active_in_ai_analysis=${src.active_in_ai_analysis}). ` +
          "Approve it first, or pass requireApproved:false to stage chunks deliberately.",
      });
    }

    // Only write page/section when the live schema actually has them (a DB
    // without migration 0005 would otherwise 42703).
    const schema = await detectChunkSchema(admin);
    const validation = validateCuratedChunks(body.chunks, {
      sourceId,
      hasSection: schema.hasSection,
      hasPage: schema.hasPage,
    });
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        error: "chunk validation failed; nothing was written",
        errors: validation.errors.slice(0, 20),
        errorCount: validation.errors.length,
        warnings: validation.warnings,
      });
    }

    // How many chunks this source already has (reported so a re-run is visibly
    // a replacement, not a silent duplication).
    const { count: priorCount, error: exErr } = await admin
      .from("ans_knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    if (exErr) throw Object.assign(new Error(exErr.message), { statusCode: 500 });
    const priorChunks = priorCount ?? 0;

    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        sourceId,
        sourceTitle: src.title,
        wouldWriteChunks: validation.rows.length,
        wouldReplaceChunks: priorChunks,
        schemaVersion: schema.schemaVersion,
        warnings: validation.warnings,
        note: "Validation only — no rows were written.",
      });
    }

    // Idempotent rewrite: clear this source's chunks, then insert the batch.
    if (replace) {
      const { error: delErr } = await admin
        .from("ans_knowledge_chunks")
        .delete()
        .eq("source_id", sourceId);
      if (delErr) throw Object.assign(new Error(`chunk delete failed: ${delErr.message}`), { statusCode: 500 });
    }

    const { error: insErr } = await admin.from("ans_knowledge_chunks").insert(validation.rows);
    if (insErr) throw Object.assign(new Error(`chunk insert failed: ${insErr.message}`), { statusCode: 500 });

    await logAudit(
      supabase,
      "ingest_curated_chunks",
      "ans_knowledge_chunks",
      sourceId,
      { priorChunks } as Record<string, unknown>,
      { chunksWritten: validation.rows.length, replaced: replace, kind: "fulltext" } as Record<string, unknown>,
      req,
    );

    return res.status(200).json({
      success: true,
      sourceId,
      sourceTitle: src.title,
      chunksWritten: validation.rows.length,
      replacedChunks: replace ? priorChunks : 0,
      chunkKind: "fulltext",
      schemaVersion: schema.schemaVersion,
      warnings: validation.warnings,
      note:
        "Curated full-text chunks ingested. Retrieval is lexical (no embeddings required); " +
        "verify with POST /api/admin/retrieval-test.",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
