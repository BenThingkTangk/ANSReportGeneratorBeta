import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseANSFile } from "../server/ansParser";
import { generateANSReport } from "../server/ansAlgorithm";

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipart(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
      if (!boundaryMatch) {
        reject(new Error("No multipart boundary found"));
        return;
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const boundaryBuffer = Buffer.from(`--${boundary}`);

      // Find the file content between boundaries
      let start = -1;
      let end = -1;
      let headerEnd = -1;

      for (let i = 0; i < body.length - boundaryBuffer.length; i++) {
        if (body.subarray(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
          if (start === -1) {
            // First boundary found, skip past it + CRLF
            start = i + boundaryBuffer.length + 2;
          } else {
            // Second boundary - end of file content (minus CRLF before boundary)
            end = i - 2;
            break;
          }
        }
      }

      if (start === -1 || end === -1) {
        reject(new Error("Could not parse multipart data"));
        return;
      }

      // Find the end of headers (double CRLF)
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

      if (headerEnd === -1) {
        reject(new Error("Could not find header end in multipart"));
        return;
      }

      resolve(body.subarray(headerEnd, end));
    });
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const fileBuffer = await parseMultipart(req);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    // Parse the .ans binary file
    const patientData = parseANSFile(fileBuffer);

    // Generate the full ANS report using the algorithm
    const report = generateANSReport(patientData);

    return res.status(200).json({
      success: true,
      patientData,
      report,
    });
  } catch (error: any) {
    console.error("Error processing file:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process ANS file",
    });
  }
}
