/**
 * api/_ans/canvasPolyfill.ts — server-side DOMMatrix / ImageData / Path2D
 * polyfill for pdfjs-dist under a serverless Node runtime (Vercel).
 *
 * WHY THIS EXISTS
 * ---------------
 * pdfjs-dist's Node entry (`legacy/build/pdf.mjs`) *tries* to polyfill the
 * canvas globals itself: in a block gated by `isNodeJS` it does
 *   const require = process.getBuiltinModule("module").createRequire(import.meta.url);
 *   canvas = require("@napi-rs/canvas");
 *   if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;  // + ImageData, Path2D
 * BUT the module ALSO uses those globals at TOP LEVEL during evaluation, e.g.
 *   const SCALE_MATRIX = new DOMMatrix();                 // pdf.mjs
 *   ... = new DOMMatrix().scaleSelf(...).translateSelf(0, -height);  // pdf.worker.mjs
 *
 * That self-polyfill only works if pdfjs's OWN `require("@napi-rs/canvas")`
 * resolves at import time. On Vercel the OCR deps are loaded through an
 * indirection (`new Function("s","return import(s)")` in ocr.ts) specifically so
 * esbuild/@vercel/node never bundle the native `.node` binary — which means
 * Vercel's file tracer often does NOT trace `@napi-rs/canvas` into the function,
 * and pdfjs's internal `require` throws. The polyfill block then only `warn()`s,
 * `globalThis.DOMMatrix` stays undefined, and the very next top-level statement
 * (`new DOMMatrix()`) throws `ReferenceError: DOMMatrix is not defined` while the
 * module is still evaluating — surfacing to the user as "DOMMatrix is not
 * defined" from /api/upload-vendor.
 *
 * THE FIX
 * -------
 * Install the globals from `@napi-rs/canvas` OURSELVES, before pdfjs is
 * imported. We resolve canvas the same resilient way pdfjs expects, and we only
 * ever assign the REAL classes from the native canvas — never a stub. If canvas
 * genuinely cannot be loaded we return {installed:false} and the caller degrades
 * to "OCR unavailable" (honest) instead of installing a broken stub that would
 * silently corrupt rendering.
 *
 * This is idempotent and cheap: once the globals are present (either because a
 * previous call installed them, or the platform already provides them) it is a
 * no-op.
 */

export interface PolyfillResult {
  /** True once DOMMatrix/ImageData/Path2D are all present on globalThis. */
  installed: boolean;
  /** Which globals this call actually assigned (for logging/tests). */
  applied: string[];
  /** Populated when @napi-rs/canvas could not be loaded. */
  reason?: string;
}

/** Normalize @napi-rs/canvas's ESM/CJS interop: the classes may sit on the
 *  namespace object or under `.default`. Return whichever object actually
 *  carries `DOMMatrix`, or the module itself as a last resort. */
function pickCanvasNamespace(mod: any): any {
  if (typeof mod?.DOMMatrix === "function") return mod;
  if (typeof mod?.default?.DOMMatrix === "function") return mod.default;
  return mod;
}

/**
 * Load @napi-rs/canvas without letting a bundler inline its native `.node`
 * binary. Two strategies, tried in order, so it works on the Vercel Node
 * runtime, under plain Node/tsx, and under the vitest ESM loader:
 *
 *   1. `createRequire(import.meta.url)` + `require("@napi-rs/canvas")`. Anchored
 *      on the MODULE's own URL, so resolution finds the package from this file's
 *      node_modules regardless of the process entry / cwd. This is exactly how
 *      pdfjs itself loads canvas, it is opaque to esbuild's `.node` loader (the
 *      require target is a runtime string), and it works in the vitest VM where
 *      the `import()` callback is unavailable. This is the primary path.
 *   2. A dynamic import through `new Function("s","return import(s)")` as a
 *      fallback. esbuild / @vercel/node cannot statically analyze it, so the
 *      `.node` binary stays external (mirrors ocr.ts's externalImport).
 *
 * Returns null (never throws) when the package genuinely cannot be loaded.
 */
async function loadCanvas(): Promise<any | null> {
  // Strategy 1: createRequire anchored on this module (reliable on Vercel/Node/vitest).
  try {
    const { createRequire } = await import("node:module");
    const anchor =
      typeof import.meta !== "undefined" && import.meta.url
        ? import.meta.url
        : `${process.cwd()}/index.js`;
    const req = createRequire(anchor);
    const mod = req("@napi-rs/canvas");
    const ns = pickCanvasNamespace(mod);
    if (typeof ns?.DOMMatrix === "function") return ns;
  } catch {
    /* fall through to dynamic import */
  }
  // Strategy 2: bundler-opaque dynamic import.
  try {
    const load = new Function("s", "return import(s)") as (s: string) => Promise<any>;
    const mod = await load("@napi-rs/canvas");
    const ns = pickCanvasNamespace(mod);
    if (typeof ns?.DOMMatrix === "function") return ns;
  } catch {
    /* unavailable */
  }
  return null;
}

let cached: PolyfillResult | null = null;

/**
 * Ensure DOMMatrix, ImageData and Path2D exist on globalThis BEFORE pdfjs is
 * imported. Must be awaited prior to importing any pdfjs entrypoint.
 */
export async function ensureCanvasGlobals(): Promise<PolyfillResult> {
  // Fast path: everything already present (platform-provided or a prior call).
  if (
    typeof (globalThis as any).DOMMatrix === "function" &&
    typeof (globalThis as any).ImageData === "function" &&
    typeof (globalThis as any).Path2D === "function"
  ) {
    return { installed: true, applied: [] };
  }
  if (cached?.installed) return cached;

  const canvas = await loadCanvas();
  if (!canvas) {
    cached = {
      installed: false,
      applied: [],
      reason: "@napi-rs/canvas not loadable; cannot polyfill DOMMatrix/ImageData/Path2D.",
    };
    return cached;
  }

  const applied: string[] = [];
  // Only assign the genuine native classes — never a partial stub. A missing
  // class here means we report installed:false rather than corrupt rendering.
  const g = globalThis as any;
  if (typeof g.DOMMatrix !== "function" && typeof canvas.DOMMatrix === "function") {
    g.DOMMatrix = canvas.DOMMatrix;
    applied.push("DOMMatrix");
  }
  if (typeof g.ImageData !== "function" && typeof canvas.ImageData === "function") {
    g.ImageData = canvas.ImageData;
    applied.push("ImageData");
  }
  if (typeof g.Path2D !== "function" && typeof canvas.Path2D === "function") {
    g.Path2D = canvas.Path2D;
    applied.push("Path2D");
  }
  // pdfjs also reads navigator.language in Node; provide a minimal shim if absent
  // (harmless, matches pdfjs's own node_utils fallback).
  if (!g.navigator || !g.navigator.language) {
    g.navigator = { language: "en-US", platform: "", userAgent: "" };
    applied.push("navigator");
  }

  const installed =
    typeof g.DOMMatrix === "function" &&
    typeof g.ImageData === "function" &&
    typeof g.Path2D === "function";

  cached = installed
    ? { installed: true, applied }
    : {
        installed: false,
        applied,
        reason:
          "@napi-rs/canvas loaded but did not expose DOMMatrix/ImageData/Path2D; " +
          "refusing to install a partial stub.",
      };
  return cached;
}

/** Test helper: forget the memoized result so a test can re-exercise loading. */
export function __resetCanvasPolyfillCache(): void {
  cached = null;
}
