/**
 * Build a de-identified vendor-OCR fixture from a real signed vendor PDF.
 *
 * Runs the production OCR pipeline (ocrPdf) on the real PDF, then redacts the
 * patient's real name in both the page `text` and every per-word token,
 * replacing it with a fixed pseudonym of the SAME length so downstream geometry
 * and label anchoring are unchanged. The result is a genuine OCR oracle (the
 * vendor's real printed numbers/narrative are preserved verbatim) that is safe
 * to commit because it no longer contains the patient's name.
 *
 * DOB is left intact only if you pass --keep-dob; by default the DOB day/month
 * is shifted to Jan-1 of the same year (birth year retained, per safe harbor),
 * matching scripts/build-deid-fixture.mts for the .ans side.
 *
 * Usage:
 *   npx tsx scripts/build-deid-vendor-ocr.mts <vendor.pdf> <out.json> \
 *       --last Pare=Faux --first Alex=John [--dob 9/17/1975=1/1/1975]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ocrPdf } from "../api/_ans/ocr.js";

function parseRepl(args: string[], flag: string): [string, string] | null {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  const [from, to] = args[i + 1].split("=");
  if (!from || !to) return null;
  return [from, to];
}

/** Replace whole-word `from` with `to` case-insensitively in a string. */
function redactString(s: string, repls: Array<[string, string]>): string {
  let out = s;
  for (const [from, to] of repls) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), to);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [src, out] = args;
  if (!src || !out) {
    throw new Error("usage: build-deid-vendor-ocr.mts <vendor.pdf> <out.json> --last A=B --first C=D [--dob X=Y]");
  }
  const repls: Array<[string, string]> = [];
  for (const flag of ["--last", "--first", "--dob"]) {
    const r = parseRepl(args, flag);
    if (r) repls.push(r);
  }
  if (repls.length === 0) throw new Error("provide at least one --last/--first/--dob replacement");

  const buf = readFileSync(src);
  const ocr = await ocrPdf(buf);
  if (!ocr.ocrAvailable) throw new Error(`OCR unavailable: ${ocr.reason ?? "unknown"}`);

  const pages = ocr.pages.map((p) => ({
    ...p,
    text: redactString(p.text, repls),
    words: p.words.map((w) => ({ ...w, text: redactString(w.text, repls) })),
  }));

  // Sanity: none of the original identifiers may survive in text.
  const blob = JSON.stringify(pages);
  for (const [from] of repls) {
    if (new RegExp(`\\b${from}\\b`, "i").test(blob)) {
      throw new Error(`redaction failed: "${from}" still present in output`);
    }
  }

  writeFileSync(out, JSON.stringify(pages, null, 2));
  // eslint-disable-next-line no-console
  console.log(`wrote ${out}: ${pages.length} page(s), redactions: ${repls.map((r) => r.join("→")).join(", ")}`);
}

main();
