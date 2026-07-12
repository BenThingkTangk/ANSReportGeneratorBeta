import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

interface AutonomicBalanceGaugeProps {
  sympathetic: number | null;         // 0..100 (% of total); null = not assessed
  parasympathetic: number | null;     // 0..100 (% of total); null = not assessed
  hrvRmssdMs: number;          // RMSSD in milliseconds (vagal HRV)
  hrvSdnnMs: number;           // SDNN in milliseconds (total HRV)
  lfHfRatio: number | null;           // LF/HF ratio (sympathovagal balance, ~0.5–2.0 normal); null = not assessed
  balanceLabel?: string;       // tier label
  /**
   * When false, the sympathetic/parasympathetic spectral split is NOT available
   * (e.g. raw ECG-only .ans). The gauge must render "Not assessed" instead of
   * fabricating a 0/100 percentage split. HR-derived HRV (RMSSD/SDNN) is still
   * shown because it is measured from the ECG.
   */
  available?: boolean;
}

/**
 * Cinematic dual-ring Sympathetic ⋂ Parasympathetic balance gauge.
 *
 * Real per-patient values driven by the parsed .ans file:
 *   • HRV RMSSD (ms)   — top
 *   • Sympathetic %    — left circle
 *   • Parasympathetic % — right circle
 *   • SDNN (ms)        — bottom-left
 *   • LF/HF ratio      — bottom-right
 *
 * The outer dotted arc segments illuminate proportionally to the
 * sympathetic (left, orange) and parasympathetic (right, cyan)
 * percentages, giving a glanceable read of dominance. The center
 * lens swells when balance is healthy and dims when skewed.
 */
export function AutonomicBalanceGauge({
  sympathetic,
  parasympathetic,
  hrvRmssdMs,
  hrvSdnnMs,
  lfHfRatio,
  balanceLabel,
  available = true,
}: AutonomicBalanceGaugeProps) {
  const reduce = useReducedMotion();

  // Spectral split is only meaningful when available AND both inputs are real
  // numbers. Otherwise the gauge shows "Not assessed" — never a coerced 0/100.
  const spectralOk =
    available && typeof sympathetic === "number" && typeof parasympathetic === "number";
  const total = spectralOk ? ((sympathetic as number) + (parasympathetic as number) || 1) : 1;
  const sPct = spectralOk ? Math.round(((sympathetic as number) / total) * 100) : 50;
  const pPct = spectralOk ? 100 - sPct : 50;
  const skew = spectralOk ? Math.abs(sPct - 50) / 50 : 0;

  // ECG-like flowing waveform for the bottom strip
  const wavePath = useMemo(() => buildEcgPath(900, 90, 5), []);
  const wavePath2 = useMemo(() => buildEcgPath(900, 90, 5, 0.5), []);

  // Outer dotted arc — generate tick positions for the half-rings
  const arcTicksLeft = useMemo(() => buildArcTicks(200, 200, 175, 180, 340, 32), []);
  const arcTicksRight = useMemo(() => buildArcTicks(200, 200, 175, 20, 180, 32), []);

  const activeLeft = Math.round((sPct / 100) * arcTicksLeft.length);
  const activeRight = Math.round((pPct / 100) * arcTicksRight.length);

  const fmt1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, "") : "—");

  return (
    <div
      className="relative w-full max-w-xl mx-auto select-none"
      style={{ aspectRatio: "1 / 1.05" }}
      data-testid="autonomic-balance-gauge"
    >
      <svg viewBox="0 0 400 420" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="abg-sympGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(18 95% 60%)" stopOpacity="0.35" />
            <stop offset="60%" stopColor="hsl(18 95% 60%)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="hsl(18 95% 60%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="abg-parasymGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(185 90% 60%)" stopOpacity="0.35" />
            <stop offset="60%" stopColor="hsl(185 90% 60%)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="hsl(185 90% 60%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="abg-lens" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(195 95% 92%)" stopOpacity="0.85" />
            <stop offset="60%" stopColor="hsl(195 80% 80%)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(195 80% 70%)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="abg-sympStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(18 100% 70%)" />
            <stop offset="100%" stopColor="hsl(15 95% 50%)" />
          </linearGradient>
          <linearGradient id="abg-parasymStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(187 100% 72%)" />
            <stop offset="100%" stopColor="hsl(190 95% 48%)" />
          </linearGradient>
          <linearGradient id="abg-wave1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(18 95% 60%)" stopOpacity="0.0" />
            <stop offset="20%" stopColor="hsl(18 95% 60%)" stopOpacity="0.9" />
            <stop offset="80%" stopColor="hsl(18 95% 60%)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(18 95% 60%)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="abg-wave2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(185 90% 60%)" stopOpacity="0.0" />
            <stop offset="20%" stopColor="hsl(185 90% 60%)" stopOpacity="0.9" />
            <stop offset="80%" stopColor="hsl(185 90% 60%)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(185 90% 60%)" stopOpacity="0.0" />
          </linearGradient>
          <filter id="abg-softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="abg-glowDot" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* Outer arcs — tick marks (left = sympathetic, right = parasympathetic) */}
        {arcTicksLeft.map((t, i) => {
          const active = i >= arcTicksLeft.length - activeLeft;
          return (
            <motion.rect
              key={`l-${i}`}
              x={t.x - 1}
              y={t.y - 5}
              width="2"
              height="10"
              rx="1"
              transform={`rotate(${t.angle + 90} ${t.x} ${t.y})`}
              fill={active ? "hsl(18 95% 60%)" : "hsl(18 30% 35%)"}
              opacity={active ? 1 : 0.45}
              initial={{ opacity: 0 }}
              animate={
                reduce
                  ? { opacity: active ? 1 : 0.45 }
                  : active
                    ? { opacity: [0.6, 1, 0.6] }
                    : { opacity: 0.45 }
              }
              transition={
                reduce
                  ? { duration: 0.4 }
                  : { duration: 2.6, repeat: Infinity, delay: i * 0.04, ease: "easeInOut" }
              }
            />
          );
        })}
        {arcTicksRight.map((t, i) => {
          const active = i < activeRight;
          return (
            <motion.rect
              key={`r-${i}`}
              x={t.x - 1}
              y={t.y - 5}
              width="2"
              height="10"
              rx="1"
              transform={`rotate(${t.angle + 90} ${t.x} ${t.y})`}
              fill={active ? "hsl(185 90% 60%)" : "hsl(185 30% 35%)"}
              opacity={active ? 1 : 0.45}
              initial={{ opacity: 0 }}
              animate={
                reduce
                  ? { opacity: active ? 1 : 0.45 }
                  : active
                    ? { opacity: [0.6, 1, 0.6] }
                    : { opacity: 0.45 }
              }
              transition={
                reduce
                  ? { duration: 0.4 }
                  : { duration: 2.6, repeat: Infinity, delay: i * 0.04, ease: "easeInOut" }
              }
            />
          );
        })}

        {/* Indicator dots at the active tip of each arc */}
        <motion.circle
          cx={arcTicksLeft[Math.max(0, arcTicksLeft.length - activeLeft)]?.x}
          cy={arcTicksLeft[Math.max(0, arcTicksLeft.length - activeLeft)]?.y}
          r="3.5"
          fill="hsl(18 100% 70%)"
          filter="url(#abg-glowDot)"
          animate={reduce ? {} : { scale: [1, 1.35, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx={arcTicksRight[Math.max(0, activeRight - 1)]?.x}
          cy={arcTicksRight[Math.max(0, activeRight - 1)]?.y}
          r="3.5"
          fill="hsl(187 100% 72%)"
          filter="url(#abg-glowDot)"
          animate={reduce ? {} : { scale: [1, 1.35, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
        />

        {/* Ambient halos */}
        <circle cx="140" cy="200" r="110" fill="url(#abg-sympGlow)" />
        <circle cx="260" cy="200" r="110" fill="url(#abg-parasymGlow)" />

        {/* Sympathetic ring (left) */}
        <motion.circle
          cx="140"
          cy="200"
          r="90"
          fill="none"
          stroke="url(#abg-sympStroke)"
          strokeWidth="2.4"
          filter="url(#abg-softGlow)"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={
            reduce
              ? { opacity: 1, scale: 1 }
              : { opacity: 1, scale: [1, 1.012, 1] }
          }
          transition={
            reduce
              ? { duration: 0.6 }
              : {
                  opacity: { duration: 0.8 },
                  scale: { duration: 4.2, repeat: Infinity, ease: "easeInOut" },
                }
          }
          style={{ transformOrigin: "140px 200px" }}
        />
        {/* Parasympathetic ring (right) */}
        <motion.circle
          cx="260"
          cy="200"
          r="90"
          fill="none"
          stroke="url(#abg-parasymStroke)"
          strokeWidth="2.4"
          filter="url(#abg-softGlow)"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={
            reduce
              ? { opacity: 1, scale: 1 }
              : { opacity: 1, scale: [1, 1.015, 1] }
          }
          transition={
            reduce
              ? { duration: 0.6 }
              : {
                  opacity: { duration: 0.8, delay: 0.1 },
                  scale: { duration: 4.2, repeat: Infinity, ease: "easeInOut", delay: 0.7 },
                }
          }
          style={{ transformOrigin: "260px 200px" }}
        />

        {/* Balance lens at the overlap */}
        <motion.ellipse
          cx="200"
          cy="200"
          rx="34"
          ry="90"
          fill="url(#abg-lens)"
          opacity={Math.max(0.18, 1 - skew * 1.1)}
          animate={
            reduce
              ? {}
              : { opacity: [Math.max(0.18, 1 - skew * 1.1) * 0.85, Math.max(0.18, 1 - skew * 1.1), Math.max(0.18, 1 - skew * 1.1) * 0.85] }
          }
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Flowing ECG strip — orange (sympathetic) on top, cyan (parasympathetic) underneath */}
        <g transform="translate(0,330)" opacity="0.85">
          <motion.path
            d={wavePath}
            fill="none"
            stroke="url(#abg-wave1)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={reduce ? {} : { x: [0, -50, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
          <motion.path
            d={wavePath2}
            fill="none"
            stroke="url(#abg-wave2)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={reduce ? {} : { x: [0, -50, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "linear" }}
          />
          {/* particle field */}
          {!reduce &&
            [...Array(24)].map((_, i) => (
              <motion.circle
                key={`p-${i}`}
                cx={(i * 17) % 380 + 10}
                cy={45 + (i % 3) * 8}
                r="0.9"
                fill={i % 2 === 0 ? "hsl(18 95% 60%)" : "hsl(185 90% 60%)"}
                animate={{ opacity: [0, 0.9, 0], cy: [50 + (i % 3) * 8, 38 + (i % 3) * 8, 50 + (i % 3) * 8] }}
                transition={{
                  duration: 2.2 + (i % 4) * 0.3,
                  repeat: Infinity,
                  delay: i * 0.08,
                  ease: "easeInOut",
                }}
              />
            ))}
        </g>
      </svg>

      {/* Text overlays — positioned in % so they scale with the SVG */}
      <div className="absolute inset-0 pointer-events-none">
        {/* HRV RMSSD — top center */}
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{ top: "5%" }}
        >
          <div
            className="ps-overline"
            style={{ color: "hsl(185 70% 70%)", fontSize: 10, letterSpacing: "0.22em" }}
          >
            HRV · RMSSD
          </div>
          <div
            className="ps-text-mono font-bold leading-none mt-1"
            style={{
              fontSize: 26,
              color: "hsl(185 90% 75%)",
              textShadow: "0 0 14px hsl(185 90% 60% / 0.55)",
            }}
            data-testid="abg-rmssd"
          >
            {fmt1(hrvRmssdMs)}
            <span className="ml-1" style={{ fontSize: 12, color: "hsl(185 50% 75%)" }}>
              ms
            </span>
          </div>
        </div>

        {/* Sympathetic % — left circle */}
        <div
          className="absolute text-center"
          style={{ top: "44%", left: "20%", transform: "translate(-50%, -50%)" }}
        >
          <div className="ps-overline" style={{ color: "hsl(18 90% 70%)", fontSize: 10 }}>
            Sympathetic
          </div>
          <div
            className="ps-text-mono font-bold leading-none mt-1"
            style={{
              fontSize: 32,
              color: "hsl(18 95% 72%)",
              textShadow: "0 0 16px hsl(18 95% 60% / 0.65)",
            }}
            data-testid="abg-symp"
          >
            {spectralOk ? `${sPct}%` : <span style={{ fontSize: 13 }}>Not assessed</span>}
          </div>
        </div>

        {/* Balance Zone — center */}
        <div
          className="absolute text-center"
          style={{ top: "44%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          <div
            className="text-[9px] uppercase tracking-[0.22em] font-medium"
            style={{ color: "hsl(195 30% 85%)" }}
          >
            Balance
          </div>
          <div
            className="text-[11px] font-semibold mt-0.5"
            style={{ color: "hsl(195 85% 92%)", textShadow: "0 0 12px hsl(195 70% 70% / 0.4)" }}
          >
            {spectralOk ? (balanceLabel ?? "Zone") : "Not assessed"}
          </div>
        </div>

        {/* Parasympathetic % — right circle */}
        <div
          className="absolute text-center"
          style={{ top: "44%", left: "80%", transform: "translate(-50%, -50%)" }}
        >
          <div className="ps-overline" style={{ color: "hsl(185 85% 70%)", fontSize: 10 }}>
            Parasympathetic
          </div>
          <div
            className="ps-text-mono font-bold leading-none mt-1"
            style={{
              fontSize: 32,
              color: "hsl(187 95% 75%)",
              textShadow: "0 0 16px hsl(185 90% 60% / 0.65)",
            }}
            data-testid="abg-parasym"
          >
            {spectralOk ? `${pPct}%` : <span style={{ fontSize: 13 }}>Not assessed</span>}
          </div>
        </div>

        {/* SDNN — bottom-left */}
        <div
          className="absolute text-center"
          style={{ top: "68%", left: "20%", transform: "translate(-50%, -50%)" }}
        >
          <div className="ps-overline" style={{ color: "hsl(18 70% 70%)", fontSize: 10 }}>
            SDNN
          </div>
          <div
            className="ps-text-mono font-bold leading-none mt-1"
            style={{
              fontSize: 22,
              color: "hsl(18 90% 72%)",
              textShadow: "0 0 12px hsl(18 95% 60% / 0.5)",
            }}
            data-testid="abg-sdnn"
          >
            {fmt1(hrvSdnnMs)}
            <span className="ml-1" style={{ fontSize: 11, color: "hsl(18 50% 75%)" }}>
              ms
            </span>
          </div>
        </div>

        {/* LF/HF — bottom-right */}
        <div
          className="absolute text-center"
          style={{ top: "68%", left: "80%", transform: "translate(-50%, -50%)" }}
        >
          <div className="ps-overline" style={{ color: "hsl(185 70% 70%)", fontSize: 10 }}>
            LF / HF
          </div>
          <div
            className="ps-text-mono font-bold leading-none mt-1"
            style={{
              fontSize: 22,
              color: "hsl(187 95% 75%)",
              textShadow: "0 0 12px hsl(185 90% 60% / 0.5)",
            }}
            data-testid="abg-lfhf"
          >
            {spectralOk && typeof lfHfRatio === "number" ? fmt1(lfHfRatio) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------

function buildArcTicks(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  count: number,
) {
  const out: { x: number; y: number; angle: number }[] = [];
  const span = endDeg - startDeg;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = startDeg + span * t;
    const rad = (angle * Math.PI) / 180;
    out.push({
      x: cx + Math.cos(rad) * r,
      y: cy + Math.sin(rad) * r,
      angle,
    });
  }
  return out;
}

/**
 * Generate a stylized ECG-like path.
 * width: total length, height of strip, period: number of QRS complexes,
 * phase: shifts the pattern horizontally (0..1).
 */
function buildEcgPath(
  width: number,
  height: number,
  period: number,
  phase: number = 0,
): string {
  const baseY = height / 2;
  const segW = width / period;
  let d = `M -${width * 0.05} ${baseY}`;
  for (let i = -1; i <= period + 1; i++) {
    const x0 = i * segW + phase * segW;
    // baseline -> small P
    d += ` L ${x0 + segW * 0.18} ${baseY}`;
    d += ` Q ${x0 + segW * 0.22} ${baseY - 6}, ${x0 + segW * 0.26} ${baseY}`;
    // PR segment
    d += ` L ${x0 + segW * 0.35} ${baseY}`;
    // QRS
    d += ` L ${x0 + segW * 0.38} ${baseY + 6}`;
    d += ` L ${x0 + segW * 0.42} ${baseY - height * 0.42}`;
    d += ` L ${x0 + segW * 0.46} ${baseY + height * 0.12}`;
    d += ` L ${x0 + segW * 0.5} ${baseY}`;
    // ST + T
    d += ` L ${x0 + segW * 0.62} ${baseY}`;
    d += ` Q ${x0 + segW * 0.7} ${baseY - 10}, ${x0 + segW * 0.78} ${baseY}`;
    // back to baseline
    d += ` L ${x0 + segW} ${baseY}`;
  }
  return d;
}
