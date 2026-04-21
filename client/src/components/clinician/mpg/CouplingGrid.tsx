import { motion } from "framer-motion";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { MultiParameterGraphical, CardioRespiratoryWindow } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

/**
 * Cardio-Respiratory Coupling 2×2 grid — mirrors page 4 of the PhysioPS
 * graphical report. Each quadrant shows beat-to-beat HR (line) overlaid on
 * the breathing envelope (area), scoped to one phase window.
 */

const EXPLAIN_KEY: Record<CardioRespiratoryWindow["phase"], string> = {
  Baseline:      "couplingBaseline",
  DeepBreathing: "couplingDeepBreathing",
  Valsalva:      "couplingValsalva",
  Stand:         "couplingStand",
};

interface CouplingGridProps {
  mpg: MultiParameterGraphical;
}

export function CouplingGrid({ mpg }: CouplingGridProps) {
  if (!mpg.coupling || mpg.coupling.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-coupling-grid"
    >
      <div className="mb-4">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Cardio-Respiratory Coupling
        </h3>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          Per-beat HR overlaid on breathing envelope — one window per phase
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {mpg.coupling.map((w) => (
          <CouplingTile key={w.phase} window={w} />
        ))}
      </div>
    </motion.div>
  );
}

function CouplingTile({ window: w }: { window: CardioRespiratoryWindow }) {
  // Build a unified per-time row: HR at its own t array; breathing at its own t array.
  const hrRows = w.hr.t.map((t, i) => ({ t, hr: w.hr.v[i], breath: null as number | null }));
  const brRows = w.breathing.t.map((t, i) => ({ t, hr: null as number | null, breath: w.breathing.v[i] }));
  const data = [...hrRows, ...brRows].sort((a, b) => a.t - b.t);

  const hrVals = w.hr.v.filter((v) => Number.isFinite(v));
  const hrMin = hrVals.length ? Math.min(...hrVals) : 0;
  const hrMax = hrVals.length ? Math.max(...hrVals) : 100;
  const hrPad = Math.max(3, (hrMax - hrMin) * 0.15);

  const startT = Math.min(...w.hr.t.concat(w.breathing.t));
  const endT = Math.max(...w.hr.t.concat(w.breathing.t));

  return (
    <div
      className="rounded-xl bg-background/40 border border-border/20 p-4"
      data-testid={`coupling-tile-${w.phase.toLowerCase()}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground/90">{w.label}</div>
          <div className="text-[10px] text-muted-foreground/80 tabular-nums">
            {w.startClock} → {w.endClock}
          </div>
        </div>
        {w.annotations && w.annotations.length > 0 && (
          <div className="text-right space-y-0.5">
            {w.annotations.map((a) => (
              <div key={a} className="text-[10px] font-mono text-emerald-300/90">
                {a}
              </div>
            ))}
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id={`brGrad-${w.phase}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(200 90% 60%)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(200 90% 60%)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[startT, endT]}
            tickFormatter={(t) => `${Math.round(t - startT)}s`}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
          />
          <YAxis
            yAxisId="hr"
            orientation="left"
            domain={[Math.floor(hrMin - hrPad), Math.ceil(hrMax + hrPad)]}
            stroke="hsl(0 72% 62%)"
            fontSize={10}
            width={36}
          />
          <YAxis yAxisId="br" orientation="right" hide />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
            labelFormatter={(t: number) => `t = ${(t - startT).toFixed(1)}s`}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === "number" ? v : null;
              const k = String(name);
              if (n == null) return ["—", k];
              if (k === "hr") return [`${n.toFixed(0)} bpm`, "HR"];
              return [n.toFixed(2), "Breath"];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            formatter={(val) => (val === "hr" ? "HR" : "Breathing")}
          />
          <Area
            yAxisId="br"
            type="monotone"
            dataKey="breath"
            stroke="hsl(200 90% 60%)"
            strokeWidth={1.0}
            fill={`url(#brGrad-${w.phase})`}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="hr"
            stroke="hsl(0 72% 62%)"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      <ColomboExplainer chartKey={EXPLAIN_KEY[w.phase]} />
    </div>
  );
}
