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
}

/** Default rasterization DPI. 260 is the empirical floor at which the vendor's
 *  small resting-block spectral digits (LFa/RFa/SB) OCR correctly, while keeping
 *  per-request time/memory sane on a serverless runtime. */
const DEFAULT_DPI = 260;

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
function externalImport(spec: string): Promise<any> {
  // The indirection through a variable defeats esbuild's import() analysis.
  const load = new Function("s", "return import(s)") as (s: string) => Promise<any>;
  return load(spec);
}

/**
 * Rasterize every page of a PDF to a PNG buffer using pdfjs-dist + @napi-rs/canvas.
 * Returns [] (and never throws) if the render stack is unavailable.
 */
export async function rasterizePdf(
  buffer: Buffer,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<Array<{ page: number; png: Buffer; width: number; height: number }>> {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const scale = dpi / 72;

  let pdfjs: any;
  let canvasMod: any;
  try {
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
  for (let p = 1; p <= limit; p++) {
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
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<OcrResult> {
  let rasters: Array<{ page: number; png: Buffer; width: number; height: number }>;
  try {
    rasters = await rasterizePdf(buffer, opts);
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
  const worker = await makeOcrWorker();
  if (!worker) {
    return {
      ocrAvailable: false,
      pages: [],
      reason: "OCR engine unavailable (tesseract.js not installed).",
    };
  }

  const pages: OcrPage[] = [];
  try {
    for (const r of rasters) {
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
  } finally {
    await worker.terminate();
  }
  return { ocrAvailable: true, pages };
}
