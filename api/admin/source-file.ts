import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole, setCorsHeaders, handleError } from "../_supabase.js";
import { ragQuery, logRagAudit, ragBackendError } from "../_ragDb.js";

/**
 * GET /api/admin/source-file?source_id=<uuid>
 *
 * Streams the private source binary for a knowledge source directly from the
 * AUTHORITATIVE Akamai PostgreSQL store (ans_knowledge_files.content bytea) —
 * replacing the former Supabase Storage signed-URL indirection. The bytes never
 * leave the server except to an authorized admin/reviewer session; there is no
 * external bucket and no signed URL to leak or replay.
 *
 * Security posture (matches the retrieval gate the AI path uses):
 *   • requireRole reviewer+ (admin gateway session) — enforced FIRST.
 *   • Only active_in_ai_analysis=true AND review_status='approved' sources are
 *     downloadable (same gate the old signed-url endpoint enforced) — an
 *     archived/draft source's binary is never served.
 *   • X-Content-Type-Options: nosniff + Cache-Control: private, no-store so a
 *     stored text file can't be sniffed into executable HTML and the response is
 *     never cached by a shared proxy.
 *   • The filename is sanitized before it reaches the Content-Disposition header
 *     to prevent header/response splitting.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip CR/LF/quote/control chars so a filename can't split the header. */
function safeFilename(name: string | null): string {
  const cleaned = (name ?? "")
    .replace(/[\r\n"\\\x00-\x1f\x7f]/g, "")
    .trim();
  return cleaned.length ? cleaned.slice(0, 200) : "source-file";
}

interface FileRow {
  file_name: string | null;
  file_mime: string | null;
  file_size_bytes: string | number | null;
  content: Buffer;
  active_in_ai_analysis: boolean;
  review_status: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "GET only" });
  }

  try {
    const user = await requireRole(req, [
      "super_admin",
      "clinical_admin",
      "reviewer",
    ]);

    const sourceId = (req.query.source_id as string) || "";
    if (!sourceId) {
      return res.status(400).json({ success: false, error: "source_id required" });
    }
    // A non-uuid id can never match; treat as not found (never a 500 from cast).
    if (!UUID_RE.test(sourceId)) {
      return res.status(404).json({ success: false, error: "not found" });
    }

    let row: FileRow | undefined;
    try {
      const result = await ragQuery<FileRow>(
        `SELECT f.file_name, f.file_mime, f.file_size_bytes, f.content,
                s.active_in_ai_analysis, s.review_status
           FROM public.ans_knowledge_files f
           JOIN public.ans_knowledge_sources s ON s.id = f.source_id
          WHERE f.source_id = $1`,
        [sourceId]
      );
      row = result.rows[0];
    } catch (dbErr) {
      throw ragBackendError(dbErr);
    }

    if (!row) {
      return res
        .status(404)
        .json({ success: false, error: "source has no private file attached" });
    }
    // Same active+approved gate the retrieval helper applies.
    if (!row.active_in_ai_analysis || row.review_status !== "approved") {
      return res
        .status(403)
        .json({ success: false, error: "source is not active+approved" });
    }

    const buf = Buffer.isBuffer(row.content)
      ? row.content
      : Buffer.from(row.content as unknown as ArrayBuffer);
    const mime = row.file_mime || "application/octet-stream";
    const filename = safeFilename(row.file_name);

    // Audit the access (best-effort; NON-PHI: only mime + byte length).
    await logRagAudit(
      "source.download",
      "ans_knowledge_files",
      sourceId,
      null,
      { mime, bytes: buf.length },
      { id: user.id, email: user.email },
      req
    );

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(buf);
  } catch (err) {
    return handleError(res, err);
  }
}
