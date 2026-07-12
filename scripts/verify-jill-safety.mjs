// One-off: drive the REAL api/upload.ts serverless handler with the real Jill
// file and dump the safety-critical fields. Run with tsx.
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";

const handler = (await import("../api/upload.ts")).default;

const JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";
const bytes = readFileSync(JILL);
const boundary = "----verifyBoundary";
const head = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="jill.ans"\r\nContent-Type: application/octet-stream\r\n\r\n`,
);
const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([head, bytes, tail]);

const req = new EventEmitter();
req.method = "POST";
req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };

const result = await new Promise((resolve, reject) => {
  const res = {
    _s: 200,
    status(c) { this._s = c; return this; },
    setHeader() { return this; },
    json(p) { resolve({ status: this._s, json: p }); return this; },
    end() { resolve({ status: this._s, json: null }); return this; },
  };
  handler(req, res).catch(reject);
  setImmediate(() => { req.emit("data", body); req.emit("end"); });
});

const r = result.json.report;
const out = {
  http: result.status,
  spectralAvailable: r.spectralAvailable,
  bpAvailable: r.bpAvailable,
  autonomicBalance: r.autonomicBalance,
  respiratoryFrequency: r.respiratoryFrequency,
  overallImpression: r.overallImpression,
  therapyFirst: r.therapyRecommendations?.[0],
  bodyImpact: r.bodySystemImpact?.map((b) => ({ system: b.system, impact: b.impact, assessed: b.assessed, label: b.label })),
  ratios: r.ratios,
};
console.log(JSON.stringify(out, null, 2));
