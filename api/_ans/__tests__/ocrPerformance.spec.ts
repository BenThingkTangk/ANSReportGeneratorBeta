/**
 * OCR performance + responsiveness regression.
 *
 * Release blocker: attaching the 5-page SCANNED Physio-PS vendor PDF drove the
 * server OCR pipeline (full-page tesseract on every page + a 600-DPI re-raster
 * and ~70-cell refine of the summary grid) to run tens of seconds of CPU-bound
 * WASM synchronously. Under `vercel dev` (one Node process serving the Vite
 * client AND the API) that starved the event loop, so the browser page went
 * unresponsive and Playwright timed out.
 *
 * The fix adds a wall-clock deadline, cooperative AbortSignal cancel, and an
 * event-loop yield at every coarse checkpoint (between pages and refine rows),
 * and skips the expensive refine when the base OCR already resolved the grid or
 * the budget is low. This test proves all of that DETERMINISTICALLY, without the
 * heavy real render/OCR stack, via ocrPdf's `__deps` injection seam:
 *   1. the deadline is honoured (returns truncated:"deadline", bounded pages);
 *   2. cancellation is honoured (returns truncated:"cancelled");
 *   3. the event loop keeps running DURING OCR (a timer keeps firing — proving
 *      we yield and never block the main thread for the whole pass);
 *   4. a happy-path run within budget returns all pages, un-truncated.
 *
 * The endpoint's own text-path-skips-OCR behaviour is covered in
 * uploadVendorOcr.spec.ts. No PHI: fully synthetic buffers/pages.
 */
import { describe, it, expect } from "vitest";
import { ocrPdf, type OcrRunOpts } from "../ocr.js";

/** A fake tesseract worker whose recognize() burns ~`costMs` of CPU, like the
 *  real WASM call. Synchronous busy-wait mimics the un-yieldable atomic unit of
 *  work between our checkpoints. */
function makeFakeWorker(costMs: number) {
  return {
    async recognize() {
      const end = Date.now() + costMs;
      while (Date.now() < end) { /* busy — one atomic unit, like real recognize() */ }
      return { data: { text: "Numerical Summary", confidence: 90, words: [] } };
    },
    async setParameters() {},
    async terminate() {},
  };
}

/** Fake rasterizer: N synthetic pages, no pdfjs/canvas needed. */
function makeFakeRasterize(pageCount: number): NonNullable<OcrRunOpts["__deps"]>["rasterize"] {
  return (async (_buf: Buffer, opts: any = {}) => {
    const limit = Math.min(pageCount, opts.maxPages ?? pageCount);
    const out = [];
    for (let p = 1; p <= limit; p++) {
      out.push({ page: p, png: Buffer.from([0x89, 0x50]), width: 1700, height: 2200 });
    }
    return out;
  }) as any;
}

const BUF = Buffer.from("%PDF-1.4 synthetic");

describe("ocrPdf — deadline / cancel / event-loop liveness", () => {
  it("honours the wall-clock deadline and returns a bounded, truncated result", async () => {
    // 8 pages × 200ms each = 1.6s of work, but deadline is 500ms → must stop early.
    const t0 = Date.now();
    const res = await ocrPdf(BUF, {
      deadlineMs: 500,
      summaryDpi: 0, // no refine
      __deps: { rasterize: makeFakeRasterize(8), makeWorker: async () => makeFakeWorker(200) },
    });
    const elapsed = Date.now() - t0;
    expect(res.ocrAvailable).toBe(true);
    expect(res.truncated).toBe("deadline");
    // Bounded: stopped well before all 8 pages, and not far past the deadline
    // (worst case = deadline + one atomic recognize).
    expect(res.pages.length).toBeGreaterThan(0);
    expect(res.pages.length).toBeLessThan(8);
    expect(elapsed).toBeLessThan(500 + 200 + 300); // deadline + 1 unit + slack
  });

  it("stops promptly when the caller aborts (cancel path)", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 250);
    const t0 = Date.now();
    const res = await ocrPdf(BUF, {
      deadlineMs: 60_000,
      summaryDpi: 0,
      signal: ac.signal,
      __deps: { rasterize: makeFakeRasterize(20), makeWorker: async () => makeFakeWorker(150) },
    });
    const elapsed = Date.now() - t0;
    expect(res.truncated).toBe("cancelled");
    expect(res.pages.length).toBeLessThan(20);
    expect(elapsed).toBeLessThan(250 + 150 + 400);
  });

  it("keeps the event loop responsive DURING OCR (no main-thread freeze)", async () => {
    // A 50ms timer must keep firing while OCR runs. Without yielding between
    // pages the whole pass would block and the timer would fire ~0 times mid-run.
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 50);
    const res = await ocrPdf(BUF, {
      deadlineMs: 60_000,
      summaryDpi: 0,
      __deps: { rasterize: makeFakeRasterize(6), makeWorker: async () => makeFakeWorker(120) },
    });
    clearInterval(iv);
    expect(res.truncated).toBeUndefined();
    expect(res.pages.length).toBe(6);
    // 6 × 120ms ≈ 720ms of work; a 50ms timer should have fired several times
    // because we yield (setImmediate) between each page.
    expect(ticks).toBeGreaterThanOrEqual(3);
  });

  it("completes un-truncated when comfortably within budget", async () => {
    const res = await ocrPdf(BUF, {
      deadlineMs: 60_000,
      summaryDpi: 0,
      __deps: { rasterize: makeFakeRasterize(3), makeWorker: async () => makeFakeWorker(30) },
    });
    expect(res.ocrAvailable).toBe(true);
    expect(res.truncated).toBeUndefined();
    expect(res.pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });
});
