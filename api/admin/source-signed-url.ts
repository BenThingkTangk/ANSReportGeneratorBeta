import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
  createSupabaseFromRequest,
} from "../_supabase.js";
import { createSignedFileUrl } from "../_evidenceRetrieval.js";

/**
 * POST /api/admin/source-signed-url
 * Body: { source_id: string, ttl_seconds?: number }
 *
 * Returns a short-lived signed URL for the private knowledge-files object
 * attached to the given source. Requires reviewer+ role.
 *
 * NEVER returns the raw bucket path — only the signed URL.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  try {
    const user = await requireRole(req, [
      "super_admin",
      "clinical_admin",
      "reviewer",
    ]);
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const sourceId = body?.source_id;
    const ttl = Math.min(
      Math.max(parseInt(body?.ttl_seconds ?? "300", 10) || 300, 60),
      3600
    );
    if (!sourceId) {
      return res.status(400).json({ success: false, error: "source_id required" });
    }

    const admin = createSupabaseAdmin();
    const { data: src, error } = await admin
      .from("ans_knowledge_sources")
      .select("id, file_path, file_mime, active_in_ai_analysis, review_status")
      .eq("id", sourceId)
      .single();
    if (error || !src) {
      return res.status(404).json({ success: false, error: "source not found" });
    }
    if (!src.file_path) {
      return res.status(404).json({
        success: false,
        error: "source has no private file attached",
      });
    }
    // Reviewers may see archived sources, but ONLY active+approved sources
    // ever get a citable signed URL. Match the same active+approved gate that
    // the retrieval helper uses.
    if (!src.active_in_ai_analysis || src.review_status !== "approved") {
      return res.status(403).json({
        success: false,
        error: "source is not active+approved",
      });
    }

    const signedUrl = await createSignedFileUrl(src.file_path, ttl);
    if (!signedUrl) {
      return res
        .status(500)
        .json({ success: false, error: "could not create signed url" });
    }

    const supabase = createSupabaseFromRequest(req);
    await logAudit(
      supabase,
      "source.signed_url",
      "ans_knowledge_sources",
      src.id,
      null,
      { ttl_seconds: ttl, mime: src.file_mime },
      req
    );

    return res.status(200).json({
      success: true,
      data: {
        url: signedUrl,
        mime: src.file_mime,
        expires_in: ttl,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}
