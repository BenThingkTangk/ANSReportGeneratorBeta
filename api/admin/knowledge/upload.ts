import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  requireRole,
  setCorsHeaders,
  handleError,
  backendConfigStatus,
  createSupabaseAdmin,
} from "../../_supabase.js";
import {
  withRagTransaction,
  recordRagVersion,
  logRagAudit,
  ragBackendError,
  SOURCE_COLUMNS,
} from "../../_ragDb.js";

/**
 * POST /api/admin/knowledge/upload
 * Multipart upload of a PDF/text file for a knowledge source.
 * - Validates ≤25 MB
 * - Stores the binary in Supabase Storage bucket 'knowledge-files' IF Supabase
 *   is configured; otherwise it degrades gracefully (binary skipped) but the
 *   extracted text + chunks are STILL persisted — content is never discarded.
 * - If PDF: extracts text with pdf-parse
 * - Chunks ~800 tokens (≈3000 chars) with 100-char overlap
 * - Writes source row + chunks + version snapshot to Akamai PostgreSQL
 *   (humanos-ans-rag-pg) via ../../_ragDb — NOT Supabase.
 * - Returns { source_id, file_path, chunkCount }
 *
 * Expects multipart/form-data with fields:
 *   - file: the binary file
 *   - source_id: existing source ID to attach to (optional)
 *   - title: required if no source_id
 */

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const CHUNK_SIZE = 3000; // ~800 tokens
const CHUNK_OVERLAP = 100;
const INSERT_BATCH = 500;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 0);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    // Authorize FIRST — before touching any backend or reading the body.
    const user = await requireRole(req, ["super_admin", "clinical_admin"]);

    // Parse multipart form data
    const parts0: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => parts0.push(chunk));
      req.on("end", () => resolve());
      req.on("error", reject);
    });

    const rawBody = Buffer.concat(parts0);

    if (rawBody.length > MAX_FILE_SIZE) {
      return res.status(413).json({ success: false, error: "File exceeds 25 MB limit" });
    }

    // Parse boundary from Content-Type
    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return res.status(400).json({ success: false, error: "No multipart boundary found" });
    }
    const boundary = "--" + boundaryMatch[1];

    // Simple multipart parser
    const parts = rawBody
      .toString("binary")
      .split(boundary)
      .filter((p) => p.includes("Content-Disposition"));

    let fileBuffer: Buffer | null = null;
    let fileName = "upload";
    let mimeType = "application/octet-stream";
    let sourceId: string | null = null;
    let title: string | null = null;

    for (const part of parts) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd);
      const body = part.slice(headerEnd + 4, part.lastIndexOf("\r\n"));

      if (headers.includes('name="source_id"')) {
        sourceId = body.trim();
      } else if (headers.includes('name="title"')) {
        title = body.trim();
      } else if (headers.includes('name="file"')) {
        const fnMatch = headers.match(/filename="([^"]+)"/);
        if (fnMatch) fileName = fnMatch[1];
        const ctMatch = headers.match(/Content-Type: ([^\r\n]+)/);
        if (ctMatch) mimeType = ctMatch[1].trim();
        fileBuffer = Buffer.from(body, "binary");
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "No file data found in request" });
    }

    // Resolve / create the source row (PostgreSQL).
    let finalSourceId = sourceId;
    if (!finalSourceId) {
      if (!title) {
        return res.status(400).json({ success: false, error: "Provide source_id or title" });
      }
      try {
        const ins = await withRagTransaction(async (client) => {
          const r = await client.query<{ id: string }>(
            `INSERT INTO public.ans_knowledge_sources
               (title, file_mime, file_size_bytes, review_status, added_by, last_updated_by)
             VALUES ($1, $2, $3, 'draft', $4, $4)
             RETURNING id`,
            [title, mimeType, fileBuffer.length, user.id]
          );
          return r.rows[0].id;
        });
        finalSourceId = ins;
      } catch (dbErr) {
        throw ragBackendError(dbErr);
      }
    }

    // Store the binary in Supabase Storage — best-effort. If Supabase is not
    // configured or the upload fails, we DO NOT abort: the extracted text and
    // chunks (the RAG-relevant content) are still persisted below.
    let storageKey: string | null = null;
    if (backendConfigStatus().configured) {
      try {
        const adminSupabase = createSupabaseAdmin();
        const key = `${finalSourceId}/${Date.now()}_${fileName}`;
        const { error: storageErr } = await adminSupabase.storage
          .from("knowledge-files")
          .upload(key, fileBuffer, { contentType: mimeType, upsert: true });
        if (storageErr) {
          console.warn(
            "Supabase Storage upload failed (continuing; text/chunks still stored):",
            storageErr.message
          );
        } else {
          storageKey = key;
        }
      } catch (e) {
        console.warn("Supabase Storage unavailable (continuing):", (e as Error)?.message ?? "unknown");
      }
    } else {
      console.warn("Supabase Storage not configured; skipping binary upload (text/chunks still stored).");
    }

    // Extract text
    let extractedText = "";
    const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      try {
        const mod = (await import("pdf-parse")) as unknown as
          | { default: (b: Buffer) => Promise<{ text?: string }> }
          | ((b: Buffer) => Promise<{ text?: string }>);
        const pdfParse =
          typeof mod === "function"
            ? mod
            : (mod as { default: (b: Buffer) => Promise<{ text?: string }> }).default;
        const result = await pdfParse(fileBuffer);
        extractedText = result.text ?? "";
      } catch (pdfErr) {
        console.warn("pdf-parse failed, skipping text extraction:", pdfErr);
      }
    } else if (
      mimeType.startsWith("text/") ||
      fileName.endsWith(".txt") ||
      fileName.endsWith(".md")
    ) {
      extractedText = fileBuffer.toString("utf-8");
    }

    // Persist chunks + metadata + version snapshot in one transaction.
    let chunkCount = 0;
    let updatedSource: Record<string, unknown> | null = null;
    try {
      const textChunks = extractedText.trim().length > 0 ? chunkText(extractedText) : [];
      chunkCount = textChunks.length;

      updatedSource = await withRagTransaction(async (client) => {
        // Replace any existing chunks for this source.
        await client.query("DELETE FROM public.ans_knowledge_chunks WHERE source_id = $1", [
          finalSourceId,
        ]);

        for (let start = 0; start < textChunks.length; start += INSERT_BATCH) {
          const slice = textChunks.slice(start, start + INSERT_BATCH);
          const valuesSql: string[] = [];
          const p: unknown[] = [];
          let k = 1;
          slice.forEach((content, j) => {
            const idx = start + j;
            valuesSql.push(`($${k++}, $${k++}, $${k++}, $${k++})`);
            p.push(finalSourceId, idx, content, Math.ceil(content.length / 4));
          });
          await client.query(
            `INSERT INTO public.ans_knowledge_chunks (source_id, chunk_index, content, tokens)
             VALUES ${valuesSql.join(", ")}`,
            p
          );
        }

        const upd = await client.query(
          `UPDATE public.ans_knowledge_sources
              SET file_path = $2, file_mime = $3, file_size_bytes = $4, last_updated_by = $5
            WHERE id = $1
            RETURNING ${SOURCE_COLUMNS}`,
          [finalSourceId, storageKey, mimeType, fileBuffer.length, user.id]
        );
        const row = (upd.rows[0] as Record<string, unknown>) ?? null;
        if (row) {
          await recordRagVersion(client, finalSourceId as string, "import", row, {
            id: user.id,
            email: user.email,
          });
        }
        return row;
      });
    } catch (dbErr) {
      throw ragBackendError(dbErr);
    }

    await logRagAudit(
      "upload_file",
      "ans_knowledge_sources",
      finalSourceId,
      null,
      { file_path: storageKey, file_mime: mimeType, chunkCount },
      { id: user.id, email: user.email },
      req
    );

    return res.status(200).json({
      success: true,
      source_id: finalSourceId,
      file_path: storageKey,
      chunkCount,
    });
  } catch (err) {
    return handleError(res, err);
  }
}
