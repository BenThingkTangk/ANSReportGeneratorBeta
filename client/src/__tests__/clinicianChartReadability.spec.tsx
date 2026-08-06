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
import { SpectralEstimateBanner } from "@/components/clinician/mpg/SpectralEstimateBanner";
import {
  AXIS_TICK,
  AXIS_TICK_COLOR,
  AXIS_TICK_FONT_SIZE,
  AXIS_TITLE_FONT_SIZE,
  ESTIMATE_LEGEND_SHAPE,
  ESTIMATE_LFA_DASH,
  ESTIMATE_LFA_PATTERN_LABEL,
  ESTIMATE_RFA_DASH,
  ESTIMATE_RFA_PATTERN_LABEL,
  PHASE_LABEL_FILL,
  PHASE_LABEL_FONT_SIZE,
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

  it("labels the phase A-F bands with the high-contrast fill", () => {
    expect(TREND).toContain("fill: PHASE_LABEL_FILL");
    expect(TREND).toContain("fontSize: PHASE_LABEL_FONT_SIZE");
  });

  it("names the stroke pattern in the estimate legend", () => {
    expect(TREND).toContain("ESTIMATE_LFA_PATTERN_LABEL");
    expect(TREND).toContain("ESTIMATE_RFA_PATTERN_LABEL");
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
