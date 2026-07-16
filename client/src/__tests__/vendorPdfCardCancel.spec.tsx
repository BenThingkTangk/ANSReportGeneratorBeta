/**
 * VendorPdfCard — responsiveness contract for the scanned-PDF OCR path.
 *
 * Release blocker: attaching the scanned vendor PDF left the UI stuck on
 * "Reading PDF…" with no progress, no cancel, and Generate Report still firing
 * on a half-read attachment. This verifies the client half of the fix:
 *   1. attaching shows progressive status and reports busy=true to the parent
 *      (which gates Generate Report);
 *   2. a Cancel button aborts the in-flight request, clears busy, and imports
 *      nothing;
 *   3. a fast success reports busy=false and surfaces the imported metric.
 *
 * The network is mocked so no real OCR runs. No PHI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup as rtlCleanup } from "@testing-library/react";

describe("VendorPdfCard — progress + cancel + busy gating", () => {
  const realFetch = global.fetch;
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { rtlCleanup(); global.fetch = realFetch; });

  function pdfFile(name = "vendor.pdf") {
    return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
  }

  it("reports busy during read and un-busy after a successful import", async () => {
    const { render, fireEvent, within, waitFor } = await import("@testing-library/react");
    const { VendorPdfCard } = await import("../components/parsed/VendorPdfCard");

    // Resolve quickly with one metric.
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        success: true, source: "text", metrics: [{ key: "LFa", label: "LFa", value: 2.5, unit: "bpm2" }],
        extraction: { fieldCount: 1 },
      }),
    })) as any;

    const busy: boolean[] = [];
    const ingested: any[] = [];
    const utils = render(
      <VendorPdfCard onBusyChange={(b) => busy.push(b)} onIngested={(m) => ingested.push(m)} />,
    );
    const scoped = within(utils.container);
    const input = scoped.getByTestId("vendor-pdf-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pdfFile()], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(scoped.getByTestId("vendor-pdf-metrics")).toBeTruthy());
    expect(busy).toContain(true);           // signalled busy while reading
    expect(busy[busy.length - 1]).toBe(false); // and cleared when done
    expect(ingested.at(-1)?.[0]?.key).toBe("LFa");
  });

  it("shows a Cancel button while reading and aborts on click (imports nothing)", async () => {
    const { render, fireEvent, within, waitFor } = await import("@testing-library/react");
    const { VendorPdfCard } = await import("../components/parsed/VendorPdfCard");

    // A fetch that rejects with an abort-like error when the signal fires, and
    // otherwise never resolves — simulating a long OCR the user cancels.
    global.fetch = vi.fn((_url: any, init: any) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err: any = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as any;

    const busy: boolean[] = [];
    const ingested: any[] = [];
    const utils = render(
      <VendorPdfCard onBusyChange={(b) => busy.push(b)} onIngested={(m) => ingested.push(m)} />,
    );
    const scoped = within(utils.container);
    const input = scoped.getByTestId("vendor-pdf-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pdfFile()], configurable: true });
    fireEvent.change(input);

    // Busy + Cancel visible.
    await waitFor(() => expect(scoped.getByTestId("vendor-pdf-cancel")).toBeTruthy());
    expect(busy).toContain(true);

    fireEvent.click(scoped.getByTestId("vendor-pdf-cancel"));

    await waitFor(() => expect(scoped.getByTestId("vendor-pdf-cancelled")).toBeTruthy());
    expect(busy[busy.length - 1]).toBe(false); // busy cleared → Generate Report re-enabled
    expect(ingested.flat().length).toBe(0);    // nothing imported from a cancel
    // The attach button is interactive again (not busy).
    expect((scoped.getByTestId("vendor-pdf-select") as HTMLButtonElement).disabled).toBe(false);
  });
});
