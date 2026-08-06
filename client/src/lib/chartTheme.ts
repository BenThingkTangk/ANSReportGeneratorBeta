/**
 * Shared presentation tokens for the clinician charts.
 *
 * PRESENTATION ONLY. Nothing in this file participates in parsing, spectral
 * computation, provenance decisions, scoring, clinical gating or any numeric
 * output — it exists so axis ticks, unit captions, phase labels and estimate
 * disclosures are legible (WCAG AA at chart scale) and so estimate series stay
 * distinguishable for a colour-blind reader.
 *
 * Colours are expressed against the theme's `--foreground` variable so they
 * invert correctly between the dark clinician surface and the light print
 * theme, instead of hard-coding a grey that only works on one background.
 *
 * Contrast reference (dark clinician surface, --card 222 47% 11%):
 *   foreground @ 78% ≈ 9:1   (axis ticks, unit captions)
 *   foreground @ 88% ≈ 12:1  (phase A–F band labels)
 * Both clear the 4.5:1 AA threshold for small text with headroom, so the
 * chart chrome no longer disappears into the background.
 */

/** Tick label colour — legible on both themes. */
export const AXIS_TICK_COLOR = "hsl(var(--foreground) / 0.78)";

/** Axis rule / domain line. Deliberately dimmer than the tick text. */
export const AXIS_LINE_COLOR = "hsl(var(--foreground) / 0.35)";

/**
 * Minimum on-chart type size. 12px is the smallest size we allow for axis
 * ticks and axis titles; the previous 9–10px chrome was the main readability
 * complaint from screenshot QA.
 */
export const AXIS_TICK_FONT_SIZE = 12;
export const AXIS_TITLE_FONT_SIZE = 12;

/** Ready-made `tick` prop for recharts axes. */
export const AXIS_TICK = {
  fill: AXIS_TICK_COLOR,
  fontSize: AXIS_TICK_FONT_SIZE,
} as const;

/** Ready-made axis-title style for recharts `label={{ ... }}`. */
export const AXIS_TITLE = {
  fill: AXIS_TICK_COLOR,
  fontSize: AXIS_TITLE_FONT_SIZE,
} as const;

/** Distance between the axis rule and its tick labels. */
export const AXIS_TICK_MARGIN = 8;

/** Phase A–F band labels drawn inside the plot area. */
export const PHASE_LABEL_FILL = "hsl(var(--foreground) / 0.88)";
export const PHASE_LABEL_FONT_SIZE = 12;
export const PHASE_LABEL_FONT_WEIGHT = 700;
/** Nudges the band letter clear of the top gridline. */
export const PHASE_LABEL_DY = 4;

/**
 * Phase-letter PILL geometry and colours.
 *
 * Mobile screenshot QA found the bare A–F letters unreliable: each band has a
 * different tint (emerald B, slate C, amber D …), and over the brighter fills
 * a single translucent glyph loses contrast. The letter is therefore drawn on
 * its own opaque dark backplate with a light glyph, so its contrast is a
 * constant of the pill — independent of whatever the band underneath is tinted.
 * Nothing about the band geometry (start/end seconds) changes.
 */
export const PHASE_PILL_FILL = "hsl(222 60% 6% / 0.94)";
export const PHASE_PILL_STROKE = "hsl(var(--foreground) / 0.45)";
export const PHASE_PILL_STROKE_WIDTH = 1;
export const PHASE_PILL_TEXT_FILL = "hsl(0 0% 100%)";
export const PHASE_PILL_WIDTH = 19;
export const PHASE_PILL_HEIGHT = 17;
export const PHASE_PILL_RADIUS = 5;
/** Distance from the top of the plot area to the first pill row. */
export const PHASE_PILL_TOP_INSET = 3;

/**
 * Collision-aware label stacking.
 *
 * On a phone the B/C/D bands are only a few dozen pixels wide, so their pills
 * would overlap on a single row. Rows alternate instead: a pill drops to the
 * second row whenever its centre would sit closer than `PHASE_LABEL_MIN_GAP_PX`
 * to the last pill already placed on that row. This is a pure layout decision
 * — phase boundaries are never moved.
 */
export const PHASE_LABEL_MIN_GAP_PX = PHASE_PILL_WIDTH + 6;
export const PHASE_LABEL_ROW_HEIGHT = PHASE_PILL_HEIGHT + 3;
export const PHASE_LABEL_MAX_ROWS = 2;

/**
 * Greedy two-row packing of phase pills by band centre.
 *
 * Returns the row index (0-based, < `maxRows`) for each band, in input order.
 * Pure geometry helper so the stagger is unit-testable without a chart.
 */
export function assignPhaseLabelRows(
  bands: { startSec: number; endSec: number }[],
  pxPerSec: number,
  minGapPx: number = PHASE_LABEL_MIN_GAP_PX,
  maxRows: number = PHASE_LABEL_MAX_ROWS,
): number[] {
  const lastCentre: number[] = new Array(Math.max(1, maxRows)).fill(
    Number.NEGATIVE_INFINITY,
  );
  return bands.map((b) => {
    const centre = ((b.startSec + b.endSec) / 2) * pxPerSec;
    let row = 0;
    for (let r = 0; r < lastCentre.length; r++) {
      if (centre - lastCentre[r] >= minGapPx) {
        row = r;
        break;
      }
      // No row has clearance: fall back to the row whose last pill is furthest
      // away, which maximises the remaining separation.
      if (r === lastCentre.length - 1) {
        row = lastCentre.indexOf(Math.min(...lastCentre));
      }
    }
    lastCentre[row] = centre;
    return row;
  });
}

/**
 * Reference-line label geometry.
 *
 * Screenshot QA found the "POTS 120" / "Tachy 100" captions clipped against
 * the right edge of the plot area. The fix is threefold: reserve real margin
 * on the right of the chart, pull the caption inwards by `_DX`, and drop it
 * *below* its own rule by `_DY` so it can never collide with the rule above
 * it, the top gridline, or a phase letter.
 */
export const REFERENCE_LABEL_FONT_SIZE = 11;
export const REFERENCE_LABEL_FONT_WEIGHT = 600;
export const REFERENCE_LABEL_DX = -10;
export const REFERENCE_LABEL_DY = 10;

/** Margin for trend charts that carry right-edge reference captions. */
export const TREND_CHART_MARGIN = { top: 10, right: 34, left: 6, bottom: 6 } as const;

/** Margin for trend charts without reference captions. */
export const TREND_CHART_MARGIN_PLAIN = { top: 10, right: 20, left: 6, bottom: 6 } as const;

/** Axis width — wider than the old 36px so 3-digit ticks are not cropped. */
export const AXIS_Y_WIDTH = 44;

/**
 * Non-colour differentiation for the estimate series.
 *
 * The two estimate traces are intentionally desaturated (no norm semantics),
 * which makes hue alone a weak cue. Each series therefore also gets a distinct
 * stroke pattern and a spelled-out pattern name in the legend, so the chart
 * reads correctly in greyscale print and for colour-vision deficiency.
 */
export const ESTIMATE_LFA_DASH = "8 4";
export const ESTIMATE_RFA_DASH = "2 4";
export const ESTIMATE_LFA_PATTERN_LABEL = "long dash";
export const ESTIMATE_RFA_PATTERN_LABEL = "dotted";
/**
 * Stroke widths raised after mobile QA: the dotted RFa trace sat near zero,
 * right on top of the dashed gridlines, and at 1.8px read as part of the grid.
 * The dotted series is now the THICKER of the two so its lower dash duty cycle
 * still lands more ink on screen than the gridline it crosses.
 */
export const ESTIMATE_LFA_STROKE_WIDTH = 2.4;
export const ESTIMATE_RFA_STROKE_WIDTH = 3;

/** Gridline stroke for trend charts — kept clearly below the series weight. */
export const GRID_STROKE = "hsl(var(--border) / 0.14)";
export const GRID_STROKE_WIDTH = 1;

/** Legend swatch geometry — long enough to show a dash cycle, thick enough to read. */
export const LEGEND_SWATCH_WIDTH = 30;
export const LEGEND_SWATCH_STROKE_WIDTH = 4;

/**
 * Legend swatch shapes, so a legend entry is never colour-only.
 * `diamond` is reserved for HumanOS estimate series, `square` for vendor norm
 * windows and colour-coded clinical zones.
 */
export type LegendSwatchShape = "square" | "diamond" | "long-dash" | "dotted-line";

/** Shape used for every estimate legend entry. */
export const ESTIMATE_LEGEND_SHAPE: LegendSwatchShape = "diamond";

/** Tooltip container style shared by every clinician chart. */
export const TOOLTIP_CONTENT_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
  color: "hsl(var(--foreground))",
} as const;
