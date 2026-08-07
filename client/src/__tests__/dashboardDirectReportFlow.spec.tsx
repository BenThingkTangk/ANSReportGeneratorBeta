import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const uploadMock = vi.fn();

vi.mock("@/lib/resilientUpload", () => ({
  resilientUpload: (...args: unknown[]) => uploadMock(...args),
}));

vi.mock("@/components/UploadScreen", () => ({
  UploadScreen: ({ onUpload }: { onUpload: (file: File) => void }) => (
    <input
      data-testid="ans-upload"
      type="file"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) onUpload(file);
      }}
    />
  ),
}));

vi.mock("@/components/AnalyzingScreen", () => ({
  AnalyzingScreen: ({ stage }: { stage: string }) => (
    <div data-testid="analyzing-screen">{stage}</div>
  ),
}));

vi.mock("@/components/parsed/ParsedDataReview", () => ({
  ParsedDataReview: () => <div data-testid="parsed-review">Quick Load</div>,
}));

vi.mock("@/components/ReportDashboard", () => ({
  ReportDashboard: () => (
    <div data-testid="report-dashboard">
      Patient
      <button type="button">Clinician</button>
    </div>
  ),
}));

vi.mock("@/components/AtomAttribution", () => ({
  AtomAttribution: () => null,
}));

describe("Dashboard direct .ans report journey", () => {
  afterEach(() => {
    cleanup();
    uploadMock.mockReset();
  });

  it("uploads once to the full report endpoint and bypasses Quick Load", async () => {
    uploadMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        success: true,
        report: { generatedAt: "2026-08-07T00:00:00.000Z" },
        ansStudy: { schemaVersion: "1" },
      },
      vercelId: null,
      attempts: [{ attempt: 1 }],
      totalMs: 20,
    });

    const { default: Dashboard } = await import("../pages/dashboard");
    render(<Dashboard />);

    const file = new File([new Uint8Array([1, 2, 3])], "patient.ans", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByTestId("ans-upload"), {
      target: { files: [file] },
    });

    expect(screen.getByTestId("analyzing-screen")).toBeTruthy();
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock).toHaveBeenCalledWith(
      "/api/upload",
      file,
      expect.objectContaining({ timeoutMs: 90_000 }),
    );

    await waitFor(
      () => expect(screen.getByTestId("report-dashboard")).toBeTruthy(),
      { timeout: 2_000 },
    );
    expect(screen.getByText("Patient")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clinician" })).toBeTruthy();
    expect(screen.queryByTestId("parsed-review")).toBeNull();
    expect(
      uploadMock.mock.calls.some(([endpoint]) => endpoint === "/api/parse"),
    ).toBe(false);
  });
});
