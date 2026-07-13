/**
 * Regression test for the production "DOMMatrix is not defined" crash in the
 * /api/upload-vendor OCR path (Vercel serverless).
 *
 * ROOT CAUSE (see canvasPolyfill.ts): pdfjs-dist's legacy Node build uses
 * DOMMatrix/ImageData/Path2D at TOP LEVEL during module evaluation. Its own
 * self-polyfill only fires if pdfjs's internal `require("@napi-rs/canvas")`
 * resolves — which Vercel's file tracer frequently fails to do for our
 * indirectly-imported optional native dep. When that require fails, importing
 * pdfjs throws `ReferenceError: DOMMatrix is not defined` before rasterization
 * can even begin.
 *
 * These tests:
 *  1. REPRODUCE the serverless environment (canvas globals absent) and prove our
 *     polyfill installs the real @napi-rs/canvas classes ahead of any pdfjs use.
 *  2. Prove that AFTER the polyfill, a top-level `new DOMMatrix()` (the exact
 *     construct pdfjs evaluates at import time) succeeds — i.e. rasterization can
 *     start rather than crashing.
 *  3. Guard against unsafe stubs: only genuine canvas classes are installed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureCanvasGlobals,
  __resetCanvasPolyfillCache,
} from "../canvasPolyfill.js";

/** Wipe the canvas globals to emulate a fresh serverless cold start where the
 *  platform provides no DOM and pdfjs's internal require has (or would have)
 *  failed to polyfill them. */
function simulateMissingCanvasGlobals() {
  const g = globalThis as any;
  delete g.DOMMatrix;
  delete g.ImageData;
  delete g.Path2D;
  __resetCanvasPolyfillCache();
}

describe("canvasPolyfill — serverless DOMMatrix regression", () => {
  beforeEach(() => {
    simulateMissingCanvasGlobals();
  });

  it("reproduces the missing-DOMMatrix env: bare `new DOMMatrix()` throws", () => {
    expect(typeof (globalThis as any).DOMMatrix).toBe("undefined");
    // This is exactly what pdfjs evaluates at module top level
    // (`const SCALE_MATRIX = new DOMMatrix()`), so without a polyfill the
    // pdfjs import — and thus rasterization — cannot even begin.
    expect(() => new (globalThis as any).DOMMatrix()).toThrow(/DOMMatrix is not defined|not a constructor/);
  });

  it("installs real DOMMatrix/ImageData/Path2D from @napi-rs/canvas", async () => {
    const res = await ensureCanvasGlobals();
    expect(res.installed).toBe(true);
    expect(typeof (globalThis as any).DOMMatrix).toBe("function");
    expect(typeof (globalThis as any).ImageData).toBe("function");
    expect(typeof (globalThis as any).Path2D).toBe("function");
    // The exact three globals were assigned this run (navigator may or may not
    // already exist in the test runtime, so assert on the canvas trio).
    expect(res.applied).toEqual(expect.arrayContaining(["DOMMatrix", "ImageData", "Path2D"]));
  });

  it("after polyfill, top-level `new DOMMatrix()` (pdfjs's construct) works", async () => {
    await ensureCanvasGlobals();
    const DOMMatrix = (globalThis as any).DOMMatrix;
    // Mirror pdfjs's real usage: identity matrix + a scale/translate chain.
    const m = new DOMMatrix().scaleSelf(0.5, -0.5).translateSelf(0, -100);
    expect(m).toBeTruthy();
    // Prove it's a functioning matrix, not a hollow stub.
    expect(typeof m.multiplySelf === "function" || typeof m.a === "number").toBe(true);
  });

  it("installs real canvas classes (not hollow stubs) capable of rendering", async () => {
    await ensureCanvasGlobals();
    const ImageData = (globalThis as any).ImageData;
    const img = new ImageData(2, 2);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.data.length).toBe(2 * 2 * 4);
  });

  it("is idempotent: a second call is a no-op once globals are present", async () => {
    await ensureCanvasGlobals();
    const second = await ensureCanvasGlobals();
    expect(second.installed).toBe(true);
    expect(second.applied).toEqual([]);
  });
});

describe("canvasPolyfill — end-to-end unblocks pdfjs import", () => {
  it("pdfjs legacy build imports cleanly after the polyfill runs", async () => {
    simulateMissingCanvasGlobals();
    const res = await ensureCanvasGlobals();
    expect(res.installed).toBe(true);
    // Import pdfjs AFTER the globals are installed (ocr.ts uses a bundler-opaque
    // dynamic import for the same effect; here a plain import() is enough to
    // prove the module evaluates without a DOMMatrix ReferenceError).
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // If DOMMatrix were still missing, this import would have thrown during
    // module evaluation and we'd never reach here.
    expect(typeof pdfjs.getDocument).toBe("function");
  });
});

/**
 * The decisive regression: in a simulated serverless env where the canvas
 * globals are absent at cold start, the production `rasterizePdf` (ocr.ts) must
 * install the polyfill, import pdfjs, and actually RASTERIZE a page — i.e.
 * scanned-PDF rendering "starts successfully" instead of throwing "DOMMatrix is
 * not defined". We feed a minimal real one-page PDF so the whole render path
 * (getDocument → getPage → getViewport → canvas render → toBuffer) executes.
 */
const MINIMAL_PDF = (() => {
  // Smallest valid single-page PDF (no content stream needed to render blank).
  const objs = [
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>\nendobj\n",
  ];
  let body = "";
  const offsets: number[] = [];
  for (const o of objs) {
    if (o.startsWith("%PDF")) { body += o; continue; }
    offsets.push(body.length);
    body += o;
  }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1");
})();

describe("rasterizePdf — starts successfully in missing-DOMMatrix serverless env", () => {
  it("renders a page instead of crashing with 'DOMMatrix is not defined'", async () => {
    simulateMissingCanvasGlobals();
    // Import the production rasterizer AFTER wiping globals — it must self-install
    // the polyfill before importing pdfjs.
    const { rasterizePdf } = await import("../ocr.js");
    const pages = await rasterizePdf(MINIMAL_PDF, { maxPages: 1 });
    // Rasterization started AND produced a PNG buffer — proof the render path ran.
    expect(pages.length).toBe(1);
    expect(pages[0].page).toBe(1);
    expect(pages[0].width).toBeGreaterThan(0);
    expect(pages[0].height).toBeGreaterThan(0);
    expect(Buffer.isBuffer(pages[0].png)).toBe(true);
    // PNG magic bytes — a real image was rendered, not an empty stub.
    expect(pages[0].png.subarray(0, 4).toString("latin1")).toBe("\x89PNG");
    // Globals are now installed as a side effect.
    expect(typeof (globalThis as any).DOMMatrix).toBe("function");
  }, 30_000);
});
