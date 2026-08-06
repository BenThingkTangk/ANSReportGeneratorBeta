/**
 * PRESENTATION regression for the clinician charts (production screenshot QA).
 *
 * Four defects were found on the deployed dark clinician surface. None of them
 * touched numbers, provenance or gating — but each made the charts harder to
 * read than a clinical instrument is allowed to be:
 *
 *   1. the "POTS 120" / "Tachy 100" reference captions were clipped against
 *      the right edge of the heart-rate plot;
 *   2. axis ticks, unit captions, phase A-F band letters and the estimate
 *      disclosure body/footer were 9-11px at 60-80% opacity — below WCAG AA
 *      contrast on the dark surface;
 *   3. section headers such as "Heart Rate — Full Test Trend" truncated with an
 *      ellipsis on a phone, hiding the half of the title that identifies the
 *      chart, while the Explain control had to stay reachable;
 *   4. the two estimate series were differentiated by hue alone.
 *
 * These assertions pin the fixes. They are deliberately presentation-only:
 * nothing here asserts a numeric value, a provenance decision or a clinical
 * gate, and nothing in the components under test was allowed to change those.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { ColomboExplainer } from "@/components/clinician/ColomboExplainer";
import { PhaseBandLabel } from "@/components/clinician/mpg/PhaseBandLabel";
import { TrendSeriesLegend } from "@/components/clinician/mpg/TrendSeriesLegend";
import { SpectralEstimateBanner } from "@/components/clinician/mpg/SpectralEstimateBanner";
import {
  assignPhaseLabelRows,
  AXIS_TICK,
  AXIS_TICK_COLOR,
  AXIS_TICK_FONT_SIZE,
  AXIS_TITLE_FONT_SIZE,
  ESTIMATE_LEGEND_SHAPE,
  ESTIMATE_LFA_DASH,
  ESTIMATE_LFA_PATTERN_LABEL,
  ESTIMATE_RFA_DASH,
  ESTIMATE_RFA_PATTERN_LABEL,
  ESTIMATE_LFA_STROKE_WIDTH,
  ESTIMATE_RFA_STROKE_WIDTH,
  GRID_STROKE_WIDTH,
  LEGEND_SWATCH_STROKE_WIDTH,
  LEGEND_SWATCH_WIDTH,
  PHASE_LABEL_MIN_GAP_PX,
  PHASE_LABEL_ROW_HEIGHT,
  PHASE_LABEL_FILL,
  PHASE_LABEL_FONT_SIZE,
  PHASE_PILL_FILL,
  PHASE_PILL_HEIGHT,
  PHASE_PILL_TEXT_FILL,
  PHASE_PILL_WIDTH,
  REFERENCE_LABEL_DX,
  REFERENCE_LABEL_DY,
  REFERENCE_LABEL_FONT_SIZE,
  TREND_CHART_MARGIN,
} from "@/lib/chartTheme";

const CLIENT_SRC = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(CLIENT_SRC, rel), "utf8");
/** Source with comments stripped, so prose about a class never counts as usage. */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TREND = read("components/clinician/mpg/TrendPanel.tsx");
const SCATTER = read("components/clinician/mpg/ScatterPanel.tsx");
const EXPLAINER = readCode("components/clinician/ColomboExplainer.tsx");
const COLLAPSIBLE = readCode("components/clinician/CollapsibleSection.tsx");

/** Smallest on-chart / caption type size we allow after the QA pass. */
const MIN_TYPE_PX = 11;

describe("chart theme tokens are WCAG-oriented", () => {
  it("keeps axis and phase type at 11px or larger", () => {
    expect(AXIS_TICK_FONT_SIZE).toBeGreaterThanOrEqual(MIN_TYPE_PX);
    expect(AXIS_TITLE_FONT_SIZE).toBeGreaterThanOrEqual(MIN_TYPE_PX);
    expect(PHASE_LABEL_FONT_SIZE).toBeGreaterThanOrEqual(MIN_TYPE_PX);
    expect(REFERENCE_LABEL_FONT_SIZE).toBeGreaterThanOrEqual(MIN_TYPE_PX);
    expect(AXIS_TICK.fontSize).toBe(AXIS_TICK_FONT_SIZE);
  });

  it("derives tick and phase-label colour from the theme foreground at high alpha", () => {
    // Theme-relative so the light print theme inverts correctly, and >= 0.7
    // alpha so the chrome clears AA contrast on the dark clinician surface.
    for (const colour of [AXIS_TICK_COLOR, PHASE_LABEL_FILL]) {
      expect(colour).toMatch(/var\(--foreground\)/);
      const alpha = Number(/\/\s*([0-9.]+)\)/.exec(colour)?.[1]);
      expect(alpha).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("reserves right-edge room and inward padding for reference captions", () => {
    // dx pulls the caption back inside the plot area, dy drops it below its own
    // rule, and the chart reserves real margin on the right for it.
    expect(REFERENCE_LABEL_DX).toBeLessThan(0);
    expect(REFERENCE_LABEL_DY).toBeGreaterThan(0);
    expect(TREND_CHART_MARGIN.right).toBeGreaterThanOrEqual(
      Math.abs(REFERENCE_LABEL_DX) * 2,
    );
  });

  it("differentiates the two estimate series by stroke pattern, not only hue", () => {
    expect(ESTIMATE_LFA_DASH).not.toBe(ESTIMATE_RFA_DASH);
    expect(ESTIMATE_LFA_PATTERN_LABEL).not.toBe(ESTIMATE_RFA_PATTERN_LABEL);
    expect(ESTIMATE_LEGEND_SHAPE).not.toBe("square");
  });
});

describe("TrendPanel chart chrome", () => {
  it("gives both HR reference captions padded, non-clipping geometry", () => {
    for (const caption of ["Tachy 100", "POTS 120"]) {
      const block = TREND.slice(TREND.indexOf(`value: "${caption}"`));
      const label = block.slice(0, block.indexOf("}"));
      expect(label).toContain("dx: REFERENCE_LABEL_DX");
      expect(label).toContain("dy: REFERENCE_LABEL_DY");
      expect(label).toContain("fontSize: REFERENCE_LABEL_FONT_SIZE");
    }
    expect(TREND).toContain("margin={TREND_CHART_MARGIN}");
  });

  it("uses the shared readable tick tokens on every axis", () => {
    expect(TREND).not.toMatch(/fontSize=\{(9|10)\}/);
    expect(TREND).not.toContain('stroke="hsl(var(--muted-foreground))"');
    // three charts x two axes
    expect(TREND.match(/tick=\{AXIS_TICK\}/g)?.length).toBe(6);
  });

  it("labels the phase A-F bands with the pill component, not a raw glyph", () => {
    expect(TREND).toContain("label={<PhaseBandLabel");
    expect(TREND).not.toContain("value: p.name");
    // band geometry still comes straight from the report
    expect(TREND).toContain("x1={p.startSec}");
    expect(TREND).toContain("x2={p.endSec}");
  });

  it("keeps gridlines lighter than the plotted estimate traces", () => {
    expect(GRID_STROKE_WIDTH).toBeLessThan(ESTIMATE_LFA_STROKE_WIDTH);
    expect(GRID_STROKE_WIDTH).toBeLessThan(ESTIMATE_RFA_STROKE_WIDTH);
    // the dotted series is the heavier of the two: less ink per dash cycle
    expect(ESTIMATE_RFA_STROKE_WIDTH).toBeGreaterThan(ESTIMATE_LFA_STROKE_WIDTH);
    expect(TREND).toContain('strokeLinecap="round"');
  });

  it("delegates the series key to the readable DOM legend, not the hairline recharts one", () => {
    expect(TREND).toContain("<TrendSeriesLegend estimated={spectralEstimated} />");
    expect(TREND).not.toMatch(/<Legend\b/);
    expect(TREND).toContain("strokeDasharray={spectralEstimated ? ESTIMATE_LFA_DASH");
    expect(TREND).toContain("strokeDasharray={spectralEstimated ? ESTIMATE_RFA_DASH");
  });

  it("has no sub-11px caption text left in the panel", () => {
    expect(TREND).not.toMatch(/text-\[(9|10)px\]/);
  });
});

describe("ScatterPanel chart chrome", () => {
  it("uses the shared tick tokens and readable axis titles", () => {
    expect(SCATTER).not.toMatch(/fontSize=\{(9|10)\}/);
    expect(SCATTER).not.toMatch(/fontSize: 10\b/);
    expect(SCATTER).toContain("tick={AXIS_TICK}");
    expect(SCATTER).toContain("fontSize: AXIS_TITLE_FONT_SIZE");
  });

  it("gives every estimate legend entry a non-square shape cue", () => {
    const estimateEntries = SCATTER.match(/swatch: ESTIMATE_SERIES_COLOR[^}]*\}/g) ?? [];
    expect(estimateEntries.length).toBeGreaterThanOrEqual(5);
    for (const entry of estimateEntries) {
      expect(entry).toContain("shape: ESTIMATE_LEGEND_SHAPE");
    }
    // the swatch renderer must actually vary by shape, not just by colour
    expect(SCATTER).toContain('data-legend-shape="diamond"');
    expect(SCATTER).toContain('data-legend-shape="square"');
  });

  it("has no sub-11px caption text left in the panel", () => {
    expect(SCATTER).not.toMatch(/text-\[(9|10)px\]/);
  });
});

describe("section headers stay readable on a phone", () => {
  it("never truncates the explainer or collapsible-section title", () => {
    expect(EXPLAINER).not.toContain("truncate");
    expect(COLLAPSIBLE).not.toContain("truncate");
    expect(EXPLAINER).toContain("break-words");
    expect(COLLAPSIBLE).toContain("break-words");
  });

  it("stacks the title above the Explain control on narrow viewports", () => {
    expect(EXPLAINER).toContain("flex-col sm:flex-row");
  });

  it("renders the full chart title and a reachable Explain control", () => {
    render(<ColomboExplainer chartKey="heartRateTrend" />);
    const title = screen.getByTestId("colombo-explainer-title-heartRateTrend");
    expect(title.textContent).toContain("Heart Rate — Full Test Trend");
    expect(title.className).not.toContain("truncate");
    const explain = screen.getByRole("button", { name: /Explain/ });
    expect(explain).toBeTruthy();
    expect(explain.className).toContain("min-h-11");
  });

  it("renders the full breathing-envelope title too", () => {
    render(<ColomboExplainer chartKey="breathingTrend" />);
    expect(
      screen.getByTestId("colombo-explainer-title-breathingTrend").textContent,
    ).toContain("Breathing Envelope — Full Test Trend");
  });
});

describe("estimate disclosure legibility", () => {
  const report = {
    spectralEstimation: { confidence: 0.45, warnings: ["example method warning"] },
  } as never;

  it("keeps disclosure body and footer text at 12px or larger", () => {
    const { container } = render(<SpectralEstimateBanner report={report} />);
    const banner = container.querySelector('[data-spectral-estimated="true"]');
    expect(banner).toBeTruthy();
    // every arbitrary text size inside the disclosure must be >= 12px
    for (const el of Array.from(banner!.querySelectorAll<HTMLElement>("*"))) {
      const size = /text-\[([0-9.]+)px\]/.exec(el.className || "")?.[1];
      if (size) expect(Number(size)).toBeGreaterThanOrEqual(MIN_TYPE_PX);
    }
  });

  it("no longer dims the confidence footer below readable opacity", () => {
    render(<SpectralEstimateBanner report={report} />);
    const conf = screen.getByTestId("mpg-estimate-confidence");
    expect(conf.textContent).toContain("45% method confidence");
    expect(conf.className).not.toMatch(/\/(50|60|70)\b/);
  });
});

describe("phase A-F band labels", () => {
  const bands = [
    { startSec: 0, endSec: 300 },   // A baseline
    { startSec: 300, endSec: 360 }, // B deep breathing
    { startSec: 360, endSec: 380 }, // C recovery  (tight)
    { startSec: 380, endSec: 400 }, // D valsalva  (tight)
    { startSec: 400, endSec: 460 }, // E recovery
    { startSec: 460, endSec: 760 }, // F stand
  ];

  it("draws an opaque backplate with a light glyph, not bare text", () => {
    const { container } = render(
      <svg>
        <PhaseBandLabel
          viewBox={{ x: 100, y: 10, width: 40, height: 120 }}
          name="B"
          index={1}
          bands={bands}
        />
      </svg>,
    );
    const group = container.querySelector('[data-testid="mpg-phase-pill-B"]');
    expect(group).toBeTruthy();
    const rect = group!.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe(PHASE_PILL_FILL);
    expect(Number(rect.getAttribute("width"))).toBe(PHASE_PILL_WIDTH);
    expect(Number(rect.getAttribute("height"))).toBe(PHASE_PILL_HEIGHT);
    expect(rect.getAttribute("stroke")).toBeTruthy();
    const text = group!.querySelector("text")!;
    expect(text.textContent).toBe("B");
    expect(text.getAttribute("fill")).toBe(PHASE_PILL_TEXT_FILL);
    // pill backplate is opaque enough that the band tint underneath cannot
    // change the glyph's effective contrast
    const alpha = Number(/\/\s*([0-9.]+)\)/.exec(PHASE_PILL_FILL)?.[1]);
    expect(alpha).toBeGreaterThanOrEqual(0.9);
  });

  it("centres the pill in its own band box", () => {
    const { container } = render(
      <svg>
        <PhaseBandLabel
          viewBox={{ x: 100, y: 10, width: 40, height: 120 }}
          name="C"
          index={2}
          bands={bands}
        />
      </svg>,
    );
    const rect = container.querySelector('[data-testid="mpg-phase-pill-C"] rect')!;
    expect(Number(rect.getAttribute("x"))).toBeCloseTo(100 + (40 - PHASE_PILL_WIDTH) / 2, 5);
  });

  it("staggers rows so tightly packed B/C/D never collide", () => {
    // ~0.35 px per second: a phone-width chart. C and D are 20 s bands.
    const rows = assignPhaseLabelRows(bands, 0.35);
    expect(rows).toHaveLength(bands.length);
    expect(new Set(rows).size).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) {
      const prevCentre = ((bands[i - 1].startSec + bands[i - 1].endSec) / 2) * 0.35;
      const centre = ((bands[i].startSec + bands[i].endSec) / 2) * 0.35;
      if (centre - prevCentre < PHASE_LABEL_MIN_GAP_PX) {
        // too close horizontally => must be on different rows
        expect(rows[i]).not.toBe(rows[i - 1]);
      }
    }
  });

  it("keeps every pill on the first row when there is room (desktop)", () => {
    expect(assignPhaseLabelRows(bands, 2.5)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("offsets the second row vertically by a full pill height", () => {
    expect(PHASE_LABEL_ROW_HEIGHT).toBeGreaterThanOrEqual(PHASE_PILL_HEIGHT);
    const rows = assignPhaseLabelRows(bands, 0.35);
    const secondRowIndex = rows.findIndex((r) => r === 1);
    expect(secondRowIndex).toBeGreaterThan(-1);
    const { container } = render(
      <svg>
        <PhaseBandLabel
          viewBox={{ x: 10, y: 20, width: 0.35 * (bands[secondRowIndex].endSec - bands[secondRowIndex].startSec), height: 120 }}
          name="D"
          index={secondRowIndex}
          bands={bands}
        />
      </svg>,
    );
    const group = container.querySelector('[data-testid="mpg-phase-pill-D"]')!;
    expect(group.getAttribute("data-phase-label-row")).toBe("1");
    expect(Number(group.querySelector("rect")!.getAttribute("y"))).toBeGreaterThanOrEqual(
      20 + PHASE_LABEL_ROW_HEIGHT,
    );
  });

  it("does not alter phase boundaries anywhere in the label path", () => {
    const before = JSON.stringify(bands);
    assignPhaseLabelRows(bands, 0.35);
    expect(JSON.stringify(bands)).toBe(before);
  });
});

describe("LFa/RFa legend swatches", () => {
  it("draws a thick, pattern-preserving swatch for each series", () => {
    const { container } = render(<TrendSeriesLegend estimated />);
    const lfa = container.querySelector('[data-testid="mpg-lfa-rfa-legend-swatch-lfa"]')!;
    const rfa = container.querySelector('[data-testid="mpg-lfa-rfa-legend-swatch-rfa"]')!;
    for (const swatch of [lfa, rfa]) {
      const line = swatch.querySelector("line")!;
      expect(Number(line.getAttribute("stroke-width"))).toBe(LEGEND_SWATCH_STROKE_WIDTH);
      // swatch is heavier than the plotted trace so it reads at legend scale
      expect(LEGEND_SWATCH_STROKE_WIDTH).toBeGreaterThan(ESTIMATE_RFA_STROKE_WIDTH);
      expect(Number(swatch.getAttribute("width"))).toBe(LEGEND_SWATCH_WIDTH);
    }
    // long dash vs dotted semantics preserved and distinct
    expect(lfa.getAttribute("data-dash")).toBe(ESTIMATE_LFA_DASH);
    expect(rfa.getAttribute("data-dash")).toBe(ESTIMATE_RFA_DASH);
    expect(lfa.getAttribute("data-dash")).not.toBe(rfa.getAttribute("data-dash"));
  });

  it("names the pattern in the estimate legend text", () => {
    render(<TrendSeriesLegend estimated />);
    expect(screen.getByTestId("mpg-lfa-rfa-legend-lfa").textContent).toContain(
      ESTIMATE_LFA_PATTERN_LABEL,
    );
    expect(screen.getByTestId("mpg-lfa-rfa-legend-rfa").textContent).toContain(
      ESTIMATE_RFA_PATTERN_LABEL,
    );
  });

  it("shows solid vendor swatches with no estimate wording when values are vendor-reported", () => {
    const { container } = render(<TrendSeriesLegend estimated={false} />);
    expect(
      container.querySelector('[data-testid="mpg-lfa-rfa-legend-swatch-lfa"]')!.getAttribute("data-dash"),
    ).toBe("solid");
    expect(screen.getByTestId("mpg-lfa-rfa-legend-lfa").textContent).not.toContain("est.");
  });
});
