import {
  ESTIMATE_LFA_DASH,
  ESTIMATE_LFA_PATTERN_LABEL,
  ESTIMATE_LFA_STROKE_WIDTH,
  ESTIMATE_RFA_DASH,
  ESTIMATE_RFA_PATTERN_LABEL,
  ESTIMATE_RFA_STROKE_WIDTH,
  LEGEND_SWATCH_STROKE_WIDTH,
  LEGEND_SWATCH_WIDTH,
} from "@/lib/chartTheme";
import { ESTIMATE_LFA_COLOR, ESTIMATE_RFA_COLOR } from "@/lib/spectralProvenance";

/**
 * Legend for the rolling LFa/RFa trend, rendered as real DOM below the chart
 * instead of through recharts' built-in `<Legend>`.
 *
 * WHY: the recharts legend drew a hairline swatch at the series' own stroke
 * width, which mobile QA found too thin and too low-contrast to read — and its
 * geometry could not be controlled independently of the plotted line. Rendering
 * the legend ourselves lets the swatch be thicker than the trace while keeping
 * the *pattern* identical (long dash = LFa, dotted = RFa), so the swatch remains
 * an honest key for the chart.
 *
 * PROVENANCE: the estimate palette stays outside the clinical red/green/amber
 * vocabulary and no norm/normal-abnormal semantics are attached. The pattern
 * name is spelled out so the two series are separable without colour.
 */
export function TrendSeriesLegend({ estimated }: { estimated: boolean }) {
  const series = [
    {
      key: "lfa",
      label: "LFa — Sympathetic",
      colour: estimated ? ESTIMATE_LFA_COLOR : "hsl(0 72% 51%)",
      dash: estimated ? ESTIMATE_LFA_DASH : undefined,
      pattern: estimated ? ESTIMATE_LFA_PATTERN_LABEL : null,
      traceWidth: estimated ? ESTIMATE_LFA_STROKE_WIDTH : 1.6,
    },
    {
      key: "rfa",
      label: "RFa — Parasympathetic",
      colour: estimated ? ESTIMATE_RFA_COLOR : "hsl(217 91% 55%)",
      dash: estimated ? ESTIMATE_RFA_DASH : undefined,
      pattern: estimated ? ESTIMATE_RFA_PATTERN_LABEL : null,
      traceWidth: estimated ? ESTIMATE_RFA_STROKE_WIDTH : 1.6,
    },
  ];

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5"
      data-testid="mpg-lfa-rfa-legend"
      data-spectral-estimated={estimated ? "true" : "false"}
    >
      {series.map((s) => (
        <div
          key={s.key}
          className="flex items-center gap-2 text-[13px] font-medium text-foreground/95"
          data-testid={`mpg-lfa-rfa-legend-${s.key}`}
        >
          <svg
            width={LEGEND_SWATCH_WIDTH}
            height={LEGEND_SWATCH_STROKE_WIDTH + 2}
            viewBox={`0 0 ${LEGEND_SWATCH_WIDTH} ${LEGEND_SWATCH_STROKE_WIDTH + 2}`}
            aria-hidden="true"
            className="shrink-0"
            data-testid={`mpg-lfa-rfa-legend-swatch-${s.key}`}
            data-stroke-width={LEGEND_SWATCH_STROKE_WIDTH}
            data-dash={s.dash ?? "solid"}
          >
            <line
              x1={0}
              y1={(LEGEND_SWATCH_STROKE_WIDTH + 2) / 2}
              x2={LEGEND_SWATCH_WIDTH}
              y2={(LEGEND_SWATCH_STROKE_WIDTH + 2) / 2}
              stroke={s.colour}
              strokeWidth={LEGEND_SWATCH_STROKE_WIDTH}
              strokeDasharray={s.dash}
              strokeLinecap="round"
            />
          </svg>
          <span>
            {s.label}
            {s.pattern ? ` (est. · ${s.pattern})` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
