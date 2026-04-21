import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { BodySystemImpact } from "@shared/schema";

interface BodyHeatmapProps {
  bodySystemImpact: BodySystemImpact[];
}

// Map system name to a region identifier
const systemToRegion: Record<string, string> = {
  cardiovascular: "chest",
  respiratory: "lungs",
  digestive: "abdomen",
  nervous: "head",
  endocrine: "spine",
  musculoskeletal: "limbs",
  immune: "immune",
};

function impactColor(impact: number): string {
  if (impact >= 40)  return "hsl(140 60% 50%)";
  if (impact >= 15)  return "hsl(160 65% 45%)";
  if (impact >= -14) return "hsl(185 30% 40%)";
  if (impact >= -39) return "hsl(35 80% 52%)";
  return "hsl(0 70% 52%)";
}

function impactGlow(impact: number): string {
  if (impact >= 15)  return "hsl(140 60% 50% / 0.5)";
  if (impact >= -14) return "hsl(185 30% 40% / 0.3)";
  return "hsl(0 70% 52% / 0.5)";
}

function impactLabel(impact: number): string {
  if (impact >= 40)  return "Excellent";
  if (impact >= 15)  return "Good";
  if (impact >= -14) return "Neutral";
  if (impact >= -39) return "Mildly Affected";
  return "Significantly Affected";
}

interface TooltipInfo {
  x: number;
  y: number;
  system: BodySystemImpact;
}

export function BodyHeatmap({ bodySystemImpact }: BodyHeatmapProps) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  const getImpact = (system: string): BodySystemImpact | undefined =>
    bodySystemImpact.find(b => b.system === system);

  const regionColor = (system: string) => {
    const imp = getImpact(system);
    return imp ? impactColor(imp.impact) : "hsl(210 12% 22%)";
  };

  const regionGlow = (system: string) => {
    const imp = getImpact(system);
    return imp ? impactGlow(imp.impact) : "transparent";
  };

  const handleClick = (system: string, cx: number, cy: number) => {
    const imp = getImpact(system);
    if (!imp) return;
    setTooltip(prev => prev?.system.system === system ? null : { x: cx, y: cy, system: imp });
  };

  const regionProps = (system: string, cx: number, cy: number) => ({
    onClick: () => handleClick(system, cx, cy),
    style: { cursor: "pointer", filter: `drop-shadow(0 0 6px ${regionGlow(system)})` },
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="body-heatmap"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Body System Impact
      </h3>

      <div className="flex flex-col lg:flex-row items-center gap-6">
        {/* SVG Human Figure */}
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 160 360" className="w-[120px] lg:w-[140px]" aria-label="Body system heatmap">
            {/* Head — nervous */}
            <g {...regionProps("nervous", 80, 28)}>
              <ellipse cx="80" cy="30" rx="22" ry="26" fill={regionColor("nervous")} opacity="0.85" />
              {/* Face features */}
              <ellipse cx="73" cy="27" rx="3" ry="3.5" fill="hsl(210 20% 8% / 0.5)" />
              <ellipse cx="87" cy="27" rx="3" ry="3.5" fill="hsl(210 20% 8% / 0.5)" />
              <path d="M74 37 Q80 41 86 37" stroke="hsl(210 20% 8% / 0.4)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </g>

            {/* Neck */}
            <rect x="73" y="55" width="14" height="12" rx="3" fill="hsl(210 15% 20%)" />

            {/* Torso */}
            <rect x="52" y="67" width="56" height="76" rx="10" fill="hsl(210 15% 18%)" />

            {/* Chest / cardiovascular */}
            <g {...regionProps("cardiovascular", 80, 88)}>
              <ellipse cx="80" cy="88" rx="22" ry="20" fill={regionColor("cardiovascular")} opacity="0.85" />
              {/* Heart icon */}
              <path d="M80 96 C80 96 68 87 68 81 C68 77 72 74 76 77 C78 79 80 81 80 81 C80 81 82 79 84 77 C88 74 92 77 92 81 C92 87 80 96 80 96Z" fill="hsl(210 20% 8% / 0.35)" />
            </g>

            {/* Lungs / respiratory */}
            <g {...regionProps("respiratory", 80, 112)}>
              <ellipse cx="65" cy="112" rx="11" ry="15" fill={regionColor("respiratory")} opacity="0.8" />
              <ellipse cx="95" cy="112" rx="11" ry="15" fill={regionColor("respiratory")} opacity="0.8" />
            </g>

            {/* Abdomen / digestive */}
            <g {...regionProps("digestive", 80, 148)}>
              <ellipse cx="80" cy="148" rx="22" ry="18" fill={regionColor("digestive")} opacity="0.85" />
            </g>

            {/* Lower torso / endocrine */}
            <g {...regionProps("endocrine", 80, 170)}>
              <rect x="58" y="162" width="44" height="22" rx="7" fill={regionColor("endocrine")} opacity="0.8" />
            </g>

            {/* Left arm */}
            <g {...regionProps("musculoskeletal", 80, 120)}>
              <rect x="28" y="70" width="20" height="68" rx="9" fill={regionColor("musculoskeletal")} opacity="0.8" />
              <rect x="112" y="70" width="20" height="68" rx="9" fill={regionColor("musculoskeletal")} opacity="0.8" />
              {/* Hands */}
              <ellipse cx="38" cy="143" rx="9" ry="7" fill={regionColor("musculoskeletal")} opacity="0.75" />
              <ellipse cx="122" cy="143" rx="9" ry="7" fill={regionColor("musculoskeletal")} opacity="0.75" />
            </g>

            {/* Legs */}
            <g {...regionProps("immune", 80, 260)}>
              <rect x="56" y="186" width="22" height="90" rx="9" fill={regionColor("immune")} opacity="0.8" />
              <rect x="82" y="186" width="22" height="90" rx="9" fill={regionColor("immune")} opacity="0.8" />
              {/* Feet */}
              <ellipse cx="67" cy="281" rx="11" ry="6" fill={regionColor("immune")} opacity="0.75" />
              <ellipse cx="93" cy="281" rx="11" ry="6" fill={regionColor("immune")} opacity="0.75" />
            </g>

            {/* Spine accent */}
            <line x1="80" y1="67" x2="80" y2="183" stroke="hsl(210 20% 8% / 0.25)" strokeWidth="2" strokeDasharray="3 4" />
          </svg>

          {/* Tooltip */}
          <AnimatePresence>
            {tooltip && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-48 rounded-xl border border-border/40 p-3 z-20 text-left"
                style={{ background: "hsl(210 18% 10%)", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.4)" }}
              >
                <p className="text-xs font-semibold mb-0.5" style={{ color: impactColor(tooltip.system.impact) }}>
                  {tooltip.system.label}
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{tooltip.system.description}</p>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Impact</span>
                  <span className="font-medium tabular-nums" style={{ color: impactColor(tooltip.system.impact) }}>
                    {tooltip.system.impact > 0 ? "+" : ""}{tooltip.system.impact} — {impactLabel(tooltip.system.impact)}
                  </span>
                </div>
                <button onClick={() => setTooltip(null)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground">dismiss</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* System mini-meters list */}
        <div className="flex-1 w-full space-y-2.5">
          {bodySystemImpact.map((sys, i) => (
            <motion.div
              key={sys.system}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground capitalize">{sys.label}</span>
                <span className="font-medium tabular-nums text-[11px]" style={{ color: impactColor(sys.impact) }}>
                  {sys.impact > 0 ? "+" : ""}{sys.impact}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[hsl(210_12%_15%)] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.abs(sys.impact))}%` }}
                  transition={{ delay: 0.2 + 0.05 * i, duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: impactColor(sys.impact) }}
                />
              </div>
            </motion.div>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1">Tap a region on the figure for details.</p>
        </div>
      </div>
    </motion.div>
  );
}
