/**
 * BROWSER-LEVEL touch-target regression (WCAG 2.5.5) — real layout, not classes.
 *
 * The release blocker: real Playwright at 390×844 with a coarse pointer found
 * that although controls carried `.touch-target`, the computed min-width/height
 * stayed `auto` and the `::after` overlay never enlarged the element's own box —
 * so measured hit regions were still 32×32 / *×28. The prior jsdom tests only
 * asserted CLASS PRESENCE, which is false assurance (jsdom has no layout engine).
 *
 * This test measures the REAL `getBoundingClientRect()` of each enumerated
 * control in a headless Chromium emulating a 390×844 touch viewport with
 * `(pointer: coarse)`, using the ACTUAL `.touch-target` CSS shipped in
 * client/src/index.css. It FAILS on the old ::after approach (boxes < 44) and
 * PASSES only when the element's own min box is ≥44×44.
 *
 * It skips gracefully when no browser is available (e.g. CI without the
 * Playwright browser cache), so it never breaks the pipeline — but it runs in
 * any browser-provisioned environment and locally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CdpBrowser, findChromium } from "./helpers/cdpBrowser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = resolve(__dirname, "../../../client/src/index.css");

/** Pull the `.touch-target` rules (incl. the @media coarse block) out of the
 *  shipped stylesheet so the test measures exactly what ships — a class-name or
 *  utility drift changes the extracted CSS and the measurement fails. */
function extractTouchTargetCss(css: string): string {
  const out: string[] = [];
  // Base `.touch-target { ... }`
  const base = css.match(/\.touch-target\s*\{[^}]*\}/g) ?? [];
  out.push(...base);
  // `@media (pointer: coarse) { ... .touch-target { ... } ... }`
  const mediaBlocks = css.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\s{0,4}\}/g) ?? [];
  for (const b of mediaBlocks) if (b.includes(".touch-target")) out.push(b);
  return out.join("\n");
}

/** Each enumerated control from the Playwright report + the two vendor tabs,
 *  with the REAL classes/markup they render with (icon buttons carry an SVG;
 *  text tabs carry a label). */
const CONTROLS: Array<{ id: string; html: string }> = [
  // icon buttons (were 32/36 square)
  { id: "button-back", html: `<button class="touch-target p-2 rounded-lg"><svg width="16" height="16"></svg></button>` },
  { id: "ask-atom-button-mobile", html: `<button class="touch-target w-9 h-9 rounded-full"><svg width="18" height="18"></svg></button>` },
  { id: "button-export-report", html: `<button class="touch-target w-9 h-9 rounded-full"><svg width="16" height="16"></svg></button>` },
  { id: "theme-toggle", html: `<button class="touch-target w-9 h-9 rounded-lg"><svg width="16" height="16"></svg></button>` },
  // text pill tabs (were *×28)
  { id: "toggle-patient", html: `<button class="touch-target px-4 py-1.5 rounded-lg text-xs">Patient</button>` },
  { id: "toggle-clinician", html: `<button class="touch-target px-4 py-1.5 rounded-lg text-xs">Clinician</button>` },
  { id: "clinician-view-vendor", html: `<button class="touch-target px-3.5 py-1.5 rounded-lg text-xs">Vendor Familiar</button>` },
  { id: "clinician-view-humanos", html: `<button class="touch-target px-3.5 py-1.5 rounded-lg text-xs">HumanOS Advanced</button>` },
  // Ask ATOM drawer / composer controls
  { id: "atom-mute-toggle", html: `<button class="touch-target p-1.5 rounded-lg"><svg width="14" height="14"></svg></button>` },
  { id: "ask-atom-reset", html: `<button class="touch-target p-1.5 rounded-lg"><svg width="14" height="14"></svg></button>` },
  { id: "ask-atom-close", html: `<button class="touch-target p-1.5 rounded-lg"><svg width="14" height="14"></svg></button>` },
  { id: "ask-atom-mic", html: `<button class="touch-target w-8 h-8 rounded-lg"><svg width="14" height="14"></svg></button>` },
  { id: "ask-atom-send", html: `<button class="touch-target w-8 h-8 rounded-lg"><svg width="14" height="14"></svg></button>` },
  { id: "atom-mode-patient", html: `<button class="touch-target px-2 py-1 rounded-md text-[10px]">Patient</button>` },
  { id: "atom-mode-clinician", html: `<button class="touch-target px-2 py-1 rounded-md text-[10px]">Clinician</button>` },
];

const chrome = findChromium();

describe.skipIf(!chrome)("touch targets — real coarse-pointer layout (390×844)", () => {
  let browser: CdpBrowser;
  let measured: Record<string, { w: number; h: number; coarse: boolean }>;

  beforeAll(async () => {
    browser = new CdpBrowser(chrome!);
    await browser.launch();
    await browser.emulate({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true });

    const ttCss = extractTouchTargetCss(readFileSync(INDEX_CSS, "utf8"));
    // Sanity: the coarse-pointer rule must be present (guards CSS drift).
    expect(ttCss).toMatch(/@media\s*\(pointer:\s*coarse\)/);

    const rows = CONTROLS.map(
      (c) => `<div style="display:flex"><span data-id="${c.id}">${c.html}</span></div>`,
    ).join("\n");
    const page = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        *{box-sizing:border-box;margin:0}
        button{font:12px/1 sans-serif;border:0;background:#333;color:#fff}
        ${ttCss}
      </style></head><body>${rows}</body></html>`;
    await browser.setContent(page);

    measured = await browser.evaluate(`
      (() => {
        const coarse = matchMedia('(pointer: coarse)').matches;
        const out = {};
        for (const span of document.querySelectorAll('[data-id]')) {
          const btn = span.querySelector('button');
          const r = btn.getBoundingClientRect();
          out[span.getAttribute('data-id')] = { w: Math.round(r.width*100)/100, h: Math.round(r.height*100)/100, coarse };
        }
        return out;
      })()
    `);
  }, 40_000);

  afterAll(async () => { await browser?.close(); });

  it("emulates a coarse pointer (the condition that gates the fix)", () => {
    const any = Object.values(measured)[0];
    expect(any?.coarse).toBe(true);
  });

  it.each(CONTROLS.map((c) => c.id))(
    "%s has an effective hit box ≥44×44 CSS px",
    (id) => {
      const box = measured[id];
      expect(box, `${id} not measured`).toBeTruthy();
      expect(box.w, `${id} width ${box.w} < 44`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${id} height ${box.h} < 44`).toBeGreaterThanOrEqual(44);
    },
  );
});
