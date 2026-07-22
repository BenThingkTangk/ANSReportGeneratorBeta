import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";
import {
  chunkText,
  estimateTokens,
  sourceMetadataText,
} from "../../_ans/knowledgeChunking.js";

/**
 * POST /api/admin/knowledge/reindex
 *
 * Backfill `ans_knowledge_chunks` for knowledge sources that have metadata but
 * no chunks — the exact "13 sources / 0 chunks" state seeded by SQL with no file
 * upload. For each target source we chunk its metadata text (title + abstract +
 * key_claims); if the source also has an uploaded file we could extend this to
 * pull the file text, but metadata alone makes the seeded corpus searchable.
 *
 * Idempotent: existing chunks for a source are deleted then rewritten.
 *
 * Body: { sourceIds?: string[], onlyMissing?: boolean, activeApprovedOnly?: boolean }
 *   - sourceIds: restrict to these sources (default: all).
 *   - onlyMissing: skip sources that already have chunks (default true).
 *   - activeApprovedOnly: only active_in_ai_analysis && approved (default true).
 *
 * SAFETY: this NEVER ingests patient reports. It operates only on rows already
 * in ans_knowledge_sources (curated, admin-approved knowledge), and honors the
 * active/approved filter so unapproved drafts are not surfaced to the AI path.
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
    const sourceIds: string[] | null = Array.isArray(body.sourceIds) ? body.sourceIds : null;
    const onlyMissing = body.onlyMissing !== false; // default true
    const activeApprovedOnly = body.activeApprovedOnly !== false; // default true

    // Load candidate sources with the metadata we chunk from.
    let q = admin
      .from("ans_knowledge_sources")
      .select("id, title, abstract, key_claims, active_in_ai_analysis, review_status");
    if (activeApprovedOnly) {
      q = q.eq("active_in_ai_analysis", true).eq("review_status", "approved");
    }
    if (sourceIds) q = q.in("id", sourceIds);
    const { data: sources, error: srcErr } = await q;
    if (srcErr) throw Object.assign(new Error(srcErr.message), { statusCode: 500 });

    // Existing chunk counts per source (to honor onlyMissing).
    const { data: existing } = await admin
      .from("ans_knowledge_chunks")
      .select("source_id");
    const chunkCountBySource = new Map<string, number>();
    for (const row of existing ?? []) {
      chunkCountBySource.set(row.source_id, (chunkCountBySource.get(row.source_id) ?? 0) + 1);
    }

    const results: Array<{
      sourceId: string;
      title: string;
      chunks: number;
      skipped?: string;
      error?: string;
    }> = [];
    let totalChunks = 0;

    for (const src of sources ?? []) {
      const had = chunkCountBySource.get(src.id) ?? 0;
      if (onlyMissing && had > 0) {
        results.push({ sourceId: src.id, title: src.title, chunks: had, skipped: "already has chunks" });
        continue;
      }
      const text = sourceMetadataText(src);
      if (text.trim().length === 0) {
        results.push({ sourceId: src.id, title: src.title, chunks: 0, skipped: "no metadata text to chunk" });
        continue;
      }
      const pieces = chunkText(text);
      // Idempotent rewrite.
      const { error: delErr } = await admin
        .from("ans_knowledge_chunks")
        .delete()
        .eq("source_id", src.id);
      if (delErr) {
        results.push({ sourceId: src.id, title: src.title, chunks: 0, error: `delete failed: ${delErr.message}` });
        continue;
      }
      const rows = pieces.map((content, idx) => ({
        source_id: src.id,
        chunk_index: idx,
        content,
        tokens: estimateTokens(content),
      }));
      const { error: insErr } = await admin.from("ans_knowledge_chunks").insert(rows);
      if (insErr) {
        results.push({ sourceId: src.id, title: src.title, chunks: 0, error: `insert failed: ${insErr.message}` });
        continue;
      }
      results.push({ sourceId: src.id, title: src.title, chunks: rows.length });
      totalChunks += rows.length;
    }

    await logAudit(
      supabase,
      "reindex_knowledge",
      "ans_knowledge_chunks",
      null,
      null,
      { sourceCount: (sources ?? []).length, totalChunks } as Record<string, unknown>,
      req,
    );

    return res.status(200).json({
      success: true,
      sourcesProcessed: (sources ?? []).length,
      totalChunksWritten: totalChunks,
      results,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
