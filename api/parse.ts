import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseStudy } from "./_ans/parseStudy.js";
import { computeDiagnosticSummary } from "./_ans/scoring/index.js";

// Inlined to avoid pulling _supabase.ts (and its @supabase/supabase-js import)
// into the parse-only function bundle. setCorsHeaders has no runtime deps.
function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * POST /api/parse  (multipart/form-data with `ansFile`)
 *
 * Parse-only endpoint. Returns the normalized AnsStudy + DiagnosticSummary
 * WITHOUT generating the legacy report payload. Used by the new "Parsed Data
 * Review" gate so the user can audit extraction before committing to a full
 * report generation.
 *
 * Response: { success: true, ansStudy, diagnosticSummary }
 */

// Match the multipart parser already used by /api/upload (no dep needed).
function parseMultipart(
  req: VercelRequest
): Promise<{ buffer: Buffer; fileName?: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const ct = req.headers["content-type"] || "";
      const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
      if (!bMatch) return reject(new Error("No multipart boundary found"));
      const boundary = bMatch[1] || bMatch[2];
      const bBuf = Buffer.from(`--${boundary}`);

      let start = -1,
        end = -1,
        headerEnd = -1;
      for (let i = 0; i < body.length - bBuf.length; i++) {
        if (body.subarray(i, i + bBuf.length).equals(bBuf)) {
          if (start === -1) start = i + bBuf.length + 2;
          else {
            end = i - 2;
            break;
          }
        }
      }
      if (start === -1 || end === -1)
        return reject(new Error("Could not parse multipart data"));

      const headerSection = body.subarray(start, Math.min(start + 1000, end));
      for (let i = 0; i < headerSection.length - 3; i++) {
        if (
          headerSection[i] === 0x0d &&
          headerSection[i + 1] === 0x0a &&
          headerSection[i + 2] === 0x0d &&
          headerSection[i + 3] === 0x0a
        ) {
          headerEnd = start + i + 4;
          break;
        }
      }
      if (headerEnd === -1)
        return reject(new Error("Could not find header end"));

      let fileName: string | undefined;
      try {
        const headerStr = body.subarray(start, headerEnd).toString("utf-8");
        const fn = headerStr.match(/filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i);
        if (fn) fileName = (fn[1] || fn[2] || "").trim();
      } catch {
        /* ignore */
      }
      resolve({ buffer: body.subarray(headerEnd, end), fileName });
    });
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  let stage = "init";
  try {
    stage = "multipart";
    const { buffer, fileName } = await parseMultipart(req);
    if (!buffer?.length) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded (field: ansFile)" });
    }

    stage = "parseStudy";
    const ansStudy = parseStudy({
      buffer,
      fileName: fileName || "upload.ans",
    });

    stage = "diagnosticSummary";
    const diagnosticSummary = computeDiagnosticSummary(ansStudy);

    stage = "trim-preview";
    // Trim ECG preview so the wire payload stays small.
    const ecgPreview = Array.isArray(ansStudy.ecg?.preview)
      ? ansStudy.ecg.preview.slice(0, 1000)
      : [];
    const ansStudyForWire = {
      ...ansStudy,
      ecg: { ...(ansStudy.ecg ?? {}), preview: ecgPreview },
    };

    stage = "respond";
    return res.status(200).json({
      success: true,
      ansStudy: ansStudyForWire,
      diagnosticSummary,
    });
  } catch (err: any) {
    console.error(`[parse] error at stage=${stage}:`, err?.message, err?.stack);
    return res.status(500).json({
      success: false,
      error: err?.message ?? "parse failed",
      stage,
    });
  }
}
