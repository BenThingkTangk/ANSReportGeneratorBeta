/**
 * qa/vendor-parity.mjs — paired .ans + scanned vendor PDF parity evidence.
 *
 * Drives the REAL app: uploads the .ans, attaches the scanned vendor PDF (OCR),
 * generates the report, and captures the clinician Vendor-Familiar view on
 * desktop + mobile. Also POSTs the vendor PDF to /api/upload-vendor and writes a
 * numerical diff table (vendor-printed vs. app-rendered) to JSON.
 *
 * Output (untracked, may contain PHI → /tmp only):
 *   ${OUT}/parity-desktop-vendor.png, parity-mobile-vendor.png,
 *   parity-desktop-humanos.png, parity-diff.json
 *
 * Env: E2E_BASE, E2E_ANS, E2E_VENDOR_PDF, E2E_OUT, PARITY_EXPECTED (json).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8091";
const ANS = process.env.E2E_ANS;
const VENDOR_PDF = process.env.E2E_VENDOR_PDF;
const OUT = process.env.E2E_OUT || "/tmp/parity";
// Vendor's own printed ground-truth values (from the report), for the diff table.
const EXPECTED = JSON.parse(
  process.env.PARITY_EXPECTED ||
    '{"LFa":0.91,"RFa":5.13,"SB":0.18,"eiRatio":1.21,"valsalvaRatio":1.43,"thirtyFifteenRatio":1.40}',
);

if (!ANS || !VENDOR_PDF) {
  console.error("Set E2E_ANS and E2E_VENDOR_PDF");
  process.exit(2);
}

// 1) Numerical diff via the API (deterministic, no rendering).
async function apiDiff() {
  const fs = await import("node:fs");
  const form = new FormData();
  const bytes = fs.readFileSync(VENDOR_PDF);
  form.append("vendorPdf", new Blob([bytes], { type: "application/pdf" }), "vendor.pdf");
  const res = await fetch(`${BASE}/api/upload-vendor`, { method: "POST", body: form });
  const json = await res.json();
  const got = {};
  for (const m of json.metrics ?? []) got[m.key] = m.value;
  const ex = json.extraction ?? {};
  const readVal = (path) => {
    const [g, k] = path;
    return ex?.[g]?.[k]?.value ?? null;
  };
  const rows = Object.entries(EXPECTED).map(([key, vendor]) => {
    const app =
      got[key] ??
      readVal(["baseline", key]) ??
      readVal(["ratios", key]) ??
      null;
    const match = app != null && Math.abs(app - vendor) <= Math.max(0.01 * Math.abs(vendor), 0.01);
    return { metric: key, vendorPrinted: vendor, appRendered: app, exactMatch: match };
  });
  return { source: json.source, ocrConfidence: json.ocrConfidence, meanConfidence: ex.meanConfidence, rows };
}

const diff = await apiDiff();
writeFileSync(`${OUT}/parity-diff.json`, JSON.stringify(diff, null, 2));
console.log("DIFF TABLE:");
console.table(diff.rows);
const allExact = diff.rows.every((r) => r.exactMatch);
console.log(`source=${diff.source} ocrConf=${diff.ocrConfidence} meanFieldConf=${(diff.meanConfidence ?? 0).toFixed(2)} allExact=${allExact}`);

// 2) Rendered evidence.
const browser = await chromium.launch();
for (const vp of [
  { tag: "desktop", width: 1280, height: 1600 },
  { tag: "mobile", width: 390, height: 1400 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="file-input"]', ANS);
  await page.waitForSelector('[data-testid="parsed-review-header"]', { timeout: 60000 });
  // Attach the vendor PDF (OCR happens server-side; wait for imported metrics).
  await page.setInputFiles('[data-testid="vendor-pdf-input"]', VENDOR_PDF);
  await page.waitForSelector('[data-testid="vendor-pdf-metrics"]', { timeout: 150000 });
  await page.click('[data-testid="button-generate-report"]');
  await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 90000 });
  await page.click('[data-testid="toggle-clinician"]');
  await page.waitForSelector('[data-testid="vendor-familiar-report"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/parity-${vp.tag}-vendor.png`, fullPage: true });
  // HumanOS view for comparison (desktop only).
  if (vp.tag === "desktop") {
    await page.click('[data-testid="clinician-view-humanos"]');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/parity-${vp.tag}-humanos.png`, fullPage: true });
  }
  console.log(`captured ${vp.tag}`);
  await ctx.close();
}
await browser.close();
console.log("done →", OUT);
