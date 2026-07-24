/**
 * Accessibility + QA infrastructure: the .ans upload control and the vendor-PDF
 * control must expose REAL, focusable, labeled file inputs — not display:none
 * (which drops them from the a11y tree and blocks browser automation from
 * attaching a file). This reproduces the live-preview QA gap ("custom upload
 * control exposes no accessible file input").
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UploadScreen } from "../components/UploadScreen";
import { VendorPdfCard } from "../components/parsed/VendorPdfCard";

// framer-motion / three are not used by UploadScreen; no stubs needed.

describe("UploadScreen — accessible .ans file input", () => {
  it("renders a real <input type=file> that is not display:none", () => {
    render(<UploadScreen onUpload={() => {}} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("file");
    // sr-only, NOT hidden: must remain programmatically actionable.
    expect(input.className).not.toMatch(/\bhidden\b/);
    expect(input.className).toMatch(/sr-only/);
  });

  it("accepts .ans (and .txt) via the accept filter", () => {
    render(<UploadScreen onUpload={() => {}} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input.accept).toContain(".ans");
  });

  it("is labeled and associated with the dropzone label", () => {
    render(<UploadScreen onUpload={() => {}} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    expect(input.id).toBe("ans-file-input");
    const dropzone = screen.getByTestId("upload-dropzone");
    expect(dropzone.getAttribute("for")).toBe("ans-file-input");
    // Keyboard-focusable button semantics on the dropzone label.
    expect(dropzone.getAttribute("tabindex")).toBe("0");
    expect(dropzone.getAttribute("role")).toBe("button");
  });

  it("keyboard activation (Enter) on the dropzone opens the picker", () => {
    render(<UploadScreen onUpload={() => {}} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    const dropzone = screen.getByTestId("upload-dropzone");
    fireEvent.keyDown(dropzone, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("selecting a file invokes onUpload with the File (upload flow)", () => {
    const onUpload = vi.fn();
    render(<UploadScreen onUpload={onUpload} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "Pare.ans", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].name).toBe("Pare.ans");
  });
});

describe("VendorPdfCard — accessible vendor-PDF file input", () => {
  it("renders a real focusable PDF input (sr-only, not hidden) with accept=pdf", () => {
    render(<VendorPdfCard />);
    const input = screen.getByTestId("vendor-pdf-input") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toMatch(/pdf/);
    expect(input.className).not.toMatch(/\bhidden\b/);
    expect(input.className).toMatch(/sr-only/);
    expect(input.id).toBe("vendor-pdf-input");
    // The trigger label points at it and is keyboard-focusable.
    const trigger = screen.getByTestId("vendor-pdf-select");
    expect(trigger.getAttribute("for")).toBe("vendor-pdf-input");
    expect(trigger.getAttribute("tabindex")).toBe("0");
  });

  it("keyboard activation (Space) on the trigger opens the PDF picker", () => {
    render(<VendorPdfCard />);
    const input = screen.getByTestId("vendor-pdf-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.keyDown(screen.getByTestId("vendor-pdf-select"), { key: " " });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
