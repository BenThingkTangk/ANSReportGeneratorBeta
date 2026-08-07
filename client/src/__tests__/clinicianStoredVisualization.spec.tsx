/**
 * Phase 3 UI regression: the clinician trend and spectrogram surfaces must show
 * the STORED PhysioPS visualization data when the uploaded `.ans` carries it,
 * label its provenance unambiguously, and degrade to an explicit, honest state
 * when it does not — never to a synthesised substitute image or an unlabelled
 * chart.
 *
 * The panels are rendered directly (no network) against a payload shaped like
 * the real API response, plus a real-file end-to-end case.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const {
        initial, animate, exit, transition, whileHover, whileTap,
        whileInView, viewport, variants, layout, layoutId, drag,
        ...domProps
      } = rest;
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, key: string) => passthrough(key) }),
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => true,
  };
});

import { SpectrogramPanel } from "../components/clinician/mpg/SpectrogramPanel";
import { TrendPanel } from "../components/clinician/mpg/TrendPanel";
import { SeriesProvenanceChip } from "../components/clinician/mpg/SeriesProvenanceChip";
import type { MultiParameterGraphical } from "@shared/schema";
import type { VendorVisualization } from "@shared/vendorVisualization";
import { parseStudy } from "../../../api/_ans/parseStudy.ts";
import { ansStudyToLegacy } from "../../../api/_ans/legacyAdapter.ts";
import { generateColomboReport } from "../../../api/upload.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  __dirname,
  "../../../api/_ans/__tests__/fixtures/jill_deid.ans",
);

afterEach(() => cleanup());

function realReport() {
  const buffer = readFileSync(FIXTURE);
  const study = parseStudy({ buffer, fileName: "jill_deid.ans" });
  return generateColomboReport(ansStudyToLegacy(study, buffer) as never);
}

function syntheticSpectrogram(rows: number, cols: number) {
  const buffer = Buffer.alloc(rows * cols * 4);
  for (let index = 0; index < rows * cols; index += 1) {
    buffer.writeFloatBE((index % 37) + 1, index * 4);
  }
  return buffer.toString("base64");
}

function baseMpg(overrides: Partial<MultiParameterGraphical> = {}): MultiParameterGraphical {
  const rows = 20;
  const cols = 10;
  const visualization: VendorVisualization = {
    source: "ans_stored",
    t0Abs: 0,
    heartRate: { t: [0, 0.25], v: [61, 62], strideFactor: 1, storedSampleCount: 2, unit: "bpm" },
    breathing: { t: [0, 0.25], v: [500, 520], strideFactor: 1, storedSampleCount: 2, unit: "sensor units" },
    trend: {
      dtSec: 4,
      sampleCount: rows,
      clinicalChannelsResolved: true,
      warnings: [],
      channels: [],
      diagnostics: {
        ratioTriples: [],
        percentPairs: [],
        sumTriples: [],
        bpm2FamilyScore: 0.1,
        alternateFamilyScore: 90,
        frfScore: 0.02,
        rawOrientationMargin: 0.9,
        bpm2BandAgreement: { lfa: 0.97, rfa: 0.95 },
      },
    },
    spectrogram: {
      source: "ans_stored",
      wavelet: "Normalized cmorlet",
      rows,
      cols,
      t0Sec: 0,
      dtSec: 4,
      freqStartHz: 0.0033,
      freqStepHz: 0.0066446,
      encoding: "base64_f32be",
      values: syntheticSpectrogram(rows, cols),
      strideFactor: 1,
      transportedRows: rows,
      byteLength: rows * cols * 4,
    },
  };
  return {
    ecgAvailable: true,
    totalSec: rows * 4,
    phases: [
      { name: "A", label: "Baseline", startSec: 0, endSec: 40 },
      { name: "F", label: "Stand", startSec: 40, endSec: 80 },
    ],
    heartRateTrend: { t: [0, 4], v: [61, 62] },
    breathingTrend: { t: [0, 4], v: [500, 520] },
    lfaTrend: { t: [0, 4], v: [1.2, 1.4] },
    rfaTrend: { t: [0, 4], v: [0.3, 0.35] },
    scatter: {
      baselineLFa: 1.2, baselineRFa: 0.3, dbRFa: 5, valsalvaLFa: 8,
      standLFa: 2, standRFa: 0.4, rfaChangeValsalvaPct: -10, rfaChangeStandPct: 12,
    },
    coupling: [],
    wavelet: { type: "Normalized cmorlet", cycles: 0, spectralUpdateSec: 4 },
    seriesProvenance: {
      heartRate: "ans_stored",
      breathing: "ans_stored",
      lfaRfa: "ans_stored",
      spectrogram: "ans_stored",
    },
    vendorVisualization: visualization,
    ...overrides,
  };
}

describe("SeriesProvenanceChip", () => {
  it.each([
    ["ans_stored", "Stored in .ans"],
    ["humanos_estimated", "HumanOS estimate"],
    ["unavailable", "Not in this file"],
    ["malformed", "Stored but unreadable"],
  ] as const)("renders a distinct label for %s", (provenance, label) => {
    render(<SeriesProvenanceChip provenance={provenance} testId="chip" />);
    expect(screen.getByTestId("chip").textContent).toContain(label);
    expect(screen.getByTestId("chip").getAttribute("data-provenance")).toBe(provenance);
  });
});

describe("SpectrogramPanel", () => {
  it("draws the stored matrix and reports its stored geometry", () => {
    const mpg = baseMpg();
    render(<SpectrogramPanel mpg={mpg} />);
    const panel = screen.getByTestId("mpg-spectrogram-panel");
    expect(panel.getAttribute("data-provenance")).toBe("ans_stored");
    expect(panel.getAttribute("data-rows")).toBe("20");
    expect(panel.getAttribute("data-cols")).toBe("10");
    expect(screen.getByTestId("mpg-spectrogram-provenance").textContent).toContain("Stored in .ans");
    expect(screen.getByTestId("mpg-spectrogram-canvas")).toBeTruthy();
    expect(panel.textContent).toContain("Normalized cmorlet");
  });

  it("reports the stored value under the cursor", () => {
    render(<SpectrogramPanel mpg={baseMpg()} />);
    const canvas = screen.getByTestId("mpg-spectrogram-canvas");
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseMove(canvas, { clientX: 10, clientY: 50 });
    expect(screen.getByTestId("mpg-spectrogram-readout").textContent).toMatch(/Hz/);
  });

  it("states plainly when no stored spectrogram exists instead of drawing one", () => {
    const mpg = baseMpg({
      vendorVisualization: null,
      seriesProvenance: {
        heartRate: "humanos_estimated",
        breathing: "humanos_estimated",
        lfaRfa: "humanos_estimated",
        spectrogram: "unavailable",
      },
    });
    render(<SpectrogramPanel mpg={mpg} />);
    expect(screen.queryByTestId("mpg-spectrogram-canvas")).toBeNull();
    const message = screen.getByTestId("mpg-spectrogram-unavailable").textContent ?? "";
    expect(message).toMatch(/does not carry/i);
    expect(message).toMatch(/does not synthesise a substitute/i);
  });

  it("distinguishes a malformed stored spectrogram from an absent one", () => {
    const mpg = baseMpg();
    mpg.vendorVisualization!.spectrogram = {
      ...mpg.vendorVisualization!.spectrogram!,
      source: "malformed",
      reason: "declared 20x10 but carried 0 values",
      values: "",
    };
    mpg.seriesProvenance!.spectrogram = "malformed";
    render(<SpectrogramPanel mpg={mpg} />);
    expect(screen.queryByTestId("mpg-spectrogram-canvas")).toBeNull();
    const message = screen.getByTestId("mpg-spectrogram-unavailable").textContent ?? "";
    expect(message).toMatch(/did not decode/i);
    expect(message).toContain("declared 20x10");
  });
});

describe("TrendPanel provenance", () => {
  it("labels stored heart-rate, breathing and LFa/RFa series", () => {
    render(<TrendPanel mpg={baseMpg()} spectralAvailable spectralEstimated={false} />);
    expect(screen.getByTestId("mpg-hr-provenance").textContent).toContain("Stored in .ans");
    expect(screen.getByTestId("mpg-breathing-provenance").textContent).toContain("Stored in .ans");
    expect(screen.getAllByTestId("mpg-lfa-rfa-provenance")[0].textContent).toContain("Stored in .ans");
    expect(screen.getByTestId("mpg-lfa-rfa-stored-note").textContent).toMatch(
      /verified against the file's stored per-phase summary/i,
    );
  });

  it("keeps the estimate labelling when nothing was stored", () => {
    const mpg = baseMpg({
      vendorVisualization: null,
      seriesProvenance: {
        heartRate: "humanos_estimated",
        breathing: "humanos_estimated",
        lfaRfa: "humanos_estimated",
        spectrogram: "unavailable",
      },
    });
    render(<TrendPanel mpg={mpg} spectralAvailable={false} spectralEstimated />);
    expect(screen.getByTestId("mpg-hr-provenance").textContent).toContain("HumanOS estimate");
    expect(screen.queryByTestId("mpg-lfa-rfa-stored-note")).toBeNull();
    expect(screen.getByTestId("mpg-lfa-rfa-estimated-note")).toBeTruthy();
  });
});

describe("real .ans upload path", () => {
  it("publishes stored provenance and a decodable spectrogram", () => {
    const report = realReport() as unknown as { multiParameter: MultiParameterGraphical };
    const mpg = report.multiParameter;
    expect(mpg.seriesProvenance).toEqual({
      heartRate: "ans_stored",
      breathing: "ans_stored",
      lfaRfa: "ans_stored",
      spectrogram: "ans_stored",
    });
    expect(mpg.vendorVisualization?.trend.clinicalChannelsResolved).toBe(true);
    expect(mpg.lfaTrend.v.length).toBeGreaterThan(100);
    expect(mpg.lfaTrend.v.length).toBe(mpg.rfaTrend.v.length);

    render(<SpectrogramPanel mpg={mpg} />);
    expect(screen.getByTestId("mpg-spectrogram-canvas")).toBeTruthy();
    expect(screen.getByTestId("mpg-spectrogram-provenance").textContent).toContain("Stored in .ans");
  });
});
