/**
 * api/_ans/pdfText.ts — resilient PDF → text extraction.
 *
 * pdf-parse's API has shifted between major versions (a default callable in
 * v1 vs a `PDFParse` class in v2). This helper tries both shapes so callers
 * get text regardless of the installed version, and returns an empty string
 * (never throws) when a PDF has no extractable text layer — e.g. a scanned /
 * image-only report, which needs OCR (an external step) rather than parsing.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
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
