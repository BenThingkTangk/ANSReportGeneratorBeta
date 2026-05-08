import { motion, useReducedMotion } from "framer-motion";

interface CinematicEcgProps {
  /** 0-100 parasympathetic dominance — drives cyan brightness */
  parasympathetic: number;
  /** 0-100 sympathetic dominance — drives magenta brightness */
  sympathetic: number;
}

/**
 * Wide cinematic dual-color ECG ribbon.
 * Cyan (parasympathetic) flows left → right.
 * Magenta (sympathetic) flows right → left.
 * Both wave-traces drift, with subtle particle dust between.
 */
export function CinematicEcg({ parasympathetic, sympathetic }: CinematicEcgProps) {
  const reduce = useReducedMotion();
  const total = parasympathetic + sympathetic || 1;
  const pPct = parasympathetic / total;
  const sPct = sympathetic / total;

  // Two repeated ECG-line segments stitched
  const ecgPath =
    "M0 24 L12 24 L18 12 L24 36 L30 24 L46 24 L52 18 L58 24 L72 24 L78 8 L84 40 L90 24 L106 24 L112 18 L118 24 L132 24 L140 24";
  const wide =
    `${ecgPath} ${ecgPath.replace(/M0 /, "M132 ").replace(/L\d+ \d+/g, m => {
      const [, x, y] = m.match(/L(\d+) (\d+)/) ?? [];
      return `L${parseInt(x) + 132} ${y}`;
    })}`;

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ height: 120, background: "linear-gradient(180deg, hsl(220 30% 5% / 0.75), hsl(220 30% 8% / 0.75))" }}
      data-testid="cinematic-ecg"
    >
      <svg viewBox="0 0 528 120" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ecg-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="hsl(187 100% 60%)" stopOpacity="0" />
            <stop offset="20%"  stopColor="hsl(187 100% 60%)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(195 95% 50%)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ecg-magenta" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%"   stopColor="hsl(18 95% 65%)"  stopOpacity="0" />
            <stop offset="20%"  stopColor="hsl(18 95% 60%)"  stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(15 100% 50%)"  stopOpacity="0" />
          </linearGradient>
          <filter id="ecg-glow">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Soft grid */}
        {[...Array(13)].map((_, i) => (
          <line key={`v-${i}`} x1={i * 44} y1="0" x2={i * 44} y2="120" stroke="hsl(195 30% 30% / 0.15)" strokeWidth="0.5" />
        ))}
        {[...Array(4)].map((_, i) => (
          <line key={`h-${i}`} x1="0" y1={i * 30 + 15} x2="528" y2={i * 30 + 15} stroke="hsl(195 30% 30% / 0.15)" strokeWidth="0.5" />
        ))}

        {/* Cyan trace (parasympathetic, top half) */}
        <g transform="translate(0,24) scale(2,1)" opacity={0.6 + pPct * 0.4}>
          <motion.path
            d={wide}
            fill="none"
            stroke="url(#ecg-cyan)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#ecg-glow)"
            initial={{ x: 0 }}
            animate={reduce ? { x: 0 } : { x: -264 }}
            transition={reduce ? {} : { duration: 6, repeat: Infinity, ease: "linear" }}
          />
        </g>

        {/* Magenta trace (sympathetic, bottom half) */}
        <g transform="translate(0,72) scale(2,1)" opacity={0.6 + sPct * 0.4}>
          <motion.path
            d={wide}
            fill="none"
            stroke="url(#ecg-magenta)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#ecg-glow)"
            initial={{ x: -264 }}
            animate={reduce ? { x: -264 } : { x: 0 }}
            transition={reduce ? {} : { duration: 7, repeat: Infinity, ease: "linear" }}
          />
        </g>

        {/* Dust particles */}
        {!reduce && [...Array(18)].map((_, i) => {
          const cx = (i * 30) % 528;
          const cy = 60 + (i % 5 - 2) * 6;
          const c = i % 2 === 0 ? "hsl(187 100% 60%)" : "hsl(18 95% 60%)";
          return (
            <motion.circle
              key={i}
              cx={cx} cy={cy} r="1"
              fill={c}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.7, 0], scale: [0.4, 1, 0.4] }}
              transition={{ duration: 2 + (i % 3) * 0.4, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
            />
          );
        })}
      </svg>

      {/* Labels */}
      <div className="absolute top-2 left-3 ps-overline text-[9px]" style={{ color: "hsl(187 100% 70%)" }}>
        Parasympathetic
      </div>
      <div className="absolute bottom-2 right-3 ps-overline text-[9px]" style={{ color: "hsl(18 90% 70%)" }}>
        Sympathetic
      </div>
    </div>
  );
}
