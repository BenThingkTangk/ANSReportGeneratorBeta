import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

interface AnimatedVennProps {
  sympathetic: number;        // 0-100
  parasympathetic: number;    // 0-100
  balanceLabel?: string;      // e.g. "Optimal" / "Skewed" / "Stressed"
}

/**
 * Cinematic Venn diagram — Sympathetic (orange) ⋂ Parasympathetic (cyan)
 * with a luminous "Balance Zone" lens at the intersection.
 *
 * Inspired by the PhysioPS reference imagery: glowing edges, subtle particle
 * pulse, gentle breathing animation. Drives the patient hero section.
 */
export function AnimatedVenn({ sympathetic, parasympathetic, balanceLabel }: AnimatedVennProps) {
  const reduce = useReducedMotion();

  // Skew factor: how unbalanced the system is (0 = perfect balance, 1 = extreme)
  const total = sympathetic + parasympathetic || 1;
  const sPct = Math.round((sympathetic / total) * 100);
  const pPct = 100 - sPct;
  const skew = Math.abs(sPct - 50) / 50;          // 0..1
  // Circle separation widens as balance worsens
  const sep = useMemo(() => 90 + skew * 50, [skew]);

  return (
    <div
      className="relative w-full max-w-md mx-auto select-none"
      style={{ aspectRatio: "1.35 / 1" }}
      data-testid="animated-venn"
    >
      <svg viewBox="0 0 400 300" width="100%" height="100%" aria-hidden="true">
        <defs>
          {/* Sympathetic radial glow */}
          <radialGradient id="sympGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="hsl(18 90% 58%)" stopOpacity="0.0" />
            <stop offset="70%" stopColor="hsl(18 90% 58%)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="hsl(18 90% 58%)" stopOpacity="0.0" />
          </radialGradient>
          <radialGradient id="parasymGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="hsl(185 85% 55%)" stopOpacity="0.0" />
            <stop offset="70%" stopColor="hsl(185 85% 55%)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="hsl(185 85% 55%)" stopOpacity="0.0" />
          </radialGradient>
          {/* Balance lens — luminous overlap */}
          <radialGradient id="balanceLens" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="hsl(195 90% 92%)" stopOpacity="0.85" />
            <stop offset="60%" stopColor="hsl(195 80% 80%)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(195 80% 70%)" stopOpacity="0.0" />
          </radialGradient>
          {/* Stroke gradients */}
          <linearGradient id="sympStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="hsl(18 95% 65%)" />
            <stop offset="100%" stopColor="hsl(15 100% 50%)" />
          </linearGradient>
          <linearGradient id="parasymStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="hsl(187 100% 70%)" />
            <stop offset="100%" stopColor="hsl(190 90% 45%)" />
          </linearGradient>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient halos */}
        <circle cx={200 - sep} cy="150" r="120" fill="url(#sympGlow)" />
        <circle cx={200 + sep} cy="150" r="120" fill="url(#parasymGlow)" />

        {/* Sympathetic ring */}
        <motion.circle
          cx={200 - sep}
          cy="150"
          r="100"
          fill="none"
          stroke="url(#sympStroke)"
          strokeWidth="2.4"
          filter="url(#softGlow)"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={reduce ? { opacity: 1, scale: 1 } : { opacity: 1, scale: [1, 1.012, 1] }}
          transition={reduce
            ? { duration: 0.6 }
            : { opacity: { duration: 0.8 }, scale: { duration: 4, repeat: Infinity, ease: "easeInOut" } }}
          style={{ transformOrigin: `${200 - sep}px 150px` }}
        />
        {/* Parasympathetic ring */}
        <motion.circle
          cx={200 + sep}
          cy="150"
          r="100"
          fill="none"
          stroke="url(#parasymStroke)"
          strokeWidth="2.4"
          filter="url(#softGlow)"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={reduce ? { opacity: 1, scale: 1 } : { opacity: 1, scale: [1, 1.015, 1] }}
          transition={reduce
            ? { duration: 0.6 }
            : { opacity: { duration: 0.8, delay: 0.1 }, scale: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.7 } }}
          style={{ transformOrigin: `${200 + sep}px 150px` }}
        />

        {/* Balance lens — only overlap area */}
        <ellipse
          cx="200"
          cy="150"
          rx={Math.max(12, 100 - sep + 22)}
          ry="100"
          fill="url(#balanceLens)"
          opacity={Math.max(0.1, 1 - skew * 1.2)}
        />

        {/* Floating particles (stylistic) */}
        {!reduce && [...Array(10)].map((_, i) => {
          const angle = (i / 10) * Math.PI * 2;
          const r = 110 + (i % 3) * 8;
          const cx = 200 + Math.cos(angle) * r;
          const cy = 150 + Math.sin(angle) * r * 0.55;
          const color = i % 2 === 0 ? "hsl(18 90% 60%)" : "hsl(185 85% 60%)";
          return (
            <motion.circle
              key={i}
              cx={cx}
              cy={cy}
              r="1.5"
              fill={color}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.85, 0], scale: [0.6, 1.1, 0.6] }}
              transition={{ duration: 2.4 + (i % 4) * 0.3, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
            />
          );
        })}
      </svg>

      {/* Text overlays */}
      <div className="absolute inset-0 grid grid-cols-3 items-center pointer-events-none">
        {/* Left: Sympathetic */}
        <div className="text-center">
          <div className="ps-overline" style={{ color: "hsl(18 90% 65%)", fontSize: 10 }}>
            Sympathetic
          </div>
          <div
            className="ps-text-mono font-bold"
            style={{ fontSize: 30, color: "hsl(18 90% 70%)", textShadow: "0 0 14px hsl(18 90% 60% / 0.6)" }}
            data-testid="venn-symp"
          >
            {sPct}%
          </div>
        </div>
        {/* Center: Balance Zone */}
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] font-medium" style={{ color: "hsl(200 25% 90%)" }}>
            Balance
          </div>
          <div className="text-[12px] font-semibold" style={{ color: "hsl(200 80% 90%)" }}>
            {balanceLabel ?? "Zone"}
          </div>
        </div>
        {/* Right: Parasympathetic */}
        <div className="text-center">
          <div className="ps-overline" style={{ color: "hsl(185 85% 65%)", fontSize: 10 }}>
            Parasympathetic
          </div>
          <div
            className="ps-text-mono font-bold"
            style={{ fontSize: 30, color: "hsl(187 100% 70%)", textShadow: "0 0 14px hsl(185 85% 60% / 0.6)" }}
            data-testid="venn-parasym"
          >
            {pPct}%
          </div>
        </div>
      </div>
    </div>
  );
}
