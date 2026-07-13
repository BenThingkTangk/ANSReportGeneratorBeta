/**
 * api/_ans/pdfText.ts — resilient PDF → text extraction.
 *
 * pdf-parse's API has shifted between major versions (a default callable in
 * v1 vs a `PDFParse` class in v2). This helper tries both shapes so callers
 * get text regardless of the installed version, and returns an empty string
 * (never throws) when a PDF has no extractable text layer — e.g. a scanned /
 * image-only report, which needs OCR (an external step) rather than parsing.
 *
 * pdf-parse loads pdfjs-dist under the hood, and pdfjs uses DOMMatrix at module
 * TOP LEVEL. On a serverless Node runtime (Vercel) that global is absent and
 * pdfjs's own self-polyfill can silently fail (see canvasPolyfill.ts), so we
 * install DOMMatrix/ImageData/Path2D BEFORE importing pdf-parse — otherwise the
 * import throws `ReferenceError: DOMMatrix is not defined` before we can even
 * fall through to OCR. This must precede the pdf-parse import; it is cheap and
 * idempotent, and if canvas is unavailable we simply degrade to "" (no text).
 */
import { ensureCanvasGlobals } from "./canvasPolyfill.js";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // If the canvas globals can't be installed, importing pdf-parse (→ pdfjs)
  // would throw at pdfjs's top-level `new DOMMatrix()`. Degrade to "no text
  // layer" so the caller falls through to OCR (which reports honestly) instead
  // of 500-ing the whole request.
  const poly = await ensureCanvasGlobals();
  if (!poly.installed) return "";
  const mod: any = await import("pdf-parse");

  // v2: named PDFParse class with getText()
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
  if (typeof PDFParse === "function") {
    try {
      const parser = new PDFParse({ data: buffer });
      const r = await parser.getText();
      return (r?.text ?? "").trim();
    } catch {
      // fall through to v1 shape
    }
  }

  // v1: default export is callable and returns { text }
  const pdfParse = typeof mod === "function" ? mod : mod.default;
  if (typeof pdfParse === "function") {
    try {
      const result = await pdfParse(buffer);
      return (result?.text ?? "").trim();
    } catch {
      return "";
    }
  }

  return "";
}
