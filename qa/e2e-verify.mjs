// End-to-end recovery verification (Playwright, headless chromium).
// Drives the built production app: upload the real Jill .ans file, walk the
// parse-review -> report flow, and toggle Clinician <-> Patient views asserting
// the app never blanks/crashes and honest-gating copy is present.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8090";
// Path to a real .ans study to drive the flow. Defaults to the local QA sample
// but is overridable so no patient file path is hard-required by the script.
const JILL = process.env.E2E_ANS ||
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";
const OUT = process.env.E2E_OUT || "/tmp/verify-logs";

const results = [];
const rec = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
const errors = [];
for (const vp of [
  { tag: "desktop", width: 1280, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${vp.tag}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${vp.tag}] console.error: ${m.text()}`); });

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    rec(`${vp.tag}: app loads`, true);

    // Step 1: upload via hidden file input
    await page.setInputFiles('[data-testid="file-input"]', JILL);

    // Step 2: parse-review screen appears
    await page.waitForSelector('[data-testid="parsed-review-header"]', { timeout: 60000 });
    rec(`${vp.tag}: parse-review renders`, true);

    // Step 3: generate full report
    await page.click('[data-testid="button-generate-report"]');
    await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 90000 });
    rec(`${vp.tag}: report renders (view-toggle present)`, true);

    // Step 4: Clinician view — no crash, has content
    await page.click('[data-testid="toggle-clinician"]');
    await page.waitForTimeout(600);
    const clinPortal = await page.locator('[data-testid="clinician-portal"]').count();
    const clinBody = (await page.locator("body").innerText()).trim();
    rec(`${vp.tag}: clinician view non-empty`, clinPortal > 0 && clinBody.length > 200,
      `portal=${clinPortal} bodyLen=${clinBody.length}`);

    // Step 5: Patient view — no crash (this was the historic blanking bug)
    await page.click('[data-testid="toggle-patient"]');
    await page.waitForTimeout(600);
    const patPortal = await page.locator('[data-testid="patient-portal"]').count();
    const patBody = (await page.locator("body").innerText()).trim();
    rec(`${vp.tag}: patient view non-empty (no blank crash)`, patPortal > 0 && patBody.length > 200,
      `portal=${patPortal} bodyLen=${patBody.length}`);

    // Step 6: toggle back to clinician (the switch that used to blank the app)
    await page.click('[data-testid="toggle-clinician"]');
    await page.waitForTimeout(600);
    const backBody = (await page.locator("body").innerText()).trim();
    rec(`${vp.tag}: clinician<->patient round-trip stable`, backBody.length > 200, `bodyLen=${backBody.length}`);

    // Step 7: honest-gating copy present (spectral not assessed for Jill)
    const patText = patBody.toLowerCase();
    rec(`${vp.tag}: honest not-assessed gating shown`,
      /not assessed|not reproducible|require|clinician review|unavailable/.test(patText), "patient copy");

    await page.screenshot({ path: `${OUT}/e2e-${vp.tag}-clinician.png`, fullPage: false });
  } catch (e) {
    rec(`${vp.tag}: flow`, false, e.message);
    try { await page.screenshot({ path: `${OUT}/e2e-${vp.tag}-FAIL.png`, fullPage: false }); } catch {}
  } finally {
    await ctx.close();
  }
}
await browser.close();

if (errors.length) {
  console.log("\n--- page/console errors captured ---");
  errors.forEach((e) => console.log("  " + e));
}
const failed = results.filter((r) => !r.ok);
// Uncaught page errors are a hard fail signal for the "blank crash" regression.
const hardErr = errors.filter((e) => /pageerror/.test(e));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${hardErr.length} uncaught page errors`);
process.exit(failed.length === 0 && hardErr.length === 0 ? 0 : 1);
