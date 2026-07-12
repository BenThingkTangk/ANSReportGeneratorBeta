/**
 * Reproduces the production /api/upload pipeline locally end-to-end against a
 * synthetic fixture to find the source of the 500 error.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseStudy } from "../../api/_ans/parseStudy.js";
import { computeDiagnosticSummary } from "../../api/_ans/scoring/index.js";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "eval/fixtures/normal-001-female-45.json"), "utf8")
);
const buffer = Buffer.from(fixture.ansBase64, "base64");

try {
  console.log("→ parseStudy");
  const study = parseStudy({ buffer, fileName: fixture.fileName });
  console.log("✓ parseStudy ok, warnings:", study.extractionWarnings.length);

  console.log("→ computeDiagnosticSummary");
  const summary = computeDiagnosticSummary(study);
  console.log("✓ summary ok, severity:", summary.reportConfidence);

  // Now exercise the full /api/upload handler path. Dynamic import of the
  // module exports, then call the parts that produce ANSReport.
  console.log("→ import /api/upload module");
  const uploadMod: any = await import("../../api/upload.js");
  console.log("✓ upload module loaded, exports:", Object.keys(uploadMod));

  // Look for buildReport / processFile / similar internal
  if (typeof uploadMod.default === "function") {
    console.log("→ invoke default handler via mock req/res");
    // Construct a Node-like multipart body
    const boundary = "----vitest-boundary";
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="${fixture.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      "utf8"
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const body = Buffer.concat([head, buffer, tail]);

    const { Readable } = await import("node:stream");
    const req: any = Readable.from([body]);
    req.method = "POST";
    req.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    };

    let statusCode = 200;
    let responseBody: any = null;
    const res: any = {
      setHeader: () => {},
      status(c: number) { statusCode = c; return this; },
      json(b: any) { responseBody = b; return this; },
      end() { return this; },
    };

    await uploadMod.default(req, res);
    console.log("✓ handler returned, status:", statusCode);
    if (statusCode >= 400) {
      console.log("RESPONSE BODY:", JSON.stringify(responseBody, null, 2).slice(0, 2000));
    } else {
      console.log("RESPONSE KEYS:", Object.keys(responseBody || {}));
    }
  }
} catch (e: any) {
  console.error("✗ ERROR:", e?.message);
  console.error(e?.stack);
}
