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
  ReferenceLine,
  Cell,
} from "recharts";
import type { ANSReport, Classification } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

/**
 * Time-Domain Ratios — mirrors page 5 of the PhysioPS graphical report.
 * Three small-multiples:  E/I · Valsalva · 30:15.
 *
 * The cardiovagal Ewing ratios are LOWER-BOUND-ONLY: a value ABOVE the source
 * threshold is NORMAL (stronger vagal response), never abnormal. Earlier this
 * panel drew a synthetic age-declining upper band and flagged anything above it
 * as "above normal", which wrongly marked Jill's healthy ratios abnormal. We now
 * take the pass/fail state directly from the report's own classification
 * (severity + threshold `lo`) using the exact source cutoffs
 * (E/I > 1.094, Valsalva > 1.200, 30:15 > 1.092) and render only a single
 * "normal at or above threshold" region — no arbitrary upper bound.
 */

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
          cls={ratios.eiRatio.classification}
          normalText={ratios.eiRatio.normal}
          age={patientAge}
          yDomain={[0.8, 2.2]}
          chartKey="eiRatio"
          testId="ratio-tile-ei"
        />
        <RatioTile
          title="Valsalva Ratio"
          value={ratios.valsalvaRatio.value}
          cls={ratios.valsalvaRatio.classification}
          normalText={ratios.valsalvaRatio.normal}
          age={patientAge}
          yDomain={[0.8, 2.6]}
          chartKey="valsalvaRatio"
          testId="ratio-tile-valsalva"
        />
        <RatioTile
          title="30:15 Ratio (Stand)"
          value={ratios.thirtyFifteenRatio.value}
          cls={ratios.thirtyFifteenRatio.classification}
          normalText={ratios.thirtyFifteenRatio.normal}
          age={patientAge}
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
  cls,
  normalText,
  age,
  yDomain,
  chartKey,
  testId,
}: {
  title: string;
  value: number;
  cls: Classification;
  normalText: string;
  age: number;
  yDomain: [number, number];
  chartKey: string;
  testId: string;
}) {
  // Source of truth: the report's own classification. Ewing ratios are
  // lower-bound-only — normal means value >= threshold (cls.lo). Higher is
  // healthier and must never be flagged as "above normal".
  const threshold = cls.lo;
  const isNormal = cls.severity === "Normal";
  const color = isNormal ? "hsl(140 60% 55%)" : "hsl(0 72% 62%)";
  const statusLabel = isNormal ? "Normal" : cls.label;

  return (
    <div className="rounded-xl bg-background/40 border border-border/20 p-4" data-testid={testId}>
      <div className="mb-2">
        <div className="text-[12px] font-semibold text-foreground/90">{title}</div>
        <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
          You: <span style={{ color }} className="font-semibold">{value.toFixed(2)}</span>{" "}
          <span data-testid={`${testId}-status`} style={{ color }} className="font-semibold">({statusLabel})</span>{" "}
          · normal {normalText}
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
          {/* Normal region = at or above the source threshold (no upper bound). */}
          <ReferenceArea
            y1={threshold}
            y2={yDomain[1]}
            fill="hsl(140 60% 55% / 0.12)"
            stroke="hsl(140 60% 55% / 0.25)"
          />
          {/* Abnormal region = below the threshold. */}
          <ReferenceArea
            y1={yDomain[0]}
            y2={threshold}
            fill="hsl(0 72% 62% / 0.08)"
          />
          <ReferenceLine
            y={threshold}
            stroke="hsl(140 60% 55% / 0.7)"
            strokeDasharray="4 4"
            label={{ value: `≥ ${threshold.toFixed(3)} normal`, position: "insideTopLeft", fill: "hsl(140 60% 55%)", fontSize: 9 }}
          />
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
