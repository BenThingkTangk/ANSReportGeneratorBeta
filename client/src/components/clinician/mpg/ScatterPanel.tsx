import { motion } from "framer-motion";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  Cell,
} from "recharts";
import type { ANSReport, MultiParameterGraphical } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";
import { SpectralUnavailableCard } from "./SpectralUnavailableCard";
import { SpectralEstimateBanner } from "./SpectralEstimateBanner";
import {
  ESTIMATE_BADGE,
  ESTIMATE_SERIES_COLOR,
  ESTIMATE_TITLE,
} from "@/lib/spectralProvenance";
import {
  AXIS_LINE_COLOR,
  AXIS_TICK,
  AXIS_TICK_COLOR,
  AXIS_TICK_FONT_SIZE,
  AXIS_TITLE_FONT_SIZE,
  ESTIMATE_LEGEND_SHAPE,
  TOOLTIP_CONTENT_STYLE,
  type LegendSwatchShape,
} from "@/lib/chartTheme";

/**
 * Five small-multiple scatter/response charts that mirror the right-hand
 * column of the PhysioPS Multi-Parameter Graphical:
 *
 *   1. Baseline LFa vs RFa                 (age-banded normal region)
 *   2. Deep-Breathing RFa vs Age           (age-declining normal band)
 *   3. Valsalva LFa vs Age                 (age-declining normal band)
 *   4. Stand Response (LFa, RFa)           (tri-color zones)
 *   5. RFa Analysis — % change A→D, A→F    (expected vs observed)
 *
 * Age-banded normal regions are derived from Colombo's published norms.
 */

// --- Normative bands (approximations from Colombo reference charts) --------

function dbRfaNormalBand(age: number): { lo: number; hi: number } {
  // Declining log band: 20yo ~ (0.8, 6.0); 70yo ~ (0.3, 2.2)
  const loY = Math.max(0.2, 0.8 - 0.01 * (age - 20));
  const hiY = Math.max(1.0, 6.0 * Math.pow(0.95, Math.max(0, age - 20)));
  return { lo: loY, hi: hiY };
}

function valsalvaLfaNormalBand(age: number): { lo: number; hi: number } {
  // Declining band: 20yo ~ (2.0, 14); 70yo ~ (0.8, 5)
  const loY = Math.max(0.5, 2.0 - 0.025 * (age - 20));
  const hiY = Math.max(3.0, 14.0 * Math.pow(0.94, Math.max(0, age - 20)));
  return { lo: loY, hi: hiY };
}

// --- Shared small-multiple container ---------------------------------------

interface ScatterPanelProps {
  mpg: MultiParameterGraphical;
  patientAge: number;
  /** True only for vendor-reported values: norm bands + colour-coding allowed. */
  spectralAvailable: boolean;
  /**
   * True when the plotted LFa/RFa are HumanOS waveform estimates. The maps ARE
   * drawn — the values are real measurements of the R-R series — but every
   * Colombo normative region, age band, target marker and normal/abnormal
   * colour is suppressed, because judging an unvalidated estimate against the
   * vendor's norms would be an unvalidated clinical call. Each card is labelled
   * "est." and the section carries a prominent disclosure.
   */
  spectralEstimated?: boolean;
  report?: ANSReport;
}

export function ScatterPanel({
  mpg,
  patientAge,
  spectralAvailable,
  spectralEstimated = false,
  report,
}: ScatterPanelProps) {
  const plot = spectralAvailable || spectralEstimated;
  const est = spectralEstimated;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-scatter-panel"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4 break-words">
        Autonomic Response Maps
      </h3>

      {!plot ? (
        <SpectralUnavailableCard
          title="Autonomic response maps — spectral output not established"
          testId="mpg-scatter-unavailable"
        />
      ) : (
        <div data-testid={est ? "mpg-scatter-estimated" : "mpg-scatter-vendor"}>
          {est && report ? (
            <div className="mb-4">
              <SpectralEstimateBanner report={report} testId="mpg-scatter-estimate-banner" compact />
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <BaselineLfaRfa mpg={mpg} est={est} />
            <DeepBreathingRfa mpg={mpg} age={patientAge} est={est} />
            <ValsalvaLfa mpg={mpg} age={patientAge} est={est} />
            <StandResponse mpg={mpg} est={est} />
          </div>

          <div className="mt-5">
            <RfaExcess mpg={mpg} est={est} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// --- 1. Baseline LFa vs RFa ------------------------------------------------

function BaselineLfaRfa({ mpg, est }: { mpg: MultiParameterGraphical; est: boolean }) {
  const x = mpg.scatter.baselineLFa;
  const y = mpg.scatter.baselineRFa;
  // Per-phase null guard: baseline spectral may be absent even when the panel's
  // global gate opened (e.g. a vendor PDF that supplied other phases only).
  if (x == null || y == null) {
    return (
      <SpectralUnavailableCard
        title="Baseline LFa vs RFa — spectral not established for this phase"
        testId="chart-baseline-lfa-rfa-unavailable"
        compact
      />
    );
  }
  const ratio = y > 0 ? x / y : 0;

  return (
    <MiniCard
      est={est}
      title="Baseline LFa vs RFa"
      subtitle={`LFa/RFa = ${ratio.toFixed(2)} (resting balance)`}
      chartKey="baselineLfaRfa"
      testId="chart-baseline-lfa-rfa"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            name="LFa"
            domain={[0, Math.max(10, x * 1.4)]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            label={{ value: "LFa (Sympathetic) bpm²", fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="RFa"
            domain={[0, Math.max(8, y * 1.4)]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            label={{ value: "RFa (Parasympathetic)", angle: -90, fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideLeft" }}
            width={44}
          />
          <ZAxis range={[120, 120]} />
          {/* Normal zone: ratio 0.4 - 1.0, RFa 0.5 - 6, LFa 0 - 8.
              SUPPRESSED for estimates — an unvalidated value must not be shown
              inside or outside a normative region. */}
          {!est ? (
            <ReferenceArea x1={0} x2={6} y1={0.5} y2={6} fill="hsl(140 60% 55% / 0.10)" stroke="hsl(140 60% 55% / 0.40)" strokeDasharray="3 3" />
          ) : null}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Scatter data={[{ x, y, label: "Resting" }]} fill={est ? ESTIMATE_SERIES_COLOR : "hsl(17 100% 60%)"}>
            <Cell
              fill={
                est
                  ? ESTIMATE_SERIES_COLOR
                  : ratio >= 0.4 && ratio <= 1.0
                    ? "hsl(140 60% 55%)"
                    : ratio < 0.4
                      ? "hsl(0 72% 62%)"
                      : "hsl(17 100% 60%)"
              }
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={
          est
            ? [{ swatch: ESTIMATE_SERIES_COLOR, label: "HumanOS estimate (no norm window applied)", shape: ESTIMATE_LEGEND_SHAPE }]
            : [
                { swatch: "hsl(140 60% 55% / 0.30)", label: "Low-normal window (ratio 0.4–1.0)" },
                { swatch: "hsl(0 72% 62%)", label: "Advanced dysfunction (ratio < 0.4)" },
              ]
        }
      />
    </MiniCard>
  );
}

// --- 2. Deep-Breathing RFa vs Age -----------------------------------------

function DeepBreathingRfa({ mpg, age, est }: { mpg: MultiParameterGraphical; age: number; est: boolean }) {
  const val = mpg.scatter.dbRFa;
  if (val == null) {
    return (
      <SpectralUnavailableCard
        title="Deep Breathing RFa — spectral not established for this phase"
        testId="chart-db-rfa-unavailable"
        compact
      />
    );
  }
  const band = dbRfaNormalBand(age);
  const inBand = val >= band.lo && val <= band.hi;

  // Render band as a synthetic normal curve over age axis
  const ages = Array.from({ length: 11 }, (_, i) => 20 + i * 5);
  const bandData = ages.map((a) => ({
    age: a,
    lo: dbRfaNormalBand(a).lo,
    hi: dbRfaNormalBand(a).hi,
  }));

  return (
    <MiniCard
      est={est}
      title="Deep Breathing RFa vs Age"
      subtitle={
        est
          ? `RFa (est.): ${val.toFixed(2)} bpm² · age norm band not applied to an estimate`
          : `Your RFa: ${val.toFixed(2)} · Age ${age} band: ${band.lo.toFixed(2)}–${band.hi.toFixed(2)}`
      }
      chartKey="deepBreathingRfa"
      testId="chart-db-rfa"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="age"
            domain={[18, 75]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            label={{ value: "Age (years)", fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="rfa"
            domain={[0, Math.max(10, band.hi * 1.3, val * 1.3)]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            width={44}
            label={{ value: "RFa (bpm²)", angle: -90, fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideLeft" }}
          />
          {/* Age-normal band: SUPPRESSED for estimates. */}
          {(est ? [] : bandData).map((b) => (
            <ReferenceArea
              key={b.age}
              x1={b.age - 2.5}
              x2={b.age + 2.5}
              y1={b.lo}
              y2={b.hi}
              fill="hsl(140 60% 50% / 0.18)"
              stroke="hsl(140 60% 50% / 0.45)"
              strokeDasharray="3 3"
            />
          ))}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Scatter
            data={[{ age, rfa: val }]}
            fill={
              est
                ? ESTIMATE_SERIES_COLOR
                : inBand
                  ? "hsl(140 60% 55%)"
                  : val < band.lo
                    ? "hsl(0 72% 62%)"
                    : "hsl(17 100% 60%)"
            }
          />
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={
          est
            ? [{ swatch: ESTIMATE_SERIES_COLOR, label: "HumanOS estimate (age-normal band not applied)", shape: ESTIMATE_LEGEND_SHAPE }]
            : [
                { swatch: "hsl(140 60% 50% / 0.45)", label: "Age-normal band" },
                { swatch: "hsl(148 16% 60%)", label: "Outside band" },
                { swatch: "hsl(0 72% 62%)", label: "Below normal" },
              ]
        }
      />
    </MiniCard>
  );
}

// --- 3. Valsalva LFa vs Age -----------------------------------------------

function ValsalvaLfa({ mpg, age, est }: { mpg: MultiParameterGraphical; age: number; est: boolean }) {
  const val = mpg.scatter.valsalvaLFa;
  if (val == null) {
    return (
      <SpectralUnavailableCard
        title="Valsalva LFa — spectral not established for this phase"
        testId="chart-valsalva-lfa-unavailable"
        compact
      />
    );
  }
  const band = valsalvaLfaNormalBand(age);
  const inBand = val >= band.lo && val <= band.hi;

  const ages = Array.from({ length: 11 }, (_, i) => 20 + i * 5);
  const bandData = ages.map((a) => ({
    age: a,
    lo: valsalvaLfaNormalBand(a).lo,
    hi: valsalvaLfaNormalBand(a).hi,
  }));

  return (
    <MiniCard
      est={est}
      title="Valsalva LFa vs Age"
      subtitle={
        est
          ? `LFa (est.): ${val.toFixed(2)} bpm² · age norm band not applied to an estimate`
          : `Your LFa: ${val.toFixed(2)} · Age ${age} band: ${band.lo.toFixed(2)}–${band.hi.toFixed(2)}`
      }
      chartKey="valsalvaLfa"
      testId="chart-valsalva-lfa"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="age"
            domain={[18, 75]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            label={{ value: "Age (years)", fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="lfa"
            domain={[0, Math.max(20, band.hi * 1.3, val * 1.3)]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            width={44}
            label={{ value: "LFa (bpm²)", angle: -90, fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideLeft" }}
          />
          {/* Age-normal band: SUPPRESSED for estimates. */}
          {(est ? [] : bandData).map((b) => (
            <ReferenceArea
              key={b.age}
              x1={b.age - 2.5}
              x2={b.age + 2.5}
              y1={b.lo}
              y2={b.hi}
              fill="hsl(140 60% 50% / 0.18)"
              stroke="hsl(140 60% 50% / 0.45)"
              strokeDasharray="3 3"
            />
          ))}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Scatter
            data={[{ age, lfa: val }]}
            fill={
              est
                ? ESTIMATE_SERIES_COLOR
                : inBand
                  ? "hsl(140 60% 55%)"
                  : val > band.hi
                    ? "hsl(0 72% 62%)"
                    : "hsl(17 100% 60%)"
            }
          />
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={
          est
            ? [{ swatch: ESTIMATE_SERIES_COLOR, label: "HumanOS estimate (age-normal band not applied)", shape: ESTIMATE_LEGEND_SHAPE }]
            : [
                { swatch: "hsl(140 60% 50% / 0.45)", label: "Age-normal band" },
                { swatch: "hsl(148 16% 60%)", label: "Outside band" },
                { swatch: "hsl(0 72% 62%)", label: "Above normal (stroke-risk signal)" },
              ]
        }
      />
    </MiniCard>
  );
}

// --- 4. Stand Response -----------------------------------------------------

function StandResponse({ mpg, est }: { mpg: MultiParameterGraphical; est: boolean }) {
  const { standLFa, standRFa } = mpg.scatter;
  if (standLFa == null || standRFa == null) {
    return (
      <SpectralUnavailableCard
        title="Stand Response — spectral not established for this phase"
        testId="chart-stand-response-unavailable"
        compact
      />
    );
  }
  const data = [
    { label: "Stand LFa", value: standLFa, target: 3.0 },
    { label: "Stand RFa", value: standRFa, target: 1.5 },
  ];

  const maxV = Math.max(...data.map((d) => Math.max(d.value, d.target))) * 1.3;

  return (
    <MiniCard
      est={est}
      title="Stand Response (Phase F)"
      subtitle={
        est
          ? "Estimated band powers plotted as measured — no expected-response target applied"
          : "Ideal: RFa drops first, LFa rises second"
      }
      chartKey="standResponse"
      testId="chart-stand-response"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="category"
            dataKey="label"
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            allowDuplicatedCategory={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            domain={[0, maxV]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            width={44}
            label={{ value: "bpm²", angle: -90, fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideLeft" }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Scatter data={data} fill={est ? ESTIMATE_SERIES_COLOR : "hsl(244 84% 68%)"}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  est
                    ? ESTIMATE_SERIES_COLOR
                    : d.label === "Stand LFa"
                      ? "hsl(0 72% 51%)"
                      : "hsl(217 91% 55%)"
                }
              />
            ))}
          </Scatter>
          {/* Target markers = a normative expectation: suppressed for estimates. */}
          {!est ? (
            <Scatter data={data.map((d) => ({ label: d.label, value: d.target }))} fill="transparent" shape="cross" line={false}>
              {data.map((_, i) => (
                <Cell key={`t${i}`} fill="hsl(var(--foreground) / 0.6)" />
              ))}
            </Scatter>
          ) : null}
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={
          est
            ? [{ swatch: ESTIMATE_SERIES_COLOR, label: "HumanOS estimate (no target marker applied)", shape: ESTIMATE_LEGEND_SHAPE }]
            : [
                { swatch: "hsl(0 72% 51%)", label: "LFa — Sympathetic" },
                { swatch: "hsl(217 91% 55%)", label: "RFa — Parasympathetic" },
                { swatch: "hsl(var(--foreground) / 0.6)", label: "Target marker (×)" },
              ]
        }
      />
    </MiniCard>
  );
}

// --- 5. RFa % Change (Excess) ---------------------------------------------

function RfaExcess({ mpg, est }: { mpg: MultiParameterGraphical; est: boolean }) {
  const valsalva = mpg.scatter.rfaChangeValsalvaPct;
  const stand = mpg.scatter.rfaChangeStandPct;

  // These % changes need both baseline and challenge RFa. If neither is
  // computable, the panel is not assessable.
  if (valsalva == null && stand == null) {
    return (
      <SpectralUnavailableCard
        title="RFa % change — spectral not established"
        testId="chart-rfa-excess-unavailable"
        compact
      />
    );
  }
  const data = [
    { label: "Valsalva (A→D)", value: valsalva, expected: -40, expectedLabel: "expected: ≤ -30%" },
    { label: "Stand (A→F)",    value: stand,    expected: -50, expectedLabel: "expected: ≤ -40%" },
  ].filter((d): d is { label: string; value: number; expected: number; expectedLabel: string } => d.value != null);

  const maxAbs = Math.max(100, ...data.map((d) => Math.abs(d.value)));

  return (
    <MiniCard
      est={est}
      title={est ? "RFa Analysis — % change (est.)" : "RFa Analysis — Parasympathetic Excess"}
      subtitle={
        est
          ? "% change between two estimated band powers — magnitude carries the uncertainty of both"
          : "% change in RFa from baseline during challenge"
      }
      chartKey="rfaExcess"
      testId="chart-rfa-excess"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="category"
            dataKey="label"
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            allowDuplicatedCategory={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            domain={[-maxAbs, maxAbs]}
            stroke={AXIS_LINE_COLOR}
            tick={AXIS_TICK}
            tickMargin={6}
            fontSize={AXIS_TICK_FONT_SIZE}
            width={44}
            label={{ value: "% change", angle: -90, fill: AXIS_TICK_COLOR, fontSize: AXIS_TITLE_FONT_SIZE, fontWeight: 500, position: "insideLeft" }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          {/* Expected/excess zones are normative: suppressed for estimates. */}
          {!est ? <ReferenceArea y1={0} y2={maxAbs} fill="hsl(0 72% 62% / 0.08)" /> : null}
          {!est ? <ReferenceArea y1={-maxAbs} y2={-20} fill="hsl(140 60% 55% / 0.08)" /> : null}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            formatter={(v: number) => [`${v.toFixed(0)}%`, "Change"]}
          />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  est
                    ? ESTIMATE_SERIES_COLOR
                    : d.value > 0
                      ? "hsl(0 72% 62%)"
                      : d.value <= -20
                        ? "hsl(140 60% 55%)"
                        : "hsl(17 100% 60%)"
                }
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={
          est
            ? [{ swatch: ESTIMATE_SERIES_COLOR, label: "HumanOS estimate (expected/excess zones not applied)", shape: ESTIMATE_LEGEND_SHAPE }]
            : [
                { swatch: "hsl(140 60% 55% / 0.30)", label: "Expected zone (RFa drops on challenge)" },
                { swatch: "hsl(0 72% 62% / 0.30)", label: "Excess zone (RFa rises — parasympathetic excess)" },
              ]
        }
      />
    </MiniCard>
  );
}

// --- Shared mini-card wrapper ---------------------------------------------

function MiniCard({
  title,
  subtitle,
  chartKey,
  testId,
  est = false,
  children,
}: {
  title: string;
  subtitle?: string;
  chartKey: string;
  testId: string;
  /** Marks the card as a HumanOS estimate: badge + tooltip, no norm semantics. */
  est?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl bg-background/40 border p-4 ${est ? "border-violet-400/25" : "border-border/20"}`}
      data-testid={testId}
      data-spectral-estimated={est ? "true" : "false"}
      title={est ? ESTIMATE_TITLE : undefined}
    >
      <div className="mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-semibold text-foreground break-words">{title}</div>
          {est ? (
            <span className="rounded border border-violet-300/60 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wider text-violet-100">
              est.
            </span>
          ) : null}
        </div>
        {est ? (
          <div className="text-[11px] uppercase tracking-wider text-violet-100/90 mt-0.5 break-words">
            {ESTIMATE_BADGE}
          </div>
        ) : null}
        {subtitle && <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">{subtitle}</div>}
      </div>
      {children}
      <ColomboExplainer chartKey={chartKey} />
    </div>
  );
}

/**
 * Legend swatches carry a SHAPE as well as a colour: estimate series use a
 * rotated diamond, vendor norm windows / clinical zones use a square. A reader
 * with colour-vision deficiency (or a greyscale print of the report) can still
 * tell an estimate entry from a normative one.
 */
function LegendRow({
  items,
}: {
  items: { swatch: string; label: string; shape?: LegendSwatchShape }[];
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex items-center gap-1.5 text-[12px] leading-snug text-muted-foreground"
        >
          <LegendSwatch swatch={it.swatch} shape={it.shape ?? "square"} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function LegendSwatch({ swatch, shape }: { swatch: string; shape: LegendSwatchShape }) {
  if (shape === "diamond") {
    return (
      <span
        className="inline-block w-3 h-3 shrink-0 rotate-45 rounded-[2px]"
        style={{ background: swatch }}
        data-legend-shape="diamond"
        aria-hidden="true"
      />
    );
  }
  if (shape === "long-dash" || shape === "dotted-line") {
    return (
      <span
        className="inline-block w-4 shrink-0"
        style={{
          borderTopWidth: 2,
          borderTopStyle: shape === "long-dash" ? "dashed" : "dotted",
          borderTopColor: swatch,
        }}
        data-legend-shape={shape}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="inline-block w-3 h-3 shrink-0 rounded-sm"
      style={{ background: swatch }}
      data-legend-shape="square"
      aria-hidden="true"
    />
  );
}
