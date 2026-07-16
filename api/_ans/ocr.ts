/**
 * api/_ans/ocr.ts — production OCR for scanned / image-only vendor PDFs.
 *
 * The signed Physio PS ("P&S 4.0") reports Dr. Colombo works from are exported
 * as FLAT RASTER PDFs — every page is a single RGB image with no text layer, so
 * `pdf-parse` returns nothing (see pdfText.ts). To read the vendor's printed
 * values verbatim we must rasterize each page and run OCR.
 *
 * This module is a thin, dependency-guarded wrapper:
 *   • rasterizePdf() — pdfjs-dist (pure JS) + @napi-rs/canvas (prebuilt, no
 *     native toolchain) render each page to a PNG buffer. No poppler / system
 *     binary is required, so it deploys unchanged on Vercel's Node runtime.
 *   • ocrImage() — tesseract.js (WASM) recognizes text AND per-word bounding
 *     boxes + confidence, which vendorOcrParse.ts turns into per-field
 *     provenance (page + pixel region + confidence).
 *
 * SAFETY: OCR only ever READS the vendor's own printed numbers. Nothing here
 * computes, infers, or interpolates a clinical value — exactly like the
 * text-layer path. Downstream (vendorOcrParse.ts) tags every extracted value
 * `vendor_reported`. If OCR is unavailable (deps missing) or a page yields no
 * confident digits, the field is simply ABSENT — never zero-filled.
 *
 * All heavy deps are loaded via dynamic import inside the functions so the
 * module (and the rest of the API bundle) imports cheaply and degrades to a
 * clear "ocrAvailable:false" signal instead of throwing at cold start.
 */

import { ensureCanvasGlobals } from "./canvasPolyfill.js";

export interface OcrWord {
  text: string;
  /** 0..100 tesseract confidence. */
  confidence: number;
  /** Pixel bounding box in the rasterized page image. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPage {
  /** 1-based page index. */
  page: number;
  /** Full recognized text (line-preserving). */
  text: string;
  /** Mean word confidence 0..100. */
  confidence: number;
  /** Per-word geometry for region-level provenance. */
  words: OcrWord[];
  /** Rasterized page dimensions in pixels (for region provenance scaling). */
  width: number;
  height: number;
}

export interface OcrResult {
  ocrAvailable: boolean;
  pages: OcrPage[];
  /** Populated when OCR could not run (missing deps, etc.). */
  reason?: string;
  /**
   * Set when OCR stopped early because the wall-clock budget was hit or the
   * caller cancelled. `pages` then holds whatever was read verbatim before the
   * stop — downstream fields that weren't reached stay ABSENT, never guessed.
   */
  truncated?: "deadline" | "cancelled";
}

/** Default rasterization DPI. 260 is the empirical floor at which the vendor's
 *  small resting-block spectral digits (LFa/RFa/SB) OCR correctly, while keeping
 *  per-request time/memory sane on a serverless runtime. */
const DEFAULT_DPI = 260;

/**
 * Default wall-clock budget for a single OCR request. Tesseract WASM + high-DPI
 * rasterization is CPU-bound and runs on the Node event loop; under `vercel dev`
 * (one process serving both the Vite client and the API) an unbounded OCR pass
 * starves the loop and the browser page goes unresponsive. A hard deadline keeps
 * the request bounded: whatever fields were read verbatim before the budget is
 * hit are returned; the rest stay ABSENT (honest), never guessed. Callers can
 * override (e.g. tests use a tiny budget to prove the deadline path).
 *
 * NOTE: responsiveness comes from YIELDING between units of work (checkpoint()),
 * not from a short deadline — the event loop stays live for the whole pass
 * regardless of duration. So this cap is a generous runaway-guard set above the
 * time a normal multi-page scanned vendor report needs (empirically ~45s for a
 * 5-page Physio-PS report incl. the high-DPI summary refine).
 */
const DEFAULT_OCR_DEADLINE_MS = 60_000;

/** Options shared by the OCR entry points, incl. cooperative cancellation. */
export interface OcrRunOpts {
  dpi?: number;
  maxPages?: number;
  summaryDpi?: number;
  /** Hard wall-clock budget in ms (default DEFAULT_OCR_DEADLINE_MS). */
  deadlineMs?: number;
  /** Cooperative cancel — when it aborts, OCR stops at the next checkpoint. */
  signal?: AbortSignal;
  /**
   * Test-only injection seam. Lets a deterministic test drive the deadline /
   * yield / cancel behaviour without the heavy (and slow, non-mockable via the
   * anti-bundler dynamic import) real render+OCR stack. Never set in production.
   */
  __deps?: {
    rasterize?: typeof rasterizePdf;
    makeWorker?: () => Promise<any | null>;
  };
}

class OcrAbortError extends Error {
  constructor(public readonly kind: "deadline" | "cancelled") {
    super(kind === "deadline" ? "OCR deadline exceeded" : "OCR cancelled");
    this.name = "OcrAbortError";
  }
}

/**
 * Yield control back to the event loop, and enforce deadline/cancel. Called at
 * every coarse checkpoint (between pages, between refine cells) so a long OCR
 * pass NEVER blocks the main thread for more than one unit of work — the browser
 * stays responsive under `vercel dev`. Throws OcrAbortError when the budget is
 * spent or the caller aborted, which the orchestrator catches to return a
 * partial-but-honest result.
 */
async function checkpoint(deadline: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new OcrAbortError("cancelled");
  if (Date.now() >= deadline) throw new OcrAbortError("deadline");
  // setImmediate drains the microtask queue AND lets pending I/O (Vite asset
  // requests, HMR) run before the next CPU-heavy recognize() call.
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (signal?.aborted) throw new OcrAbortError("cancelled");
}

/**
 * Dynamic import that a bundler CANNOT statically analyze, so esbuild/@vercel/node
 * leaves the module external and resolves it from node_modules at runtime instead
 * of trying to inline it. This is essential for the OCR stack: @napi-rs/canvas
 * ships a `.node` native binary that esbuild has no loader for (it errors "No
 * loader is configured for .node files"), and pdfjs-dist/tesseract.js are large.
 * Keeping them external means the serverless bundle stays small and the deploy
 * never fails on these optional deps — if they're truly missing at runtime the
 * callers below degrade to "OCR unavailable".
 */
async function externalImport(spec: string): Promise<any> {
  // Primary: indirection through a variable defeats esbuild's import() analysis.
  try {
    const load = new Function("s", "return import(s)") as (s: string) => Promise<any>;
    return await load(spec);
  } catch (err: any) {
    // Some runtimes (e.g. the vitest VM) reject the `new Function` import with
    // "A dynamic import callback was not specified". Fall back to resolving the
    // module's real path via createRequire (anchored on this module) and
    // importing THAT — still opaque to esbuild's static analysis because the
    // resolved specifier is computed at runtime.
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const anchor =
        typeof import.meta !== "undefined" && import.meta.url
          ? import.meta.url
          : pathToFileURL(`${process.cwd()}/index.js`).href;
      const req = createRequire(anchor);
      const resolved = req.resolve(spec);
      return await import(pathToFileURL(resolved).href);
    } catch {
      throw err;
    }
  }
}

/**
 * Rasterize every page of a PDF to a PNG buffer using pdfjs-dist + @napi-rs/canvas.
 * Returns [] (and never throws) if the render stack is unavailable.
 */
export async function rasterizePdf(
  buffer: Buffer,
  opts: { dpi?: number; maxPages?: number; deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<Array<{ page: number; png: Buffer; width: number; height: number }>> {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const scale = dpi / 72;

  let pdfjs: any;
  let canvasMod: any;
  try {
    // CRITICAL ORDERING: install DOMMatrix/ImageData/Path2D on globalThis from
    // @napi-rs/canvas BEFORE importing pdfjs. pdfjs's legacy build uses these at
    // TOP LEVEL during module evaluation (e.g. `const SCALE_MATRIX = new
    // DOMMatrix()`), and its own self-polyfill only fires if its internal
    // `require("@napi-rs/canvas")` resolves — which Vercel's file tracer often
    // fails to bundle for our indirectly-imported optional dep. Without this the
    // pdfjs import throws `ReferenceError: DOMMatrix is not defined` (the exact
    // production regression). If canvas is unavailable we return [] and the
    // caller degrades to "OCR unavailable" — we never import pdfjs with the
    // globals missing, and never install a partial stub.
    const poly = await ensureCanvasGlobals();
    if (!poly.installed) {
      return [];
    }
    // legacy build is the Node-friendly entry (no DOM required). Loaded via
    // externalImport so the native canvas binary is never bundled (see above).
    pdfjs = await externalImport("pdfjs-dist/legacy/build/pdf.mjs");
    canvasMod = await externalImport("@napi-rs/canvas");
  } catch (err: any) {
    return [];
  }

  // Point workerSrc at the worker module that ships with THIS pdfjs-dist so the
  // fake-worker fallback loads a version-matched worker (avoids both the "No
  // workerSrc specified" and the "API version does not match Worker version"
  // errors — the latter happens when a differently-versioned worker bundled by
  // another dep, e.g. pdf-parse, is resolved instead).
  try {
    if (pdfjs.GlobalWorkerOptions) {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      // Anchor createRequire on a real path. import.meta.url can be undefined when
      // this module is bundled to CJS (e.g. by @vercel/node), so fall back to the
      // current working directory instead of throwing.
      const anchor =
        typeof import.meta !== "undefined" && import.meta.url
          ? import.meta.url
          : pathToFileURL(`${process.cwd()}/index.js`).href;
      const req = createRequire(anchor);
      const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    }
  } catch {
    /* fall back to pdfjs default resolution */
  }

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const out: Array<{ page: number; png: Buffer; width: number; height: number }> = [];
  const limit = Math.min(doc.numPages, opts.maxPages ?? doc.numPages);
  // Rendering each page is CPU-bound; yield to the loop between pages so the dev
  // server stays responsive, and honour any deadline/cancel from the caller.
  const rasterDeadline = opts.deadlineMs != null ? Date.now() + opts.deadlineMs : Number.POSITIVE_INFINITY;
  for (let p = 1; p <= limit; p++) {
    if (opts.signal?.aborted || Date.now() >= rasterDeadline) break;
    if (p > 1) await new Promise<void>((resolve) => setImmediate(resolve));
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = canvasMod.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // White background — vendor pages are white; avoids OCR noise on transparency.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    out.push({ page: p, png: canvas.toBuffer("image/png"), width, height });
  }
  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return out;
}

/** Create a tesseract worker, or null if the engine isn't installed. */
async function makeOcrWorker(): Promise<any | null> {
  let tesseract: any;
  try {
    tesseract = await externalImport("tesseract.js");
  } catch {
    return null;
  }
  const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
  if (typeof createWorker !== "function") return null;
  return await createWorker("eng");
}

/** Recognize one PNG with an existing worker (word geometry + confidence). */
async function recognizeWith(
  worker: any,
  png: Buffer,
): Promise<{ text: string; confidence: number; words: OcrWord[] }> {
  const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  // tesseract.js v5 exposes words under data.blocks[].paragraphs[].lines[].words[]
  const collect = (w: any) => {
    if (!w || typeof w.text !== "string") return;
    const bb = w.bbox ?? {};
    words.push({
      text: w.text,
      confidence: typeof w.confidence === "number" ? w.confidence : 0,
      bbox: { x0: bb.x0 ?? 0, y0: bb.y0 ?? 0, x1: bb.x1 ?? 0, y1: bb.y1 ?? 0 },
    });
  };
  if (Array.isArray(data.words)) {
    data.words.forEach(collect);
  } else if (Array.isArray(data.blocks)) {
    for (const b of data.blocks) {
      for (const par of b.paragraphs ?? []) {
        for (const line of par.lines ?? []) {
          for (const w of line.words ?? []) collect(w);
        }
      }
    }
  }
  return {
    text: (data.text ?? "").replace(/\r\n/g, "\n"),
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    words,
  };
}

/**
 * Precision cell-crop re-OCR of the page-2 "Numerical Summary" grid.
 *
 * The coarse full-page OCR resolves this dense grid poorly (decimals collapse,
 * digits drop). Here we use the detected grid geometry to CROP each cell from
 * the high-DPI raster, upscale + grayscale + contrast-stretch it, and re-OCR the
 * tiny image with a per-column numeric whitelist and single-line PSM. Each
 * refined value becomes a high-confidence OcrWord placed at the cell's expected
 * box, which the geometry parser then picks up. Purely generic (driven by the
 * detected header/anchor geometry — no patient/value hardcoding). Best-effort:
 * returns the original words plus any refined cells; never throws.
 */
async function refineSummaryCells(
  worker: any,
  canvasMod: any,
  parseMod: any,
  raster: { png: Buffer; width: number; height: number },
  coarse: { text: string; confidence: number; words: OcrWord[] },
  deadline = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): Promise<OcrWord[]> {
  const page: OcrPage = {
    page: 2,
    text: coarse.text,
    confidence: coarse.confidence,
    words: coarse.words,
    width: raster.width,
    height: raster.height,
  };
  const grid = parseMod.computePhaseGrid(page);
  if (!grid) return coarse.words;

  const { colX, rowYs, pitch } = grid as {
    colX: Record<string, number>;
    rowYs: Array<{ L: string; y: number }>;
    pitch: number;
  };

  // Load the raster once into an Image for repeated cropping.
  let srcImg: any;
  try {
    srcImg = await canvasMod.loadImage(raster.png);
  } catch {
    return coarse.words;
  }

  // Per-column crop half-width (px) and OCR whitelist. Numeric columns use a
  // digits+dot whitelist; BP adds "/"; duration adds ":".
  // Tight per-column crop half-widths (fraction of page width). Columns are ~0.09
  // apart; crops MUST stay narrow so a neighboring column's value is never pulled
  // into the cell (that produced merged reads like "30.1892" = 0.18+92). A narrow
  // crop that clips → the cell simply stays not-read (honest) rather than wrong.
  const NUM_WL = "0123456789.";
  const cols: Array<{ key: string; halfW: number; whitelist: string; kind: "num" | "bp" | "dur" }> = [
    { key: "duration", halfW: 0.05, whitelist: "0123456789:.", kind: "dur" },
    { key: "meanHR", halfW: 0.042, whitelist: NUM_WL, kind: "num" },
    { key: "rangeHR", halfW: 0.042, whitelist: NUM_WL, kind: "num" },
    { key: "FRF", halfW: 0.042, whitelist: NUM_WL, kind: "num" },
    { key: "LFa", halfW: 0.05, whitelist: NUM_WL, kind: "num" },
    { key: "RFa", halfW: 0.05, whitelist: NUM_WL, kind: "num" },
    { key: "SB", halfW: 0.05, whitelist: NUM_WL, kind: "num" },
    { key: "BP", halfW: 0.055, whitelist: "0123456789/", kind: "bp" },
    { key: "PP", halfW: 0.035, whitelist: NUM_WL, kind: "num" },
    { key: "MAP", halfW: 0.035, whitelist: NUM_WL, kind: "num" },
  ];

  const refined: OcrWord[] = [];
  const rowH = Math.max(18, Math.round(pitch * 0.7));
  const SCALE = 3; // upscale small crops for the OCR engine

  for (const { L, y } of rowYs) {
    // Yield between rows and stop early if the budget is spent / caller cancelled.
    // Whatever cells were refined so far are still returned (merged below) — the
    // rest fall back to the coarse high-DPI words, staying honest.
    if (signal?.aborted || Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const c of cols) {
      const cxCenter = colX[c.key];
      if (cxCenter == null) continue;
      const halfWpx = Math.round(raster.width * c.halfW);
      const left = Math.max(0, Math.round(cxCenter - halfWpx));
      const top = Math.max(0, Math.round(y - rowH / 2));
      const cw = Math.min(raster.width - left, halfWpx * 2);
      const ch = Math.min(raster.height - top, rowH);
      if (cw < 8 || ch < 8) continue;

      // Render the crop (upscaled, grayscale, hard-threshold) at a given
      // binarization threshold → PNG. Returns null on failure.
      const renderCrop = (thresh: number): Buffer | null => {
        try {
          const cv = canvasMod.createCanvas(cw * SCALE, ch * SCALE);
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cw * SCALE, ch * SCALE);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(srcImg, left, top, cw, ch, 0, 0, cw * SCALE, ch * SCALE);
          const img = ctx.getImageData(0, 0, cw * SCALE, ch * SCALE);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = lum < thresh ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = v;
          }
          ctx.putImageData(img, 0, 0);
          return cv.toBuffer("image/png");
        } catch {
          return null;
        }
      };

      // Shape validator: a genuine cell is a single number / one N.NN decimal /
      // one NN/NN BP / one MM:SS duration. Rejects merged neighbor reads.
      const shapeOk = (raw: string): boolean => {
        const dots = (raw.match(/\./g) || []).length;
        if (c.kind === "num") {
          if (dots > 1) return false;
          if (dots === 1) {
            const [ip, fp] = raw.split(".");
            return fp.length <= 2 && ip.length <= 3;
          }
          return raw.length <= 3;
        }
        if (c.kind === "bp") return /^\d{2,3}\/\d{2,3}$/.test(raw);
        const dg = raw.replace(/\D/g, "");
        return /^\d{1,2}[:.]\d{2}$/.test(raw) || dg.length === 4;
      };

      const readAt = async (thresh: number): Promise<{ raw: string; conf: number } | null> => {
        const png = renderCrop(thresh);
        if (!png) return null;
        try {
          await worker.setParameters({
            tessedit_char_whitelist: c.whitelist,
            tessedit_pageseg_mode: "7", // single line — robust for tiny crops
          });
          const { data } = await worker.recognize(png, {}, { text: true });
          const raw = String(data?.text ?? "").trim().replace(/\s+/g, "");
          const conf = typeof data?.confidence === "number" ? data.confidence : 0;
          return raw ? { raw, conf } : null;
        } catch {
          return null;
        }
      };

      // DUAL-THRESHOLD CORROBORATION: read the cell at two binarization
      // thresholds and accept ONLY if both agree. A single-source misread (which
      // is threshold-sensitive) won't reproduce, so this removes wrong values at
      // the cost of some yield — exactly the tradeoff the truth constraint wants.
      const r1 = await readAt(135);
      if (!r1 || !shapeOk(r1.raw)) continue;
      const r2 = await readAt(160);
      if (!r2 || r2.raw !== r1.raw) continue;

      refined.push({
        text: r1.raw,
        confidence: Math.max(r1.conf, r2.conf),
        bbox: { x0: cxCenter - 10, y0: y - 8, x1: cxCenter + 10, y1: y + 8 },
      });
    }
  }

  // Reset PSM/whitelist so any later full-page recognize is unaffected.
  try {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
  } catch {
    /* ignore */
  }

  // Refined cell words take PRIORITY: place them first so the parser's
  // nearest-x / confidence selection prefers them over the coarse tokens.
  return [...refined, ...coarse.words];
}

/**
 * OCR a single rasterized page image. Spins up its own worker; for multi-page
 * work prefer ocrPdf(), which reuses one worker across all pages. Returns null
 * (never throws) if the OCR engine is unavailable.
 */
export async function ocrImage(
  png: Buffer,
): Promise<{ text: string; confidence: number; words: OcrWord[] } | null> {
  const worker = await makeOcrWorker();
  if (!worker) return null;
  try {
    return await recognizeWith(worker, png);
  } finally {
    await worker.terminate();
  }
}

/**
 * Full pipeline: rasterize + OCR every page. Degrades to ocrAvailable:false with
 * a reason (never throws) so callers can report honestly instead of crashing.
 */
export async function ocrPdf(
  buffer: Buffer,
  opts: OcrRunOpts = {},
): Promise<OcrResult> {
  const deadlineMs = opts.deadlineMs ?? DEFAULT_OCR_DEADLINE_MS;
  const deadline = Date.now() + deadlineMs;
  const signal = opts.signal;

  const rasterize = opts.__deps?.rasterize ?? rasterizePdf;
  const makeWorker = opts.__deps?.makeWorker ?? makeOcrWorker;

  let rasters: Array<{ page: number; png: Buffer; width: number; height: number }>;
  try {
    rasters = await rasterize(buffer, {
      dpi: opts.dpi,
      maxPages: opts.maxPages,
      deadlineMs,
      signal,
    });
  } catch (err: any) {
    return { ocrAvailable: false, pages: [], reason: `rasterize failed: ${err?.message ?? err}` };
  }
  if (rasters.length === 0) {
    return {
      ocrAvailable: false,
      pages: [],
      reason: "PDF rasterizer unavailable (pdfjs-dist / @napi-rs/canvas not installed).",
    };
  }

  // One worker for the whole document — a tesseract WASM worker is expensive to
  // spin up, so we reuse it across pages instead of per-page create/terminate.
  const worker = await makeWorker();
  if (!worker) {
    return {
      ocrAvailable: false,
      pages: [],
      reason: "OCR engine unavailable (tesseract.js not installed).",
    };
  }

  const pages: OcrPage[] = [];
  let truncated: OcrResult["truncated"];
  try {
    for (const r of rasters) {
      // Yield + enforce deadline/cancel BEFORE each CPU-heavy recognize().
      await checkpoint(deadline, signal);
      const res = await recognizeWith(worker, r.png);
      pages.push({
        page: r.page,
        text: res.text,
        confidence: res.confidence,
        words: res.words,
        width: r.width,
        height: r.height,
      });
    }

    // --- Targeted high-DPI re-OCR of the "Numerical Summary" page --------------
    // The dense A–F per-phase grid on the Multi-Parameter page reads unreliably at
    // the default DPI (decimals collapse, rows collide). If a page looks like the
    // summary page, re-render JUST that page at a higher DPI and APPEND it as an
    // extra OcrPage (same page number). The geometry-based phase-table parser
    // prefers the higher-resolution copy for the grid, while identity/baseline/
    // ratios keep reading the default-DPI copy — high DPI can crop/miss the
    // ratio header block, so we must NOT discard the default OCR. Best-effort:
    // any failure simply leaves the default pages untouched.
    //
    // This refine pass is the single most expensive stage (a 600-DPI re-raster +
    // ~70 cell crops × 2 thresholds) and is REQUIRED for accurate per-phase grid
    // values on scanned reports, so we always attempt it when a summary page is
    // present — but only if there is enough remaining budget to finish it. If the
    // budget is too low we skip it (rather than blow the deadline) and the grid
    // simply keeps the coarse base-DPI reads; unresolved cells stay ABSENT, never
    // guessed. Every row inside refine also checkpoints the deadline/cancel.
    const summaryDpi = opts.summaryDpi ?? 600;
    const baseDpi = opts.dpi ?? DEFAULT_DPI;
    // Need enough remaining budget for the high-DPI raster + refine, else skip.
    const REFINE_MIN_BUDGET_MS = 8_000;
    const budgetLeft = deadline - Date.now();
    const summaryIdx = pages.findIndex((p) => /Numerical\s*Summary/i.test(p.text ?? ""));
    if (
      summaryDpi > baseDpi &&
      summaryIdx >= 0 &&
      budgetLeft >= REFINE_MIN_BUDGET_MS &&
      !signal?.aborted
    ) {
      const pageNo = pages[summaryIdx].page;
      try {
        const hi = await rasterize(buffer, {
          dpi: summaryDpi,
          maxPages: pageNo,
          deadlineMs: budgetLeft,
          signal,
        });
        const hiRaster = hi.find((r) => r.page === pageNo);
        if (hiRaster) {
          await checkpoint(deadline, signal);
          const hiRes = await recognizeWith(worker, hiRaster.png);
          if ((hiRes.words?.length ?? 0) > 0 && /Numerical\s*Summary/i.test(hiRes.text ?? "")) {
            // Precision cell-crop re-OCR of the grid (best-effort). Needs the
            // canvas module (for cropping) and the geometry helper.
            let words = hiRes.words;
            try {
              const canvasMod = await externalImport("@napi-rs/canvas");
              const parseMod = await import("./vendorOcrParse.js");
              words = await refineSummaryCells(worker, canvasMod, parseMod, hiRaster, hiRes, deadline, signal);
            } catch {
              /* fall back to coarse high-DPI words */
            }
            pages.push({
              page: pageNo,
              text: hiRes.text,
              confidence: hiRes.confidence,
              words,
              width: hiRaster.width,
              height: hiRaster.height,
            });
          }
        }
      } catch (err) {
        // A deadline/cancel during refine is not fatal — keep the base pages.
        if (err instanceof OcrAbortError) truncated = err.kind;
        /* else keep default-DPI OCR only */
      }
    }
  } catch (err) {
    // Deadline/cancel during the base page loop: return the pages read so far.
    if (err instanceof OcrAbortError) truncated = err.kind;
    else throw err;
  } finally {
    await worker.terminate();
  }
  return { ocrAvailable: true, pages, ...(truncated ? { truncated } : {}) };
}
