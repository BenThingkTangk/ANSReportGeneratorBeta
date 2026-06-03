import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createSupabaseFromRequest,
  createSupabaseAdmin,
  requireRole,
  logAudit,
  setCorsHeaders,
  handleError,
} from "../../_supabase.js";

/**
 * POST /api/admin/knowledge/upload
 * Multipart upload of PDF/text file for a knowledge source.
 * - Validates ≤25 MB
 * - Uploads to Supabase Storage bucket 'knowledge-files'
 * - If PDF: extracts text with pdf-parse
 * - Chunks ~800 tokens (≈3000 chars) with 100-char overlap
 * - Inserts chunks into ans_knowledge_chunks
 * - Returns { source_id, file_path, chunkCount }
 *
 * Expects multipart/form-data with fields:
 *   - file: the binary file
 *   - source_id: existing draft source ID to attach to (optional)
 *   - title: required if no source_id
 */

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const CHUNK_SIZE = 3000; // ~800 tokens
const CHUNK_OVERLAP = 100;

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

  const supabase = createSupabaseFromRequest(req);
  const adminSupabase = createSupabaseAdmin();

  try {
    const user = await requireRole(req, ["super_admin", "clinical_admin"]);

    // Parse multipart form data
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", reject);
    });

    const rawBody = Buffer.concat(chunks);

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

    // Extract or create source record
    let finalSourceId = sourceId;
    if (!finalSourceId) {
      if (!title) {
        return res
          .status(400)
          .json({ success: false, error: "Provide source_id or title" });
      }
      const { data: newSource, error: createErr } = await adminSupabase
        .from("ans_knowledge_sources")
        .insert({
          title,
          file_mime: mimeType,
          file_size_bytes: fileBuffer.length,
          review_status: "draft",
          added_by: user.id,
          last_updated_by: user.id,
        })
        .select("id")
        .single();
      if (createErr || !newSource) {
        throw Object.assign(new Error(createErr?.message ?? "Failed to create source"), {
          statusCode: 400,
        });
      }
      finalSourceId = newSource.id;
    }

    // Upload to Supabase Storage
    const storageKey = `${finalSourceId}/${Date.now()}_${fileName}`;
    const { error: storageErr } = await adminSupabase.storage
      .from("knowledge-files")
      .upload(storageKey, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (storageErr) {
      throw Object.assign(new Error(`Storage upload failed: ${storageErr.message}`), {
        statusCode: 500,
      });
    }

    // Extract text
    let extractedText = "";
    const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      try {
        // Dynamic import to avoid module loading issues in Vercel.
        // pdf-parse's TS types expose only a namespace; runtime gives us
        // either a CJS default or the namespace itself depending on the
        // resolver, so we coerce via `unknown`.
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

    // Chunk and insert
    let chunkCount = 0;
    if (extractedText.trim().length > 0) {
      const textChunks = chunkText(extractedText);
      chunkCount = textChunks.length;

      // Delete old chunks for this source
      await adminSupabase
        .from("ans_knowledge_chunks")
        .delete()
        .eq("source_id", finalSourceId);

      // Insert new chunks
      if (textChunks.length > 0) {
        const chunkRows = textChunks.map((content, idx) => ({
          source_id: finalSourceId,
          chunk_index: idx,
          content,
          tokens: Math.ceil(content.length / 4), // rough estimate
        }));
        const { error: chunkErr } = await adminSupabase
          .from("ans_knowledge_chunks")
          .insert(chunkRows);
        if (chunkErr) console.warn("Chunk insert error:", chunkErr.message);
      }
    }

    // Update source metadata
    await adminSupabase
      .from("ans_knowledge_sources")
      .update({
        file_path: storageKey,
        file_mime: mimeType,
        file_size_bytes: fileBuffer.length,
        last_updated_by: user.id,
      })
      .eq("id", finalSourceId);

    await logAudit(
      supabase,
      "upload_file",
      "ans_knowledge_sources",
      finalSourceId,
      null,
      { file_path: storageKey, file_mime: mimeType, chunkCount } as Record<string, unknown>,
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
