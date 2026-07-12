import { useState } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { BodySystemImpact } from "@shared/schema";

interface BodyHeatmapProps {
  bodySystemImpact: BodySystemImpact[];
}

type SystemKey = BodySystemImpact["system"];

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

// Declared BEFORE `REGIONS` because the `immune`/`musculoskeletal` `hits` JSX
// below is evaluated eagerly when the REGIONS object literal is built at module
// load — referencing these constants after REGIONS would be a temporal-dead-zone
// ReferenceError that crashes the portal on import.
const IMMUNE_NODES: ReadonlyArray<readonly [number, number]> = [
  [82, 64], [118, 64],   // neck
  [64, 112], [136, 112], // underarms
  [88, 230], [112, 230], // groin
];

const LIMB_PATHS = [
  "M66 90 Q49 98 45 150 L43 204 Q47 210 53 208 L57 152 Q61 114 70 102 Z",   // left arm
  "M134 90 Q151 98 155 150 L157 204 Q153 210 147 208 L143 152 Q139 114 130 102 Z", // right arm
  "M82 240 L76 330 Q76 346 88 346 L93 346 Q97 330 99 250 Z",   // left leg
  "M118 240 L124 330 Q124 346 112 346 L107 346 Q103 330 101 250 Z", // right leg
];

/**
 * Anatomical region geometry.
 *
 * `organs(color)` draws the visible, coloured anatomy for a body system.
 * `hits` are transparent shapes that (a) enlarge the clickable/focusable
 * target and (b) double as the focus/selection ring (their parent <g> adds a
 * stroke when active). Regions are only rendered for systems that appear in
 * the report's `bodySystemImpact` — i.e. mapped ONLY to existing findings.
 *
 * viewBox is 0 0 200 360 (front-facing figure).
 */
const REGIONS: Record<SystemKey, { organs: (color: string) => ReactNode; hits: ReactNode }> = {
  nervous: {
    organs: (c) => (
      <>
        <path
          d="M86 32 Q84 22 100 22 Q116 22 114 32 Q120 39 113 46 Q100 54 87 46 Q80 39 86 32 Z"
          fill={c}
          opacity="0.92"
        />
        <path d="M100 24 V52" stroke="hsl(210 30% 8% / 0.35)" strokeWidth="1.4" fill="none" />
        <path d="M93 28 Q97 38 93 48" stroke="hsl(210 30% 8% / 0.28)" strokeWidth="1.2" fill="none" />
        <path d="M107 28 Q103 38 107 48" stroke="hsl(210 30% 8% / 0.28)" strokeWidth="1.2" fill="none" />
      </>
    ),
    hits: <ellipse cx="100" cy="38" rx="24" ry="28" />,
  },
  endocrine: {
    organs: (c) => (
      <>
        {/* thyroid at the throat */}
        <path d="M92 70 Q100 66 108 70 Q108 77 100 77 Q92 77 92 70 Z" fill={c} opacity="0.92" />
        {/* adrenal markers atop the kidneys */}
        <circle cx="88" cy="162" r="3.4" fill={c} opacity="0.9" />
        <circle cx="112" cy="162" r="3.4" fill={c} opacity="0.9" />
      </>
    ),
    hits: <ellipse cx="100" cy="72" rx="16" ry="10" />,
  },
  respiratory: {
    organs: (c) => (
      <>
        <path
          d="M84 104 Q72 108 71 128 Q70 148 80 156 Q87 158 87 148 L87 108 Q87 104 84 104 Z"
          fill={c}
          opacity="0.85"
        />
        <path
          d="M116 104 Q128 108 129 128 Q130 148 120 156 Q113 158 113 148 L113 108 Q113 104 116 104 Z"
          fill={c}
          opacity="0.85"
        />
      </>
    ),
    hits: (
      <>
        <ellipse cx="79" cy="130" rx="12" ry="26" />
        <ellipse cx="121" cy="130" rx="12" ry="26" />
      </>
    ),
  },
  cardiovascular: {
    organs: (c) => (
      <path
        d="M100 134 C100 134 84 123 84 112 C84 105 91 102 96 107 C98 109 100 112 100 112 C100 112 102 109 104 107 C109 102 116 105 116 112 C116 123 100 134 100 134 Z"
        fill={c}
        opacity="0.92"
      />
    ),
    hits: <ellipse cx="100" cy="118" rx="19" ry="17" />,
  },
  digestive: {
    organs: (c) => (
      <>
        <path
          d="M80 156 Q100 150 120 156 Q124 176 116 194 Q100 202 84 194 Q76 176 80 156 Z"
          fill={c}
          opacity="0.9"
        />
        <path d="M86 178 Q100 187 114 178" stroke="hsl(210 30% 8% / 0.25)" strokeWidth="1.4" fill="none" />
      </>
    ),
    hits: <ellipse cx="100" cy="174" rx="22" ry="22" />,
  },
  immune: {
    // Lymphatic nodes: neck, underarms, groin — the immune system is systemic,
    // so it is represented by node clusters rather than a single organ.
    organs: (c) =>
      IMMUNE_NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={c} opacity="0.9" />
      )),
    hits: (
      <>
        {IMMUNE_NODES.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="8" />
        ))}
      </>
    ),
  },
  musculoskeletal: {
    // Limbs. When this finding is absent the limbs stay neutral (silhouette only).
    organs: (c) =>
      LIMB_PATHS.map((d, i) => <path key={i} d={d} fill={c} opacity="0.8" />),
    hits: <>{LIMB_PATHS.map((d, i) => <path key={i} d={d} />)}</>,
  },
};

// Back-to-front paint order so overlapping organs layer sensibly.
const RENDER_ORDER: SystemKey[] = [
  "musculoskeletal",
  "immune",
  "respiratory",
  "digestive",
  "endocrine",
  "cardiovascular",
  "nervous",
];

export function BodyHeatmap({ bodySystemImpact }: BodyHeatmapProps) {
  const [selected, setSelected] = useState<SystemKey | null>(null);
  const [active, setActive] = useState<SystemKey | null>(null); // hover or keyboard focus
  const prefersReducedMotion = useReducedMotion();

  const getImpact = (system: SystemKey): BodySystemImpact | undefined =>
    bodySystemImpact.find((b) => b.system === system);

  const present = RENDER_ORDER.filter((s) => !!getImpact(s));
  const selectedImp = selected ? getImpact(selected) : undefined;

  const toggle = (system: SystemKey) =>
    setSelected((prev) => (prev === system ? null : system));

  const onRegionKey = (e: React.KeyboardEvent<SVGGElement>, system: SystemKey) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      toggle(system);
    } else if (e.key === "Escape") {
      setSelected(null);
    }
  };

  const sign = (n: number) => (n > 0 ? "+" : "");

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.5, delay: prefersReducedMotion ? 0 : 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="body-heatmap"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Body System Impact
      </h3>

      <div className="flex flex-col lg:flex-row items-center lg:items-start gap-6">
        {/* Accessible anatomical figure */}
        <div className="relative flex-shrink-0 flex flex-col items-center">
          <svg
            viewBox="0 0 200 360"
            className="w-[128px] lg:w-[150px]"
            aria-label="Interactive body map of autonomic impact by body system"
          >
            <title>Body-system autonomic impact map</title>
            <desc>
              A front-facing body outline. Each highlighted region corresponds to a measured
              body-system impact and can be activated to read its value and description. The same
              information is listed beside the figure.
            </desc>

            {/* Neutral silhouette (context only, not interactive) */}
            <g aria-hidden="true" fill="hsl(210 14% 22%)" opacity="0.6">
              <ellipse cx="100" cy="38" rx="24" ry="28" />
              <rect x="91" y="62" width="18" height="14" rx="5" />
              <path d="M64 88 Q100 78 136 88 L127 196 Q100 206 73 196 Z" />
              <path d="M75 194 L125 194 L118 240 Q100 248 82 240 Z" />
              {LIMB_PATHS.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>

            {/* Interactive regions — only those present in the findings */}
            {present.map((system) => {
              const imp = getImpact(system)!;
              const def = REGIONS[system];
              const color = impactColor(imp.impact);
              const isSelected = selected === system;
              const ring = active === system || isSelected;
              return (
                <g
                  key={system}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${imp.label}: impact ${sign(imp.impact)}${imp.impact}, ${impactLabel(
                    imp.impact,
                  )}. ${isSelected ? "Selected. Activate to hide details." : "Activate for details."}`}
                  onClick={() => toggle(system)}
                  onKeyDown={(e) => onRegionKey(e, system)}
                  onFocus={() => setActive(system)}
                  onBlur={() => setActive((a) => (a === system ? null : a))}
                  onMouseEnter={() => setActive(system)}
                  onMouseLeave={() => setActive((a) => (a === system ? null : a))}
                  className="cursor-pointer outline-none"
                  style={{ filter: `drop-shadow(0 0 6px ${impactGlow(imp.impact)})` }}
                  data-testid={`body-region-${system}`}
                >
                  <title>{`${imp.label} — ${impactLabel(imp.impact)} (${sign(imp.impact)}${imp.impact})`}</title>
                  {def.organs(color)}
                  {/* Transparent hit area + focus/selection ring */}
                  <g
                    fill="transparent"
                    stroke={ring ? "hsl(0 0% 100%)" : "none"}
                    strokeWidth={ring ? 2.5 : 0}
                    style={ring ? { filter: "drop-shadow(0 0 4px hsl(0 0% 100% / 0.7))" } : undefined}
                  >
                    {def.hits}
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Inline detail (replaces overflow tooltip — always in view + a11y) */}
          <AnimatePresence>
            {selectedImp && (
              <motion.div
                key={selectedImp.system}
                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                role="status"
                aria-live="polite"
                className="mt-4 w-[190px] rounded-xl border border-border/40 p-3 text-left"
                style={{ background: "hsl(210 18% 10%)", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.4)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold" style={{ color: impactColor(selectedImp.impact) }}>
                    {selectedImp.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-muted-foreground hover:text-foreground text-sm leading-none"
                    aria-label="Dismiss details"
                  >
                    ×
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-1 mb-2">
                  {selectedImp.description}
                </p>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Impact</span>
                  <span className="font-medium tabular-nums" style={{ color: impactColor(selectedImp.impact) }}>
                    {sign(selectedImp.impact)}{selectedImp.impact} — {impactLabel(selectedImp.impact)}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* System mini-meters list — each row selects its region too */}
        <div className="flex-1 w-full space-y-2.5">
          {bodySystemImpact.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No body-system impacts were recorded for this study.
            </p>
          )}
          {bodySystemImpact.map((sys, i) => {
            const isSelected = selected === sys.system;
            return (
              <motion.div
                key={sys.system}
                initial={prefersReducedMotion ? false : { opacity: 0, x: 12 }}
                animate={prefersReducedMotion ? {} : { opacity: 1, x: 0 }}
                transition={{ delay: prefersReducedMotion ? 0 : 0.1 * i }}
              >
                <button
                  type="button"
                  onClick={() => toggle(sys.system)}
                  onMouseEnter={() => setActive(sys.system)}
                  onMouseLeave={() => setActive((a) => (a === sys.system ? null : a))}
                  aria-pressed={isSelected}
                  className="w-full text-left rounded-md px-1.5 py-1 -mx-1.5 space-y-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40 hover:bg-white/[0.04]"
                  style={isSelected ? { background: "hsl(0 0% 100% / 0.06)" } : undefined}
                  data-testid={`body-row-${sys.system}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{sys.label}</span>
                    <span className="font-medium tabular-nums text-[11px]" style={{ color: impactColor(sys.impact) }}>
                      {sign(sys.impact)}{sys.impact}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[hsl(210_12%_15%)] overflow-hidden">
                    <motion.div
                      initial={prefersReducedMotion ? false : { width: 0 }}
                      animate={{ width: `${Math.min(100, Math.abs(sys.impact))}%` }}
                      transition={{ delay: prefersReducedMotion ? 0 : 0.2 + 0.05 * i, duration: prefersReducedMotion ? 0 : 0.8, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: impactColor(sys.impact) }}
                    />
                  </div>
                </button>
              </motion.div>
            );
          })}
          {bodySystemImpact.length > 0 && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Select a region on the figure — or a row above — for details. Only measured systems are shown.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
