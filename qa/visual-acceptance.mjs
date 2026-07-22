// Visual acceptance capture: upload → patient → clinician → ATOM, at desktop
// (1280x900) and mobile (390x844), driving the REAL report pipeline against the
// e2e host (qa/e2e-server.mjs) with a de-identified fixture.
//
// Layout-only evidence — the recordings are the INTERACTION reference, not
// numerical truth. Screenshots go to E2E_OUT (default /tmp/vlog).
//
//   E2E_ANS=api/_ans/__tests__/fixtures/pare_deid.ans \
//   node qa/visual-acceptance.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8090";
const ANS = process.env.E2E_ANS || "api/_ans/__tests__/fixtures/pare_deid.ans";
const OUT = process.env.E2E_OUT || "/tmp/vlog";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { tag: "desktop", width: 1280, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
];

const shots = [];
const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });

    // Upload screen
    await page.screenshot({ path: `${OUT}/${vp.tag}-01-upload.png` });
    shots.push(`${vp.tag}-01-upload.png`);

    await page.setInputFiles('[data-testid="file-input"]', ANS);
    await page.waitForSelector('[data-testid="parsed-review-header"]', { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/${vp.tag}-02-parsed-review.png`, fullPage: true });
    shots.push(`${vp.tag}-02-parsed-review.png`);

    await page.click('[data-testid="button-generate-report"]');
    await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 90000 });
    await page.waitForTimeout(800);

    // Patient view (full page — nervous-system hero + sections)
    await page.click('[data-testid="toggle-patient"]');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${vp.tag}-03-patient.png`, fullPage: true });
    shots.push(`${vp.tag}-03-patient.png`);

    // Clinician view (numerical + charts + ECG strip)
    await page.click('[data-testid="toggle-clinician"]');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${vp.tag}-04-clinician.png`, fullPage: true });
    shots.push(`${vp.tag}-04-clinician.png`);

    // ATOM drawer, if a launcher is present.
    const launcher = await page.$('[data-testid="ask-atom-launcher"], [data-testid="atom-launcher"], [data-testid="ask-atom-fab"]');
    if (launcher) {
      await launcher.click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/${vp.tag}-05-atom.png` });
      shots.push(`${vp.tag}-05-atom.png`);
    }

    await ctx.close();
    console.log(`captured ${vp.tag}`);
  }
} finally {
  await browser.close();
}
console.log(`\nWrote ${shots.length} screenshots to ${OUT}:`);
for (const s of shots) console.log(`  ${s}`);
