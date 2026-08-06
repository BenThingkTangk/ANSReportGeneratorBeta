import {
  PHASE_LABEL_FONT_SIZE,
  PHASE_LABEL_FONT_WEIGHT,
  PHASE_LABEL_ROW_HEIGHT,
  PHASE_PILL_FILL,
  PHASE_PILL_HEIGHT,
  PHASE_PILL_RADIUS,
  PHASE_PILL_STROKE,
  PHASE_PILL_STROKE_WIDTH,
  PHASE_PILL_TEXT_FILL,
  PHASE_PILL_TOP_INSET,
  PHASE_PILL_WIDTH,
  assignPhaseLabelRows,
} from "@/lib/chartTheme";

/**
 * Phase A–F band label, drawn as a compact pill instead of a bare glyph.
 *
 * WHY A PILL: the six bands carry six different tints (emerald B, slate C,
 * amber D, pink F …). A single translucent letter therefore had a *different*
 * contrast ratio on every band, and mobile screenshot QA flagged B/C/D as
 * unreadable. Drawing the letter on its own opaque dark backplate makes its
 * contrast a property of the pill, constant across every shaded region and
 * independent of the band fill underneath.
 *
 * WHY STAGGERED ROWS: on a phone the B/C/D bands are only tens of pixels wide,
 * so their pills collided. `assignPhaseLabelRows` packs them onto two rows by
 * band centre, dropping a pill to the second row whenever it would crowd the
 * previous one. Purely a label-placement decision — the band boundaries
 * (`startSec` / `endSec`) are never touched, and no numeric value, provenance
 * flag or clinical gate is involved.
 *
 * Used as a recharts `<ReferenceArea label={<PhaseBandLabel … />} />`, which
 * injects `viewBox` for the band it belongs to; every other prop is supplied by
 * the caller so the component is deterministic and unit-testable on its own.
 */
export interface PhaseBandLabelProps {
  /** Injected by recharts: pixel box of this band inside the plot area. */
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  /** Band letter (A–F). */
  name: string;
  /** Index of this band within `bands`. */
  index: number;
  /** All bands, in chart order — needed for collision-aware row assignment. */
  bands: { startSec: number; endSec: number }[];
}

export function PhaseBandLabel({ viewBox, name, index, bands }: PhaseBandLabelProps) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const width = viewBox?.width ?? 0;

  const self = bands[index];
  // Derive the chart's pixel scale from this band's own box, so the shared row
  // packing sees real on-screen distances at any container width.
  const selfSec = self ? Math.max(self.endSec - self.startSec, 1e-6) : 0;
  const pxPerSec = self && width > 0 ? width / selfSec : 0;
  const row = pxPerSec > 0 ? (assignPhaseLabelRows(bands, pxPerSec)[index] ?? 0) : 0;

  const pillX = x + Math.max(0, (width - PHASE_PILL_WIDTH) / 2);
  const pillY = y + PHASE_PILL_TOP_INSET + row * PHASE_LABEL_ROW_HEIGHT;

  return (
    <g
      data-testid={`mpg-phase-pill-${name}`}
      data-phase-label-row={row}
      pointerEvents="none"
    >
      <rect
        x={pillX}
        y={pillY}
        width={PHASE_PILL_WIDTH}
        height={PHASE_PILL_HEIGHT}
        rx={PHASE_PILL_RADIUS}
        ry={PHASE_PILL_RADIUS}
        fill={PHASE_PILL_FILL}
        stroke={PHASE_PILL_STROKE}
        strokeWidth={PHASE_PILL_STROKE_WIDTH}
      />
      <text
        x={pillX + PHASE_PILL_WIDTH / 2}
        y={pillY + PHASE_PILL_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={PHASE_PILL_TEXT_FILL}
        fontSize={PHASE_LABEL_FONT_SIZE}
        fontWeight={PHASE_LABEL_FONT_WEIGHT}
      >
        {name}
      </text>
    </g>
  );
}
