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
import type { MultiParameterGraphical } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

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
}

export function ScatterPanel({ mpg, patientAge }: ScatterPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-scatter-panel"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Autonomic Response Maps
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BaselineLfaRfa mpg={mpg} />
        <DeepBreathingRfa mpg={mpg} age={patientAge} />
        <ValsalvaLfa mpg={mpg} age={patientAge} />
        <StandResponse mpg={mpg} />
      </div>

      <div className="mt-5">
        <RfaExcess mpg={mpg} />
      </div>
    </motion.div>
  );
}

// --- 1. Baseline LFa vs RFa ------------------------------------------------

function BaselineLfaRfa({ mpg }: { mpg: MultiParameterGraphical }) {
  const x = mpg.scatter.baselineLFa;
  const y = mpg.scatter.baselineRFa;
  const ratio = y > 0 ? x / y : 0;

  return (
    <MiniCard
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
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            label={{ value: "LFa (Sympathetic) bpm²", fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="RFa"
            domain={[0, Math.max(8, y * 1.4)]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            label={{ value: "RFa (Parasympathetic)", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
            width={44}
          />
          <ZAxis range={[120, 120]} />
          {/* Normal zone: ratio 0.4 - 1.0, RFa 0.5 - 6, LFa 0 - 8 */}
          <ReferenceArea x1={0} x2={6} y1={0.5} y2={6} fill="hsl(140 60% 55% / 0.10)" stroke="hsl(140 60% 55% / 0.40)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
          />
          <Scatter data={[{ x, y, label: "Resting" }]} fill="hsl(35 90% 60%)">
            <Cell fill={ratio >= 0.4 && ratio <= 1.0 ? "hsl(140 60% 55%)" : ratio < 0.4 ? "hsl(0 72% 62%)" : "hsl(35 90% 60%)"} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { swatch: "hsl(140 60% 55% / 0.30)", label: "Low-normal window (ratio 0.4–1.0)" },
          { swatch: "hsl(0 72% 62%)", label: "Advanced dysfunction (ratio < 0.4)" },
        ]}
      />
    </MiniCard>
  );
}

// --- 2. Deep-Breathing RFa vs Age -----------------------------------------

function DeepBreathingRfa({ mpg, age }: { mpg: MultiParameterGraphical; age: number }) {
  const val = mpg.scatter.dbRFa;
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
      title="Deep Breathing RFa vs Age"
      subtitle={`Your RFa: ${val.toFixed(2)} · Age ${age} band: ${band.lo.toFixed(2)}–${band.hi.toFixed(2)}`}
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
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            label={{ value: "Age (years)", fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="rfa"
            domain={[0, Math.max(10, band.hi * 1.3, val * 1.3)]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            width={44}
            label={{ value: "RFa (bpm²)", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
          />
          {/* Age-normal band: clinical green = within norm. Outside band = gray/red flag. */}
          {bandData.map((b) => (
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
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
          />
          <Scatter
            data={[{ age, rfa: val }]}
            fill={inBand ? "hsl(140 60% 55%)" : val < band.lo ? "hsl(0 72% 62%)" : "hsl(35 90% 60%)"}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { swatch: "hsl(140 60% 50% / 0.45)", label: "Age-normal band" },
          { swatch: "hsl(148 16% 60%)", label: "Outside band" },
          { swatch: "hsl(0 72% 62%)", label: "Below normal" },
        ]}
      />
    </MiniCard>
  );
}

// --- 3. Valsalva LFa vs Age -----------------------------------------------

function ValsalvaLfa({ mpg, age }: { mpg: MultiParameterGraphical; age: number }) {
  const val = mpg.scatter.valsalvaLFa;
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
      title="Valsalva LFa vs Age"
      subtitle={`Your LFa: ${val.toFixed(2)} · Age ${age} band: ${band.lo.toFixed(2)}–${band.hi.toFixed(2)}`}
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
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            label={{ value: "Age (years)", fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideBottom", offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="lfa"
            domain={[0, Math.max(20, band.hi * 1.3, val * 1.3)]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            width={44}
            label={{ value: "LFa (bpm²)", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
          />
          {/* Age-normal band: green = within norm. Outside band = gray/red flag. */}
          {bandData.map((b) => (
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
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
          />
          <Scatter
            data={[{ age, lfa: val }]}
            fill={inBand ? "hsl(140 60% 55%)" : val > band.hi ? "hsl(0 72% 62%)" : "hsl(35 90% 60%)"}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { swatch: "hsl(140 60% 50% / 0.45)", label: "Age-normal band" },
          { swatch: "hsl(148 16% 60%)", label: "Outside band" },
          { swatch: "hsl(0 72% 62%)", label: "Above normal (stroke-risk signal)" },
        ]}
      />
    </MiniCard>
  );
}

// --- 4. Stand Response -----------------------------------------------------

function StandResponse({ mpg }: { mpg: MultiParameterGraphical }) {
  const data = [
    { label: "Stand LFa", value: mpg.scatter.standLFa, target: 3.0 },
    { label: "Stand RFa", value: mpg.scatter.standRFa, target: 1.5 },
  ];

  const maxV = Math.max(...data.map((d) => Math.max(d.value, d.target))) * 1.3;

  return (
    <MiniCard
      title="Stand Response (Phase F)"
      subtitle="Ideal: RFa drops first, LFa rises second"
      chartKey="standResponse"
      testId="chart-stand-response"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="category"
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            allowDuplicatedCategory={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            domain={[0, maxV]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            width={44}
            label={{ value: "bpm²", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
          />
          <Scatter data={data} fill="hsl(244 114 182)">
            {data.map((d, i) => (
              <Cell key={i} fill={d.label === "Stand LFa" ? "hsl(0 72% 51%)" : "hsl(217 91% 55%)"} />
            ))}
          </Scatter>
          {/* target markers */}
          <Scatter data={data.map((d) => ({ label: d.label, value: d.target }))} fill="transparent" shape="cross" line={false}>
            {data.map((_, i) => (
              <Cell key={`t${i}`} fill="hsl(var(--foreground) / 0.6)" />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { swatch: "hsl(0 72% 51%)", label: "LFa — Sympathetic" },
          { swatch: "hsl(217 91% 55%)", label: "RFa — Parasympathetic" },
          { swatch: "hsl(var(--foreground) / 0.6)", label: "Target marker (×)" },
        ]}
      />
    </MiniCard>
  );
}

// --- 5. RFa % Change (Excess) ---------------------------------------------

function RfaExcess({ mpg }: { mpg: MultiParameterGraphical }) {
  const valsalva = mpg.scatter.rfaChangeValsalvaPct;
  const stand = mpg.scatter.rfaChangeStandPct;

  const data = [
    { label: "Valsalva (A→D)", value: valsalva, expected: -40, expectedLabel: "expected: ≤ -30%" },
    { label: "Stand (A→F)",    value: stand,    expected: -50, expectedLabel: "expected: ≤ -40%" },
  ];

  const maxAbs = Math.max(100, ...data.map((d) => Math.abs(d.value)));

  return (
    <MiniCard
      title="RFa Analysis — Parasympathetic Excess"
      subtitle="% change in RFa from baseline during challenge"
      chartKey="rfaExcess"
      testId="chart-rfa-excess"
    >
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.15)" strokeDasharray="2 4" />
          <XAxis
            type="category"
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            allowDuplicatedCategory={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            domain={[-maxAbs, maxAbs]}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            width={44}
            label={{ value: "% change", angle: -90, fill: "hsl(var(--muted-foreground))", fontSize: 10, position: "insideLeft" }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ReferenceArea y1={0} y2={maxAbs} fill="hsl(0 72% 62% / 0.08)" />
          <ReferenceArea y1={-maxAbs} y2={-20} fill="hsl(140 60% 55% / 0.08)" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
            formatter={(v: number) => [`${v.toFixed(0)}%`, "Change"]}
          />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.value > 0 ? "hsl(0 72% 62%)" : d.value <= -20 ? "hsl(140 60% 55%)" : "hsl(35 90% 60%)"}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <LegendRow
        items={[
          { swatch: "hsl(140 60% 55% / 0.30)", label: "Expected zone (RFa drops on challenge)" },
          { swatch: "hsl(0 72% 62% / 0.30)", label: "Excess zone (RFa rises — parasympathetic excess)" },
        ]}
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
  children,
}: {
  title: string;
  subtitle?: string;
  chartKey: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-background/40 border border-border/20 p-4" data-testid={testId}>
      <div className="mb-2">
        <div className="text-[12px] font-semibold text-foreground/90">{title}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">{subtitle}</div>}
      </div>
      {children}
      <ColomboExplainer chartKey={chartKey} />
    </div>
  );
}

function LegendRow({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.swatch }} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
