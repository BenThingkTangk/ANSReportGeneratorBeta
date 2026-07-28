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
  embedTexts,
  embeddingConfig,
  isEmbeddingConfigured,
  toPgVectorLiteral,
  EmbeddingUnavailableError,
} from "../../_ans/embeddings.js";

/**
 * POST /api/admin/knowledge/embed-backfill  — ADMIN ONLY
 * GET  /api/admin/knowledge/embed-backfill  — status probe (counts only)
 *
 * Generates embeddings for `ans_knowledge_chunks` rows whose `embedding` IS NULL,
 * using the SERVER-SIDE provider credential (see api/_ans/embeddings.ts). The
 * credential never leaves the server and is never returned in a response.
 *
 * Why a route (not SQL): SQL cannot call the embedding provider. This endpoint is
 * the migration-safe job — idempotent, resumable, and bounded per invocation so it
 * fits a serverless timeout. Re-run until `remaining` reaches 0.
 *
 * Body (all optional):
 *   { limit?: number,          // rows to process this run (default 32, max 96)
 *     sourceId?: string,       // restrict to one source
 *     includeMetadataChunks?: boolean }  // default false: skip section='metadata'
 *                              // placeholders, which are not real full text
 *
 * SAFETY / SCOPE
 *   • Only writes the `embedding` column. Never edits content, provenance,
 *     review_status, or any clinical field; never touches .ans parsing.
 *   • Honours source gating: by default only chunks whose source is
 *     review_status='approved' AND active_in_ai_analysis=true are embedded, so
 *     unapproved material is not indexed for retrieval.
 *   • Degrades honestly: if the provider is unconfigured or failing, it reports
 *     that and changes nothing — retrieval stays on the lexical ranker.
 */

const DEFAULT_LIMIT = 32;
const MAX_LIMIT = 96;

interface ChunkRow {
  id: string;
  source_id: string;
  content: string | null;
  section?: string | null;
}

/** Does ans_knowledge_chunks have an `embedding` column on this database? */
async function hasEmbeddingColumn(admin: any): Promise<boolean> {
  const { error } = await admin.from("ans_knowledge_chunks").select("embedding").limit(1);
  if (!error) return true;
  const code = (error as any)?.code;
  const msg = (error as any)?.message ?? "";
  if (code === "42703" || /column .*does not exist|could not find the .* column/i.test(msg)) {
    return false;
  }
  // Unknown error: assume present so the caller surfaces the real failure.
  return true;
}

/** Does the optional `section` column exist (migration 0005)? */
async function hasSectionColumn(admin: any): Promise<boolean> {
  const { error } = await admin.from("ans_knowledge_chunks").select("section").limit(1);
  if (!error) return true;
  const code = (error as any)?.code;
  const msg = (error as any)?.message ?? "";
  return !(code === "42703" || /column .*does not exist|could not find the .* column/i.test(msg));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "POST or GET only" });
  }

  const supabase = createSupabaseFromRequest(req);

  try {
    // Admin-only. Reviewers may READ the status probe; writes need admin.
    if (req.method === "GET") {
      await requireRole(req, ["super_admin", "clinical_admin", "reviewer"]);
    } else {
      await requireRole(req, ["super_admin", "clinical_admin"]);
    }

    const admin = createSupabaseAdmin();
    const { model, dimensions } = embeddingConfig();
    const providerConfigured = isEmbeddingConfigured();
    const embeddingColumn = await hasEmbeddingColumn(admin);

    // ---- Counts (cheap, always safe) ------------------------------------------
    const { count: totalChunks } = await admin
      .from("ans_knowledge_chunks")
      .select("id", { count: "exact", head: true });

    let pending: number | null = null;
    if (embeddingColumn) {
      const { count } = await admin
        .from("ans_knowledge_chunks")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      pending = count ?? 0;
    }

    if (req.method === "GET") {
      return res.status(200).json({
        success: true,
        providerConfigured,
        embeddingColumn,
        model,
        dimensions,
        totalChunks: totalChunks ?? 0,
        pendingEmbeddings: pending,
        // Honest capability signal for the admin UI.
        vectorSearchReady: Boolean(embeddingColumn && (pending ?? 1) === 0 && (totalChunks ?? 0) > 0),
        note: !embeddingColumn
          ? "No `embedding` column on ans_knowledge_chunks — apply migration 0006. Retrieval is using the deterministic lexical ranker."
          : !providerConfigured
            ? "Embedding provider not configured (PPLX_API_KEY). Retrieval is using the deterministic lexical ranker."
            : (pending ?? 0) > 0
              ? `${pending} chunk(s) still need embeddings; POST to this route to backfill.`
              : "All chunks embedded.",
      });
    }

    // ---- Backfill (POST) ------------------------------------------------------
    if (!embeddingColumn) {
      return res.status(409).json({
        success: false,
        error:
          "ans_knowledge_chunks has no `embedding` column. Apply supabase/migrations/0006_rag_embeddings_and_match_repair.sql first.",
        embeddingColumn: false,
      });
    }
    if (!providerConfigured) {
      return res.status(503).json({
        success: false,
        error: "Embedding provider is not configured server-side (PPLX_API_KEY).",
        providerConfigured: false,
        pendingEmbeddings: pending,
        note: "Retrieval continues with the deterministic lexical ranker; no data was changed.",
      });
    }

    const body: any =
      typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const rawLimit = parseInt(String(body?.limit ?? ""), 10);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT, MAX_LIMIT);
    const sourceId = typeof body?.sourceId === "string" && body.sourceId ? body.sourceId : null;
    const includeMetadataChunks = body?.includeMetadataChunks === true;

    const sectionCol = await hasSectionColumn(admin);

    // Select NULL-embedding chunks from APPROVED + AI-ACTIVE sources only.
    let q = admin
      .from("ans_knowledge_chunks")
      .select(
        `id, source_id, content${sectionCol ? ", section" : ""},
         source:ans_knowledge_sources!inner ( id, review_status, active_in_ai_analysis )`,
      )
      .is("embedding", null)
      .eq("source.review_status", "approved")
      .eq("source.active_in_ai_analysis", true)
      .order("id", { ascending: true })
      .limit(limit);
    if (sourceId) q = q.eq("source_id", sourceId);

    const { data: rows, error: selErr } = await q;
    if (selErr) {
      throw Object.assign(new Error(selErr.message), { statusCode: 400 });
    }

    let candidates = (rows ?? []) as unknown as ChunkRow[];
    if (!includeMetadataChunks && sectionCol) {
      // `section='metadata'` rows are placeholders built from a source's own
      // metadata — not real full text, so they are not worth embedding.
      candidates = candidates.filter((r) => (r.section ?? "").toLowerCase() !== "metadata");
    }
    // Never send blank content to the provider.
    candidates = candidates.filter((r) => (r.content ?? "").trim().length > 0);

    if (candidates.length === 0) {
      return res.status(200).json({
        success: true,
        embedded: 0,
        skipped: (rows ?? []).length,
        remaining: pending ?? 0,
        model,
        dimensions,
        note:
          (pending ?? 0) === 0
            ? "Nothing to embed — all eligible chunks already have embeddings."
            : "No eligible chunks in this batch (blank content, metadata placeholders, or source not approved/active).",
      });
    }

    let vectors: Array<number[] | null>;
    try {
      vectors = await embedTexts(candidates.map((c) => c.content ?? ""));
    } catch (e) {
      if (e instanceof EmbeddingUnavailableError) {
        // Temporary provider failure → change nothing, stay on lexical retrieval.
        return res.status(503).json({
          success: false,
          error: `Embedding generation temporarily unavailable: ${e.message}`,
          embedded: 0,
          remaining: pending ?? 0,
          note: "No rows were modified. Retrieval continues with the deterministic lexical ranker; retry later.",
        });
      }
      throw e;
    }

    // Write vectors one row at a time so a single bad row cannot lose the batch.
    let embedded = 0;
    const failures: Array<{ id: string; reason: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const vec = vectors[i];
      const row = candidates[i];
      if (!vec) {
        failures.push({ id: row.id, reason: "provider returned no vector" });
        continue;
      }
      const { error: upErr } = await admin
        .from("ans_knowledge_chunks")
        .update({ embedding: toPgVectorLiteral(vec) })
        .eq("id", row.id);
      if (upErr) failures.push({ id: row.id, reason: upErr.message });
      else embedded += 1;
    }

    const { count: remaining } = await admin
      .from("ans_knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    await logAudit(
      supabase,
      "knowledge.embed_backfill",
      "ans_knowledge_chunks",
      sourceId,
      null,
      { embedded, failed: failures.length, model, dimensions, remaining: remaining ?? 0 },
      req,
    );

    return res.status(200).json({
      success: true,
      embedded,
      failed: failures.length,
      failures: failures.slice(0, 10),
      remaining: remaining ?? 0,
      model,
      dimensions,
      note:
        (remaining ?? 0) > 0
          ? `POST again to continue (${remaining} chunk(s) remaining).`
          : "All eligible chunks now have embeddings; vector retrieval is active.",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
