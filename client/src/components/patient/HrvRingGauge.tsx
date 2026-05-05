import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

interface HrvRingGaugeProps {
  /** 0-100 wellness score */
  value: number;
  /** label e.g. "Optimal" */
  status: string;
  /** small caption text */
  caption?: string;
}

/**
 * HRV-style ring gauge with luminous arc, count-up number and a tiny ECG line
 * underneath. Inspired by the user's iPhone reference image.
 */
export function HrvRingGauge({ value, status, caption }: HrvRingGaugeProps) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const target = Math.max(0, Math.min(100, value));
    const start = performance.now();
    const dur = 1400;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(target * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);

  const r = 100;
  const c = 2 * Math.PI * r;
  // 3/4 arc
  const arcSpan = 0.75;
  const arcTotal = c * arcSpan;
  const filled = arcTotal * (shown / 100);

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 260 }} data-testid="hrv-ring">
      <svg viewBox="0 0 240 240" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id="hrv-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="hsl(190 95% 70%)" />
            <stop offset="50%" stopColor="hsl(185 95% 55%)" />
            <stop offset="100%" stopColor="hsl(195 95% 45%)" />
          </linearGradient>
          <filter id="hrv-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx="120" cy="120" r={r}
          fill="none"
          stroke="hsl(200 25% 20% / 0.5)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arcTotal} ${c - arcTotal}`}
          transform="rotate(135 120 120)"
        />
        {/* Filled arc */}
        <motion.circle
          cx="120" cy="120" r={r}
          fill="none"
          stroke="url(#hrv-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform="rotate(135 120 120)"
          filter="url(#hrv-glow)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        />
        {/* Tip dot */}
        {!reduce && (
          <motion.circle
            cx="120" cy="120" r="4"
            fill="hsl(190 95% 75%)"
            style={{ filter: "drop-shadow(0 0 8px hsl(190 95% 65%))" }}
            transform={`rotate(${135 + 270 * (shown / 100)} 120 120)`}
            initial={false}
          >
            <animate attributeName="cx" from="120" to="120" />
          </motion.circle>
        )}

        {/* Tick marks */}
        {[...Array(40)].map((_, i) => {
          const a = (135 + (i / 39) * 270) * Math.PI / 180;
          const inR = 86, outR = 90;
          const x1 = 120 + Math.cos(a) * inR;
          const y1 = 120 + Math.sin(a) * inR;
          const x2 = 120 + Math.cos(a) * outR;
          const y2 = 120 + Math.sin(a) * outR;
          const active = i / 39 <= shown / 100;
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={active ? "hsl(195 90% 65%)" : "hsl(200 25% 25%)"}
              strokeWidth="1"
              opacity={active ? 0.7 : 0.4}
            />
          );
        })}
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="ps-overline" style={{ color: "hsl(185 80% 70%)", fontSize: 11 }}>
          ANS Score
        </div>
        <div
          className="ps-text-mono font-bold tabular-nums leading-none"
          style={{ fontSize: 56, color: "white", textShadow: "0 0 24px hsl(185 95% 60% / 0.6)" }}
          data-testid="hrv-value"
        >
          {Math.round(shown)}
        </div>
        {/* Mini ECG */}
        <svg viewBox="0 0 120 24" width="110" height="22" className="mt-1.5" aria-hidden="true">
          <motion.path
            d="M 0 12 L 14 12 L 20 4 L 26 20 L 32 12 L 46 12 L 52 9 L 58 12 L 72 12 L 78 6 L 84 18 L 90 12 L 120 12"
            fill="none"
            stroke="hsl(185 90% 65%)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={reduce ? { pathLength: 1, opacity: 0.9 } : { pathLength: [0, 1, 1], opacity: [0, 1, 0.7] }}
            transition={reduce ? { duration: 1 } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            style={{ filter: "drop-shadow(0 0 4px hsl(185 95% 60%))" }}
          />
        </svg>
        <div className="text-[12px] font-semibold mt-1" style={{ color: "hsl(185 85% 70%)" }} data-testid="hrv-status">
          {status}
        </div>
        {caption && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{caption}</div>
        )}
      </div>
    </div>
  );
}
