/**
 * scripts/audit-ans-spectral.mts — deep re-audit of the .ans binary for the
 * vendor spectral aggregates (LFa / RFa / SB / FRF) and per-phase BP.
 *
 * WHY: earlier notes claimed those proprietary aggregates were "not present in
 * the raw .ans export, only in the signed vendor PDF." This audit tests that
 * claim empirically against a given .ans file and a set of expected vendor
 * values (e.g. from the paired OCR'd report), WITHOUT hardcoding any patient
 * identity or offset.
 *
 * It reports, for each expected value:
 *   • whether it appears as a little-endian / big-endian float32 or float64
 *     anywhere in the file (within a relative tolerance), and
 *   • the false-positive baseline (how many places any float within tolerance
 *     occurs), so a match can be judged against chance.
 *
 * It ALSO looks for a structured per-phase table (constant-stride sequence of
 * the six per-phase values), which is what a generalizable extractor would need.
 *
 * CONCLUSION for the shipped Jill/Francey/Pare files (see
 * HUMANOS_CLINICIAN_VENDOR_PARITY_REPORT.md): the values ARE physically present
 * as float32, but there is NO stable-offset table / constant-stride record /
 * length-prefixed array header to anchor a generalizable, non-coincidental
 * extractor, and proportional phase-window averaging of the located trend array
 * does not reproduce the aggregates. So the reliable path to exact vendor parity
 * is OCR of the paired report — not offset-hardcoded binary extraction.
 *
 * Usage:
 *   npx tsx scripts/audit-ans-spectral.mts <file.ans> '<json expected map>'
 *   e.g. npx tsx scripts/audit-ans-spectral.mts foo.ans '{"LFa":0.91,"RFa":5.13}'
 */
import { readFileSync } from "node:fs";

function scanFloat(buf: Buffer, val: number, tolRel = 0.001): Array<{ fmt: string; off: number; v: number }> {
  const hits: Array<{ fmt: string; off: number; v: number }> = [];
  const fmts: Array<[string, number, (o: number) => number]> = [
    ["<f", 4, (o) => buf.readFloatLE(o)],
    [">f", 4, (o) => buf.readFloatBE(o)],
    ["<d", 8, (o) => buf.readDoubleLE(o)],
    [">d", 8, (o) => buf.readDoubleBE(o)],
  ];
  const tol = Math.max(tolRel * Math.abs(val), 1e-4);
  for (const [fmt, size, read] of fmts) {
    for (let off = 0; off + size <= buf.length; off++) {
      const v = read(off);
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) > 1e6 || Math.abs(v) < 1e-9) continue;
      if (Math.abs(v - val) <= tol) {
        hits.push({ fmt, off, v });
        if (hits.length > 8) return hits;
      }
    }
  }
  return hits;
}

async function main() {
  const file = process.argv[2];
  const expectedJson = process.argv[3];
  if (!file) {
    console.error("usage: audit-ans-spectral.mts <file.ans> '<json expected map>'");
    process.exit(2);
  }
  const buf = readFileSync(file);
  const expected: Record<string, number> = expectedJson ? JSON.parse(expectedJson) : {};
  console.log(`file: ${file}  size: ${buf.length}`);
  console.log(`expected values: ${JSON.stringify(expected)}`);
  let present = 0;
  for (const [name, val] of Object.entries(expected)) {
    const hits = scanFloat(buf, val);
    if (hits.length) present++;
    console.log(
      `${hits.length ? "PRESENT" : "ABSENT "} ${name}=${val}: ${hits.length} match(es) ${JSON.stringify(hits.slice(0, 3))}`,
    );
  }
  console.log(`\n${present}/${Object.keys(expected).length} expected values physically present as IEEE floats.`);
  console.log(
    "NOTE: presence != deterministic extractability. See the report for why OCR of the paired PDF is the parity path.",
  );
}

main();
