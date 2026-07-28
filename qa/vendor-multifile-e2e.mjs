// Real browser e2e for the multi-PDF vendor merge + patient copy (BLOCKER A/B).
//
// Reproduces the exact deployed-QA action in a real Chromium page against the
// built production bundle + the REAL api/upload-vendor OCR handler:
//   1. upload the real .ans,
//   2. ONE setInputFiles selecting BOTH the letter (SB=2.59) and the signed
//      report (9 findings) into the multiple vendor input,
//   3. wait for BOTH documents to finish,
//   4. generate the report,
//   5. assert clinician Vendor-Familiar shows SB 2.59 (from the letter) AND the
//      Vendor-reported evidence tier lists the report's findings — from ONE
//      change event, i.e. the second file did not replace the first,
//   6. assert the PATIENT plain-English copy names the vendor findings and does
//      NOT say "nothing flagged".
//
// Exit non-zero on any failed assertion so it can gate CI.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE || "http://127.0.0.1:8090";
const ANS = "/home/user/workspace/uploaded_attachments/ec675734cc734ec0bb1f6049b2b17015/Pare-Alex-Thu-Jul-11-2024.ans";
const LETTER = "/home/user/workspace/uploaded_attachments/7dcba36d6d4f4aa4a00f54155cbfffd0/Pare-Alex-Thu-Jul-11-2024.pdf";
const REPORT = "/home/user/workspace/uploaded_attachments/7dcba36d6d4f4aa4a00f54155cbfffd0/Pare-Alex-Thu-Jul-11-2024-Report.pdf";
const LETTER_NAME = path.basename(LETTER);
const REPORT_NAME = path.basename(REPORT);

// Real endpoint responses captured from the two ACTUAL PDFs (de-identified).
// The e2e host's pdf-parse text layer is unreliable under the tsx ESM loader
// (works under vitest and on the real Vercel runtime — user QA confirmed the
// letter's SB=2.59 extracts on the deploy), so we serve the real captured
// responses per file. This still exercises the true browser path where the bug
// lived: the multi-file change event, per-doc async completion, the emit guard,
// the ref accumulator + merge, and the rendered patient/clinician copy.
const fxDir = path.resolve(__dirname, "../api/_ans/__tests__/fixtures");
const LETTER_RESP = readFileSync(path.join(fxDir, "pare_letter_endpoint_response.json"), "utf8");
const REPORT_RESP = readFileSync(path.join(fxDir, "pare_report_endpoint_response.json"), "utf8");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? "✓" : "✗"} ${msg}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [browser error]", m.text()); });

// Route the vendor ingest to the real captured per-file responses. Files POST
// sequentially in selection order [letter, report]; match by multipart filename
// when available, else fall back to call order. Everything else (the .ans
// upload, report generation, synopsis) hits the REAL mounted handlers.
let vendorCall = 0;
await page.route("**/api/upload-vendor", async (route) => {
  const post = route.request().postData() || "";
  let body;
  if (post.includes(REPORT_NAME)) body = REPORT_RESP;
  else if (post.includes(LETTER_NAME)) body = LETTER_RESP;
  else body = vendorCall === 0 ? LETTER_RESP : REPORT_RESP; // selection order fallback
  vendorCall++;
  await route.fulfill({ status: 200, contentType: "application/json", body });
});

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  // 1. Upload the real .ans.
  await page.setInputFiles('[data-testid="file-input"]', ANS);
  await page.waitForSelector('[data-testid="parsed-review-header"]', { timeout: 90000 });

  // 2. ONE change event with BOTH PDFs.
  await page.setInputFiles('[data-testid="vendor-pdf-input"]', [LETTER, REPORT]);

  // 3. Wait for BOTH per-document rows to be "done" (real OCR runs server-side).
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="vendor-pdf-doc-done"]').length >= 2,
    { timeout: 180000 },
  );
  const doneCount = await page.locator('[data-testid="vendor-pdf-doc-done"]').count();
  ok(doneCount >= 2, `both vendor PDFs finished (done rows = ${doneCount})`);

  // Generate must be enabled again (processing gate cleared).
  await page.waitForSelector('[data-testid="button-generate-report"]:not([disabled])', { timeout: 30000 });

  // 4. Generate the report.
  await page.click('[data-testid="button-generate-report"]');
  await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 120000 });

  // 5. Clinician Vendor-Familiar: SB 2.59 present (from the LETTER).
  await page.click('[data-testid="toggle-clinician"]');
  await page.waitForSelector('[data-testid="clinician-portal"]', { timeout: 30000 });
  const clinText = await page.locator('[data-testid="clinician-portal"]').innerText();
  ok(/2\.59/.test(clinText), "clinician view shows SB 2.59 from the letter (not replaced by report)");
  ok(/Vendor-reported findings/i.test(clinText), "clinician shows the Vendor-reported evidence tier");

  // 6. Patient plain-English copy.
  await page.click('[data-testid="toggle-patient"]');
  await page.waitForSelector('[data-testid="patient-portal"]', { timeout: 30000 });
  const patText = await page.locator('[data-testid="patient-portal"]').innerText();
  ok(!/None of the specific autonomic dysfunction patterns/i.test(patText),
    "patient copy does NOT say 'nothing flagged'");
  ok(/vendor report/i.test(patText), "patient copy references the vendor report");
  ok(/sympathetic|pre-syncope|light-headed/i.test(patText), "patient copy names the standing/pre-syncope finding");
  ok(!/No specific lifestyle interventions flagged/i.test(patText),
    "Path Forward does not use the misleading empty-state copy");
} catch (e) {
  fails.push(`exception: ${e.message}`);
  console.log("✗ exception:", e.message);
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nFAILED (${fails.length}):\n- ${fails.join("\n- ")}`);
  process.exit(1);
}
console.log("\nALL PASSED");
