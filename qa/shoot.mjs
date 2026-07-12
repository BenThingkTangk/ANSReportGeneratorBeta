// Capture report screenshots (desktop + mobile) for layout inspection.
// Writes to /tmp/vlog (never committed — may render deidentified fixture data).
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8090";
const ANS = process.env.E2E_ANS || process.argv[2];
const OUT = process.env.E2E_OUT || "/tmp/vlog";

const browser = await chromium.launch();
for (const vp of [
  { tag: "desktop", width: 1280, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="file-input"]', ANS);
  await page.waitForSelector('[data-testid="parsed-review-header"]', { timeout: 60000 });
  await page.screenshot({ path: `${OUT}/shot-${vp.tag}-review.png`, fullPage: false });
  await page.click('[data-testid="button-generate-report"]');
  await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 90000 });
  // Patient view
  await page.click('[data-testid="toggle-patient"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/shot-${vp.tag}-patient.png`, fullPage: false });
  // Clinician view
  await page.click('[data-testid="toggle-clinician"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/shot-${vp.tag}-clinician.png`, fullPage: false });
  console.log(`shot ${vp.tag} done`);
  await ctx.close();
}
await browser.close();
