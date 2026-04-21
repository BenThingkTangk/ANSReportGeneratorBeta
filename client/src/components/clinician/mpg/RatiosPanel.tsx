import { motion } from "framer-motion";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceArea,
  Cell,
} from "recharts";
import type { ANSReport } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

/**
 * Time-Domain Ratios — mirrors page 5 of the PhysioPS graphical report.
 * Three small-multiples:  E/I · Valsalva · 30:15  each plotted against age
 * with the age-normal band overlaid.
 */

// --- Age-normal bands (Colombo reference) ---------------------------------

function eiBand(age: number) {
  // 20yo ~ (1.20, 1.80); 70yo ~ (1.04, 1.25)
  const lo = Math.max(1.00, 1.20 - 0.0035 * (age - 20));
  const hi = Math.max(1.15, 1.80 - 0.012  * (age - 20));
  return { lo, hi };
}

function valsalvaBand(age: number) {
  // 20yo ~ (1.45, 2.10); 70yo ~ (1.10, 1.60)
  const lo = Math.max(1.00, 1.45 - 0.007 * (age - 20));
  const hi = Math.max(1.30, 2.10 - 0.010 * (age - 20));
  return { lo, hi };
}

function thirtyFifteenBand(age: number) {
  // 20yo ~ (1.05, 1.35); 70yo ~ (1.00, 1.15)
  const lo = Math.max(0.98, 1.05 - 0.0015 * (age - 20));
  const hi = Math.max(1.10, 1.35 - 0.004  * (age - 20));
  return { lo, hi };
}

interface RatiosPanelProps {
  ratios: ANSReport["ratios"];
  patientAge: number;
}

export function RatiosPanel({ ratios, patientAge }: RatiosPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.22 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-ratios-panel"
    >
      <div className="mb-4">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Time-Domain Ratios vs Age
        </h3>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          Age-normal bands from Colombo reference charts
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <RatioTile
          title="E/I Ratio (Deep Breathing)"
          value={ratios.eiRatio.value}
          age={patientAge}
          bandFn={eiBand}
          yDomain={[0.8, 2.2]}
          chartKey="eiRatio"
          testId="ratio-tile-ei"
        />
        <RatioTile
          title="Valsalva Ratio"
          value={ratios.valsalvaRatio.value}
          age={patientAge}
          bandFn={valsalvaBand}
          yDomain={[0.8, 2.6]}
          chartKey="valsalvaRatio"
          testId="ratio-tile-valsalva"
        />
        <RatioTile
          title="30:15 Ratio (Stand)"
          value={ratios.thirtyFifteenRatio.value}
          age={patientAge}
          bandFn={thirtyFifteenBand}
          yDomain={[0.85, 1.5]}
          chartKey="thirtyFifteenRatio"
          testId="ratio-tile-3015"
        />
      </div>
    </motion.div>
  );
}

function RatioTile({
  title,
  value,
  age,
  bandFn,
  yDomain,
  chartKey,
  testId,
}: {
  title: string;
  value: number;
  age: number;
  bandFn: (age: number) => { lo: number; hi: number };
  yDomain: [number, number];
  chartKey: string;
  testId: string;
}) {
  const ages = Array.from({ length: 11 }, (_, i) => 20 + i * 5);
  const band = bandFn(age);
  const inBand = value >= band.lo && value <= band.hi;
  const color = inBand
    ? "hsl(140 60% 55%)"
    : value < band.lo
    ? "hsl(0 72% 62%)"
    : "hsl(35 90% 60%)";

  return (
    <div className="rounded-xl bg-background/40 border border-border/20 p-4" data-testid={testId}>
      <div className="mb-2">
        <div className="text-[12px] font-semibold text-foreground/90">{title}</div>
        <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
          You: <span style={{ color }} className="font-semibold">{value.toFixed(2)}</span> · band: {band.lo.toFixed(2)}–{band.hi.toFixed(2)}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="age"
            domain={[18, 75]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            label={{ value: "Age (years)", fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="v"
            domain={yDomain}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            width={40}
            label={{ value: "Ratio", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
          />
          {ages.map((a) => {
            const b = bandFn(a);
            return (
              <ReferenceArea
                key={a}
                x1={a - 2.5}
                x2={a + 2.5}
                y1={b.lo}
                y2={b.hi}
                fill="hsl(140 60% 55% / 0.12)"
                stroke="hsl(140 60% 55% / 0.25)"
              />
            );
          })}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
            formatter={(v: number, name: string) => (name === "v" ? [v.toFixed(2), "Ratio"] : [v, name])}
          />
          <Scatter data={[{ age, v: value }]}>
            <Cell fill={color} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <ColomboExplainer chartKey={chartKey} />
    </div>
  );
}
