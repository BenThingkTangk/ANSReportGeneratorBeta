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
import type { MultiParameterGraphical, TimeSeries } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

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
  A: "text-slate-300",
  B: "text-emerald-300",
  C: "text-slate-400",
  D: "text-amber-300",
  E: "text-slate-400",
  F: "text-pink-300",
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
}

export function TrendPanel({ mpg, testStartClock = "13:08:00" }: TrendPanelProps) {
  const hrData = toChartData(mpg.heartRateTrend);
  const breathData = toChartData(mpg.breathingTrend);
  const lfaRfaData = mergeSeries(mpg.lfaTrend, mpg.rfaTrend);

  // Ticks every ~60 seconds, rounded
  const ticks: number[] = [];
  for (let t = 0; t <= mpg.totalSec; t += 60) ticks.push(t);

  const hrMin = Math.min(...mpg.heartRateTrend.v);
  const hrMax = Math.max(...mpg.heartRateTrend.v);
  const hrPad = Math.max(5, (hrMax - hrMin) * 0.12);

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
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Continuous signal across all six phases · test start {testStartClock}
          </p>
        </div>
        <PhaseLegend phases={mpg.phases} />
      </div>

      {/* HR */}
      <div data-testid="mpg-hr-chart">
        <RowLabel left="Heart Rate" right="bpm" />
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={hrData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, mpg.totalSec]}
              ticks={ticks}
              tickFormatter={(t) => `${Math.round(t / 60)}m`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
            />
            <YAxis
              domain={[Math.floor(hrMin - hrPad), Math.ceil(hrMax + hrPad)]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
              labelFormatter={(t: number) => `t = ${t.toFixed(0)}s · ${fmtClock(t, testStartClock)}`}
              formatter={(v: number) => [`${v.toFixed(0)} bpm`, "HR"]}
            />
            {renderPhaseShading(mpg)}
            <Line type="monotone" dataKey="v" stroke="hsl(0 72% 62%)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ColomboExplainer chartKey="heartRateTrend" />

      {/* Breathing */}
      <div className="mt-6" data-testid="mpg-breathing-chart">
        <RowLabel left="Breathing Envelope" right="EDR (a.u.)" />
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={breathData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
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
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
            />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={36} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
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
      <div className="mt-6" data-testid="mpg-lfa-rfa-chart">
        <RowLabel left="LFa (Sympathetic) vs RFa (Parasympathetic)" right="bpm²" />
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={lfaRfaData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, mpg.totalSec]}
              ticks={ticks}
              tickFormatter={(t) => `${Math.round(t / 60)}m`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
            />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={36} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
              labelFormatter={(t: number) => `t = ${t.toFixed(0)}s · ${fmtClock(t, testStartClock)}`}
              formatter={(v: number, name: string) => [v == null ? "—" : v.toFixed(2), name === "lfa" ? "LFa" : "RFa"]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(val) => (val === "lfa" ? "LFa (Sympathetic)" : "RFa (Parasympathetic)")}
            />
            {renderPhaseShading(mpg)}
            <Line type="monotone" dataKey="lfa" stroke="hsl(35 90% 60%)" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="rfa" stroke="hsl(140 60% 55%)" strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ColomboExplainer chartKey="lfaRfaTrend" />
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
        fill: "hsl(var(--muted-foreground))",
        fontSize: 10,
        fontWeight: 600,
      }}
    />
  ));
}

function PhaseLegend({ phases }: { phases: MultiParameterGraphical["phases"] }) {
  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
      {phases.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-[10px]">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: PHASE_COLOR[p.name] ?? "transparent", border: "1px solid hsl(var(--border))" }}
          />
          <span className={`font-semibold ${PHASE_LABEL_COLOR[p.name] ?? "text-muted-foreground"}`}>{p.name}</span>
          <span className="text-muted-foreground/70">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function RowLabel({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-[11px] font-medium text-foreground/80">{left}</span>
      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{right}</span>
    </div>
  );
}
