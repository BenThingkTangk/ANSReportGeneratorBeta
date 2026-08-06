import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  Legend,
} from "recharts";
import type { ANSReport, MultiParameterGraphical, TimeSeries } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";
import { SpectralUnavailableCard } from "./SpectralUnavailableCard";
import { SpectralEstimateBanner } from "./SpectralEstimateBanner";
import {
  ESTIMATE_BADGE,
  ESTIMATE_LFA_COLOR,
  ESTIMATE_RFA_COLOR,
  ESTIMATE_TITLE,
} from "@/lib/spectralProvenance";
import {
  AXIS_LINE_COLOR,
  AXIS_TICK,
  AXIS_TICK_FONT_SIZE,
  AXIS_TICK_MARGIN,
  AXIS_Y_WIDTH,
  ESTIMATE_LFA_DASH,
  ESTIMATE_LFA_PATTERN_LABEL,
  ESTIMATE_LFA_STROKE_WIDTH,
  ESTIMATE_RFA_DASH,
  ESTIMATE_RFA_PATTERN_LABEL,
  ESTIMATE_RFA_STROKE_WIDTH,
  PHASE_LABEL_DY,
  PHASE_LABEL_FILL,
  PHASE_LABEL_FONT_SIZE,
  PHASE_LABEL_FONT_WEIGHT,
  REFERENCE_LABEL_DX,
  REFERENCE_LABEL_DY,
  REFERENCE_LABEL_FONT_SIZE,
  REFERENCE_LABEL_FONT_WEIGHT,
  TOOLTIP_CONTENT_STYLE,
  TREND_CHART_MARGIN,
  TREND_CHART_MARGIN_PLAIN,
} from "@/lib/chartTheme";

/**
 * Three stacked trend charts that mirror the "full-test ribbon" of the
 * PhysioPS Multi-Parameter Graphical:
 *   1) Heart rate (bpm)
 *   2) Breathing envelope (relative units)
 *   3) LFa (sympathetic) and RFa (parasympathetic) rolling wavelet power
 *
 * A-F phase shading comes from report.multiParameter.phases.
 */

const PHASE_COLOR: Record<string, string> = {
  A: "rgba(148,163,184,0.08)", // slate   — Baseline
  B: "rgba(52,211,153,0.10)",  // emerald — Deep Breathing
  C: "rgba(148,163,184,0.05)", // slate
  D: "rgba(251,191,36,0.10)",  // amber   — Valsalva
  E: "rgba(148,163,184,0.05)", // slate
  F: "rgba(244,114,182,0.10)", // pink    — Stand
};

const PHASE_LABEL_COLOR: Record<string, string> = {
  A: "text-slate-200",
  B: "text-emerald-200",
  C: "text-slate-200",
  D: "text-amber-200",
  E: "text-slate-200",
  F: "text-pink-200",
};

function toChartData(ts: TimeSeries) {
  if (!ts || !ts.t || !ts.v) return [];
  return ts.t.map((t, i) => ({ t, v: ts.v[i] }));
}

function mergeSeries(a: TimeSeries, b: TimeSeries) {
  // Interpolate b onto a.t (or just pair up indices if lengths match)
  const out: { t: number; lfa: number | null; rfa: number | null }[] = [];
  const bMap: Record<number, number> = {};
  b.t.forEach((t, i) => { bMap[t] = b.v[i]; });
  const bEntries = Object.keys(bMap).map((k) => [Number(k), bMap[Number(k)]] as [number, number]);
  a.t.forEach((t, i) => {
    // nearest-neighbor lookup in b within 10 sec
    let bv: number | null = bMap[t] ?? null;
    if (bv === null) {
      let best = Infinity;
      for (let j = 0; j < bEntries.length; j++) {
        const d = Math.abs(bEntries[j][0] - t);
        if (d < best && d <= 10) { best = d; bv = bEntries[j][1]; }
      }
    }
    out.push({ t, lfa: a.v[i] ?? null, rfa: bv });
  });
  return out;
}

function fmtClock(sec: number, testStartClock: string): string {
  // parse HH:MM:SS
  const [h, m, s] = testStartClock.split(":").map(Number);
  const total = h * 3600 + m * 60 + s + sec;
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(total % 60)).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface TrendPanelProps {
  mpg: MultiParameterGraphical;
  testStartClock?: string;
  /** True only for vendor-reported spectral values (norm semantics allowed). */
  spectralAvailable: boolean;
  /**
   * True when the rolling LFa/RFa trend is a HumanOS waveform estimate. The
   * trend IS plotted — it is a real measurement of the R-R series — but in
   * neutral colours, with an "est." row label and a prominent
   * "not PhysioPS-validated" disclosure. Only when neither vendor values nor
   * estimates exist do we fall back to the unavailable card.
   */
  spectralEstimated?: boolean;
  /** Needed for the estimate disclosure (method confidence + warnings). */
  report?: ANSReport;
}

export function TrendPanel({
  mpg,
  testStartClock = "13:08:00",
  spectralAvailable,
  spectralEstimated = false,
  report,
}: TrendPanelProps) {
  const hrData = toChartData(mpg.heartRateTrend);
  const breathData = toChartData(mpg.breathingTrend);
  const plotSpectral =
    (spectralAvailable || spectralEstimated) &&
    (mpg.lfaTrend?.v?.length ?? 0) + (mpg.rfaTrend?.v?.length ?? 0) > 0;
  const lfaRfaData = plotSpectral ? mergeSeries(mpg.lfaTrend, mpg.rfaTrend) : [];

  // Ticks every ~60 seconds, rounded
  const ticks: number[] = [];
  for (let t = 0; t <= mpg.totalSec; t += 60) ticks.push(t);

  // HR domain — clinical default 40–160 bpm with auto-extension if patient ranges further.
  // 100 bpm reference = tachycardia, 120 bpm reference = POTS-suggestive sustained tachy.
  const hrMinObserved = Math.min(...mpg.heartRateTrend.v);
  const hrMaxObserved = Math.max(...mpg.heartRateTrend.v);
  const hrDomainLo = Math.min(40, Math.floor(hrMinObserved - 5));
  const hrDomainHi = Math.max(160, Math.ceil(hrMaxObserved + 5));

  // LFa/RFa fixed Y-axis at 60 (Colombo standard) so cross-test comparisons
  // stay calibrated. We extend if the patient's spectral power genuinely
  // exceeds 60 so we don't clip outliers off-screen.
  const lfaMax = plotSpectral && mpg.lfaTrend.v.length ? Math.max(...mpg.lfaTrend.v) : 0;
  const rfaMax = plotSpectral && mpg.rfaTrend.v.length ? Math.max(...mpg.rfaTrend.v) : 0;
  const lfaRfaDomainHi = Math.max(60, Math.ceil(Math.max(lfaMax, rfaMax) * 1.05));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-trend-panel"
    >
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
            Multi-Parameter Graphical — Full Test Trend
          </h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            Continuous signal across all six phases · test start {testStartClock}
          </p>
        </div>
        <PhaseLegend phases={mpg.phases} />
      </div>

      {/* HR */}
      <div data-testid="mpg-hr-chart">
        <RowLabel left="Heart Rate" right="bpm" />
        <ResponsiveContainer width="100%" height={168}>
          <LineChart data={hrData} margin={TREND_CHART_MARGIN}>
            <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, mpg.totalSec]}
              ticks={ticks}
              tickFormatter={(t) => `${Math.round(t / 60)}m`}
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={AXIS_TICK_MARGIN}
              fontSize={AXIS_TICK_FONT_SIZE}
              height={28}
            />
            <YAxis
              domain={[hrDomainLo, hrDomainHi]}
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={4}
              fontSize={AXIS_TICK_FONT_SIZE}
              width={AXIS_Y_WIDTH}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelFormatter={(t: number) => `t = ${t.toFixed(0)}s · ${fmtClock(t, testStartClock)}`}
              formatter={(v: number) => [`${v.toFixed(0)} bpm`, "HR"]}
            />
            {renderPhaseShading(mpg)}
            {/* Clinical reference lines: 100 bpm = tachycardia threshold, 120 bpm = POTS-suggestive */}
            {/* Captions sit inside the reserved right margin (dx) and hang
                below their own rule (dy) so neither is clipped by the plot edge
                nor collides with the other line's caption. */}
            <ReferenceLine
              y={100}
              stroke="hsl(17 100% 60%)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: "Tachy 100",
                position: "insideTopRight",
                fill: "hsl(17 100% 72%)",
                fontSize: REFERENCE_LABEL_FONT_SIZE,
                fontWeight: REFERENCE_LABEL_FONT_WEIGHT,
                dx: REFERENCE_LABEL_DX,
                dy: REFERENCE_LABEL_DY,
              }}
            />
            <ReferenceLine
              y={120}
              stroke="hsl(0 72% 60%)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: "POTS 120",
                position: "insideTopRight",
                fill: "hsl(0 80% 74%)",
                fontSize: REFERENCE_LABEL_FONT_SIZE,
                fontWeight: REFERENCE_LABEL_FONT_WEIGHT,
                dx: REFERENCE_LABEL_DX,
                dy: REFERENCE_LABEL_DY,
              }}
            />
            <Line type="monotone" dataKey="v" stroke="hsl(0 72% 50%)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ColomboExplainer chartKey="heartRateTrend" />

      {/* Breathing */}
      <div className="mt-6" data-testid="mpg-breathing-chart">
        <RowLabel left="Breathing Envelope" right="EDR (a.u.)" />
        <ResponsiveContainer width="100%" height={128}>
          <AreaChart data={breathData} margin={TREND_CHART_MARGIN_PLAIN}>
            <defs>
              <linearGradient id="brGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="hsl(200 90% 60%)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(200 90% 60%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, mpg.totalSec]}
              ticks={ticks}
              tickFormatter={(t) => `${Math.round(t / 60)}m`}
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={AXIS_TICK_MARGIN}
              fontSize={AXIS_TICK_FONT_SIZE}
              height={28}
            />
            <YAxis
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={4}
              fontSize={AXIS_TICK_FONT_SIZE}
              width={AXIS_Y_WIDTH}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelFormatter={(t: number) => `t = ${t.toFixed(0)}s · ${fmtClock(t, testStartClock)}`}
              formatter={(v: number) => [v.toFixed(2), "EDR"]}
            />
            {renderPhaseShading(mpg)}
            <Area type="monotone" dataKey="v" stroke="hsl(200 90% 60%)" strokeWidth={1.2} fill="url(#brGrad)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ColomboExplainer chartKey="breathingTrend" />

      {/* LFa vs RFa */}
      {!plotSpectral ? (
        <div className="mt-6">
          <RowLabel left="LFa (Sympathetic) vs RFa (Parasympathetic)" right="bpm²" />
          <SpectralUnavailableCard
            title="Rolling LFa/RFa spectral trend — not established (no usable waveform and no vendor value)"
            testId="mpg-lfa-rfa-unavailable"
            compact
          />
        </div>
      ) : (
      <div
        className="mt-6"
        data-testid="mpg-lfa-rfa-chart"
        data-spectral-estimated={spectralEstimated ? "true" : "false"}
        title={spectralEstimated ? ESTIMATE_TITLE : undefined}
      >
        <RowLabel
          left={
            spectralEstimated
              ? "LFa (Sympathetic) vs RFa (Parasympathetic) — est."
              : "LFa (Sympathetic) vs RFa (Parasympathetic)"
          }
          right="bpm²"
        />
        {spectralEstimated ? (
          <p
            className="mb-2 text-[12px] leading-relaxed text-violet-100"
            data-testid="mpg-lfa-rfa-estimated-note"
          >
            {ESTIMATE_BADGE} · computed from the R-R series (Morlet wavelet band
            power). No Colombo norm shading is applied and these values do not
            drive any score, pattern or patient-facing statement.
          </p>
        ) : null}
        <ResponsiveContainer width="100%" height={188}>
          <LineChart data={lfaRfaData} margin={TREND_CHART_MARGIN_PLAIN}>
            <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, mpg.totalSec]}
              ticks={ticks}
              tickFormatter={(t) => `${Math.round(t / 60)}m`}
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={AXIS_TICK_MARGIN}
              fontSize={AXIS_TICK_FONT_SIZE}
              height={28}
            />
            <YAxis
              domain={[0, lfaRfaDomainHi]}
              ticks={[0, 15, 30, 45, 60]}
              stroke={AXIS_LINE_COLOR}
              tick={AXIS_TICK}
              tickMargin={4}
              fontSize={AXIS_TICK_FONT_SIZE}
              width={AXIS_Y_WIDTH}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelFormatter={(t: number) => `t = ${t.toFixed(0)}s · ${fmtClock(t, testStartClock)}`}
              formatter={(v: number, name: string) => [v == null ? "—" : v.toFixed(2), name === "lfa" ? "LFa (Sympathetic)" : "RFa (Parasympathetic)"]}
            />
            {/* Legend entries carry the stroke pattern in words, so the two
                estimate traces stay distinguishable without relying on hue
                (greyscale print, colour-vision deficiency). */}
            <Legend
              wrapperStyle={{ fontSize: 13, paddingTop: 10 }}
              iconType="plainline"
              iconSize={22}
              formatter={(val) => (
                <span
                  style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground) / 0.92)" }}
                  data-testid={`mpg-lfa-rfa-legend-${val}`}
                >
                  {val === "lfa" ? "LFa — Sympathetic" : "RFa — Parasympathetic"}
                  {spectralEstimated
                    ? ` (est. · ${val === "lfa" ? ESTIMATE_LFA_PATTERN_LABEL : ESTIMATE_RFA_PATTERN_LABEL})`
                    : ""}
                </span>
              )}
            />
            {renderPhaseShading(mpg)}
            {/* Clinical color convention: red = sympathetic, blue = parasympathetic */}
            <Line
              type="monotone"
              dataKey="lfa"
              stroke={spectralEstimated ? ESTIMATE_LFA_COLOR : "hsl(0 72% 51%)"}
              strokeWidth={spectralEstimated ? ESTIMATE_LFA_STROKE_WIDTH : 1.6}
              strokeDasharray={spectralEstimated ? ESTIMATE_LFA_DASH : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rfa"
              stroke={spectralEstimated ? ESTIMATE_RFA_COLOR : "hsl(217 91% 55%)"}
              strokeWidth={spectralEstimated ? ESTIMATE_RFA_STROKE_WIDTH : 1.6}
              strokeDasharray={spectralEstimated ? ESTIMATE_RFA_DASH : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      )}
      {plotSpectral && spectralEstimated && report ? (
        <div className="mt-3">
          <SpectralEstimateBanner report={report} testId="mpg-trend-estimate-banner" compact />
        </div>
      ) : null}
      {plotSpectral && <ColomboExplainer chartKey="lfaRfaTrend" />}
    </motion.div>
  );
}

function renderPhaseShading(mpg: MultiParameterGraphical) {
  return mpg.phases.map((p) => (
    <ReferenceArea
      key={`phase-${p.name}`}
      x1={p.startSec}
      x2={p.endSec}
      fill={PHASE_COLOR[p.name] ?? "transparent"}
      fillOpacity={1}
      stroke="transparent"
      ifOverflow="extendDomain"
      label={{
        value: p.name,
        position: "insideTop",
        fill: PHASE_LABEL_FILL,
        fontSize: PHASE_LABEL_FONT_SIZE,
        fontWeight: PHASE_LABEL_FONT_WEIGHT,
        dy: PHASE_LABEL_DY,
      }}
    />
  ));
}

function PhaseLegend({ phases }: { phases: MultiParameterGraphical["phases"] }) {
  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
      {phases.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-[12px]">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{
              background: PHASE_COLOR[p.name] ?? "transparent",
              border: "1px solid hsl(var(--foreground) / 0.45)",
            }}
          />
          <span className={`font-semibold ${PHASE_LABEL_COLOR[p.name] ?? "text-foreground/90"}`}>{p.name}</span>
          <span className="text-muted-foreground">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function RowLabel({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-2">
      <span className="text-[13px] font-semibold text-foreground">{left}</span>
      <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
        {right}
      </span>
    </div>
  );
}
