/**
 * Integration (real browser/React path) for the multi-PDF vendor merge.
 *
 * This reproduces the exact deployed-QA failure: ONE change event selecting the
 * letter (text-layer, SB=2.59, fieldCount 0) AND the signed report (OCR, 9
 * categorical findings, fieldCount 7) through the real VendorPdfCard component,
 * wired to the real dashboard-style accumulator + mergeVendorExtractions.
 *
 * The previous `fieldCount > 0` emit guard silently DROPPED the letter (its SB
 * lives only in narrative.printedNumbers), so the merged state never contained
 * 2.59 — even though the pure merge unit test passed. This asserts, through the
 * component's fetch/async path, that BOTH documents land and the accumulated
 * merge carries SB=2.59 (from the letter) AND all 9 findings (from the report).
 *
 * fetch is mocked to return the REAL endpoint responses captured from the two
 * actual PDFs (de-identified fixtures) keyed by filename — so we exercise the
 * component's completion/merge logic, not the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { mergeVendorExtractions, type NamedExtraction } from "@shared/mergeVendorExtractions";
import type { VendorReportExtraction } from "@shared/vendorExtraction";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...domProps } = rest;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
  return { motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }), AnimatePresence: ({ children }: any) => children };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (n: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "../../../api/_ans/__tests__/fixtures", n), "utf8"));

const LETTER_RESP = fx("pare_letter_endpoint_response.json");
const REPORT_RESP = fx("pare_report_endpoint_response.json");
const LETTER_NAME = "Pare-Alex-Thu-Jul-11-2024.pdf";
const REPORT_NAME = "Pare-Alex-Thu-Jul-11-2024-Report.pdf";

const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(async (_url: any, init?: any) => {
    // Identify which file this request carries via the FormData filename.
    const form: FormData = init.body;
    const file = form.get("vendorPdf") as File;
    const resp = file.name === LETTER_NAME ? LETTER_RESP : REPORT_RESP;
    return { ok: true, json: async () => resp } as any;
  }) as any;
});
afterEach(() => { cleanup(); global.fetch = realFetch; });

/** Minimal host that mirrors dashboard.tsx's ref-based cumulative accumulator. */
function Host({ onMerged }: { onMerged: (m: VendorReportExtraction | null) => void }) {
  const [processing, setProcessing] = useState(false);
  const docsRef = useRef<NamedExtraction[]>([]);
  return (
    <>
      <span data-testid="processing">{processing ? "yes" : "no"}</span>
      <VendorPdfCardWrapper
        onProcessingChange={setProcessing}
        onExtraction={(x: VendorReportExtraction, meta: { fileName?: string }) => {
          const fileName = meta?.fileName ?? `doc-${docsRef.current.length + 1}`;
          docsRef.current = [
            ...docsRef.current.filter((d) => d.fileName !== fileName),
            { fileName, extraction: x },
          ];
          const { merged } = mergeVendorExtractions(docsRef.current);
          onMerged(merged);
        }}
      />
    </>
  );
}

// Lazy import so the framer-motion mock is applied first.
let VendorPdfCardWrapper: any;

describe("VendorPdfCard — one change event, both real PDFs (deployed-QA repro)", () => {
  it("accumulates BOTH documents: SB=2.59 from the letter + 9 findings from the report", async () => {
    ({ VendorPdfCard: VendorPdfCardWrapper } = await import("../components/parsed/VendorPdfCard"));

    let latestMerged: VendorReportExtraction | null = null;
    render(<Host onMerged={(m) => { latestMerged = m; }} />);

    const input = screen.getByTestId("vendor-pdf-input") as HTMLInputElement;
    const letter = new File([new Uint8Array([1])], LETTER_NAME, { type: "application/pdf" });
    const report = new File([new Uint8Array([2])], REPORT_NAME, { type: "application/pdf" });

    // ONE change event with BOTH files (the exact QA setInputFiles action).
    fireEvent.change(input, { target: { files: [letter, report] } });

    // Wait for BOTH per-document rows to finish (not just the last one).
    await waitFor(() => {
      const done = screen.getAllByTestId("vendor-pdf-doc-done");
      expect(done.length).toBe(2);
    }, { timeout: 4000 });

    // Processing gate cleared only after every file settled.
    expect(screen.getByTestId("processing").textContent).toBe("no");

    // The accumulated MERGE must contain both evidence sets.
    expect(latestMerged).toBeTruthy();
    const merged = latestMerged as unknown as VendorReportExtraction;
    const sb = merged.narrative!.printedNumbers.find((n) => n.key === "SB");
    expect(sb?.value).toBeCloseTo(2.59, 2); // from the LETTER (fieldCount 0)
    expect(merged.narrative!.findings.length).toBeGreaterThanOrEqual(9); // from the REPORT
    expect(merged.merged?.sourceFiles).toContain(LETTER_NAME);
    expect(merged.merged?.sourceFiles).toContain(REPORT_NAME);
  });

  it("shows a per-document status row for EACH selected PDF", async () => {
    ({ VendorPdfCard: VendorPdfCardWrapper } = await import("../components/parsed/VendorPdfCard"));
    render(<Host onMerged={() => {}} />);
    const input = screen.getByTestId("vendor-pdf-input") as HTMLInputElement;
    const letter = new File([new Uint8Array([1])], LETTER_NAME, { type: "application/pdf" });
    const report = new File([new Uint8Array([2])], REPORT_NAME, { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [letter, report] } });

    const list = await screen.findByTestId("vendor-pdf-doc-statuses");
    await waitFor(() => {
      expect(list.textContent).toContain(LETTER_NAME);
      expect(list.textContent).toContain(REPORT_NAME);
    }, { timeout: 4000 });
  });
});
