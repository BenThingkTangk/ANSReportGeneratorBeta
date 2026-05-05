import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

interface NeuralProfileProps {
  /** 0-100 — drives parasympathetic (cyan) intensity on left lobe */
  parasympathetic: number;
  /** 0-100 — drives sympathetic (magenta) intensity on right lobe */
  sympathetic: number;
  /** 0-100 — overall wellness, drives the global luminance */
  wellnessScore: number;
}

/**
 * Cinematic neural-profile hero — a glowing head-in-profile silhouette filled
 * with branching nerve filaments that pulse, shimmer and glow in real time
 * according to the patient's autonomic data.
 *
 * Cyan filaments → parasympathetic dominance.
 * Magenta filaments → sympathetic dominance.
 * Brightness scales with wellness score.
 *
 * Inspired by the user's reference video (cybernetic-skull / nerve mesh
 * profile shot) and the PhysioPS deep-space brand system.
 */
export function NeuralProfile({ parasympathetic, sympathetic, wellnessScore }: NeuralProfileProps) {
  const reduce = useReducedMotion();

  // Normalize
  const total = parasympathetic + sympathetic || 1;
  const pPct = parasympathetic / total;       // cyan weight
  const sPct = sympathetic / total;            // magenta weight
  const lum = 0.55 + (wellnessScore / 100) * 0.45;

  // Procedural branching nerves rooted at brainstem (≈ x:225 y:240)
  // Each path is a bezier from origin out into the cranium.
  const branches = useMemo(() => {
    const seed = 137;
    const out: { d: string; w: number; hue: "cyan" | "magenta"; len: number; delay: number }[] = [];
    let n = seed;
    const rand = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };

    for (let i = 0; i < 38; i++) {
      const ox = 218 + (rand() - 0.5) * 6;
      const oy = 232 + (rand() - 0.5) * 6;
      // Target across the cranium dome
      const angle = Math.PI * (0.45 + rand() * 0.95);     // sweep over upper half
      const dist  = 90 + rand() * 95;
      const tx = ox + Math.cos(angle) * dist * -1;          // grow leftward into the head
      const ty = oy - Math.sin(angle) * dist * 1.05;
      const cx1 = ox + (tx - ox) * 0.3 + (rand() - 0.5) * 40;
      const cy1 = oy + (ty - oy) * 0.3 + (rand() - 0.5) * 40;
      const cx2 = ox + (tx - ox) * 0.7 + (rand() - 0.5) * 40;
      const cy2 = oy + (ty - oy) * 0.7 + (rand() - 0.5) * 40;
      const d = `M ${ox} ${oy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`;
      // Hue allocation: nerve filaments biased by position. Upper-front → magenta (sympathetic crown),
      // back/lower → cyan (parasympathetic vagal). But we'll layer both globally.
      const hue: "cyan" | "magenta" = rand() < 0.5 ? "cyan" : "magenta";
      const w = 0.6 + rand() * 1.1;
      out.push({ d, w, hue, len: dist, delay: rand() * 3 });
    }
    return out;
  }, []);

  // Sub-branches (forks) for added density
  const forks = useMemo(() => {
    const seed = 911;
    const out: { d: string; hue: "cyan" | "magenta"; delay: number }[] = [];
    let n = seed;
    const rand = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
    for (let i = 0; i < 70; i++) {
      const ox = 130 + rand() * 130;
      const oy = 90 + rand() * 200;
      const len = 18 + rand() * 30;
      const a = rand() * Math.PI * 2;
      const tx = ox + Math.cos(a) * len;
      const ty = oy + Math.sin(a) * len;
      const cx = ox + (tx - ox) * 0.5 + (rand() - 0.5) * 14;
      const cy = oy + (ty - oy) * 0.5 + (rand() - 0.5) * 14;
      const d = `M ${ox} ${oy} Q ${cx} ${cy}, ${tx} ${ty}`;
      const hue: "cyan" | "magenta" = rand() < 0.5 ? "cyan" : "magenta";
      out.push({ d, hue, delay: rand() * 4 });
    }
    return out;
  }, []);

  // Synapse stars
  const synapses = useMemo(() => {
    const out: { x: number; y: number; hue: "cyan" | "magenta"; delay: number }[] = [];
    let n = 31;
    const rand = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
    for (let i = 0; i < 26; i++) {
      out.push({
        x: 110 + rand() * 150,
        y: 80 + rand() * 200,
        hue: rand() < 0.5 ? "cyan" : "magenta",
        delay: rand() * 3,
      });
    }
    return out;
  }, []);

  const cyanColor    = `hsl(185 90% ${50 + lum * 15}%)`;
  const magentaColor = `hsl(295 80% ${55 + lum * 12}%)`;
  const cyanOpacity = 0.55 + pPct * 0.45;
  const magentaOpacity = 0.55 + sPct * 0.45;

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 380 }} aria-hidden="true" data-testid="neural-profile">
      <svg viewBox="0 0 380 460" width="100%" height="100%">
        <defs>
          <radialGradient id="np-aura" cx="50%" cy="42%" r="60%">
            <stop offset="0%"  stopColor="hsl(185 80% 60%)" stopOpacity="0.35" />
            <stop offset="55%" stopColor="hsl(280 80% 50%)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="hsl(280 80% 50%)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="np-skull" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"  stopColor="hsl(185 90% 60%)" stopOpacity="0.85" />
            <stop offset="50%" stopColor="hsl(220 70% 55%)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="hsl(295 80% 55%)" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="np-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="hsl(180 90% 80%)" />
            <stop offset="100%" stopColor="hsl(195 90% 50%)" />
          </linearGradient>
          <linearGradient id="np-magenta" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stopColor="hsl(290 90% 70%)" />
            <stop offset="100%" stopColor="hsl(310 90% 50%)" />
          </linearGradient>
          <filter id="np-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="np-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Mask for head-in-profile */}
          <clipPath id="np-headclip">
            <path d={HEAD_PROFILE_PATH} />
          </clipPath>
        </defs>

        {/* Ambient halo behind head */}
        <ellipse cx="190" cy="200" rx="190" ry="220" fill="url(#np-aura)" />

        {/* Head silhouette outline (glowing) */}
        <motion.path
          d={HEAD_PROFILE_PATH}
          fill="hsl(220 30% 6% / 0.35)"
          stroke="url(#np-skull)"
          strokeWidth="1.4"
          filter="url(#np-glow-strong)"
          initial={{ opacity: 0 }}
          animate={reduce ? { opacity: 0.95 } : { opacity: [0.85, 1, 0.85] }}
          transition={reduce ? { duration: 0.8 } : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Inner nerve mesh — clipped to head */}
        <g clipPath="url(#np-headclip)" filter="url(#np-glow)">
          {/* Main filaments */}
          {branches.map((b, i) => (
            <motion.path
              key={`b-${i}`}
              d={b.d}
              fill="none"
              stroke={b.hue === "cyan" ? "url(#np-cyan)" : "url(#np-magenta)"}
              strokeWidth={b.w}
              strokeLinecap="round"
              opacity={b.hue === "cyan" ? cyanOpacity : magentaOpacity}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={reduce
                ? { pathLength: 1, opacity: b.hue === "cyan" ? cyanOpacity : magentaOpacity }
                : { pathLength: [0.1, 1, 1], opacity: [0, b.hue === "cyan" ? cyanOpacity : magentaOpacity, b.hue === "cyan" ? cyanOpacity * 0.6 : magentaOpacity * 0.6] }}
              transition={reduce
                ? { duration: 1, delay: i * 0.02 }
                : { duration: 3.4, repeat: Infinity, repeatType: "reverse", delay: b.delay, ease: "easeInOut" }}
            />
          ))}
          {/* Sub-branches */}
          {forks.map((f, i) => (
            <motion.path
              key={`f-${i}`}
              d={f.d}
              fill="none"
              stroke={f.hue === "cyan" ? cyanColor : magentaColor}
              strokeWidth="0.6"
              strokeLinecap="round"
              opacity={f.hue === "cyan" ? cyanOpacity * 0.7 : magentaOpacity * 0.7}
              initial={{ pathLength: 0 }}
              animate={reduce ? { pathLength: 1 } : { pathLength: [0, 1, 1, 0] }}
              transition={reduce
                ? { duration: 1, delay: i * 0.01 }
                : { duration: 4, repeat: Infinity, delay: f.delay, ease: "easeInOut" }}
            />
          ))}
          {/* Synapse stars */}
          {synapses.map((s, i) => (
            <motion.circle
              key={`s-${i}`}
              cx={s.x}
              cy={s.y}
              r="1.6"
              fill={s.hue === "cyan" ? cyanColor : magentaColor}
              initial={{ opacity: 0 }}
              animate={reduce ? { opacity: 0.85 } : { opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5] }}
              transition={reduce
                ? { duration: 0.8 }
                : { duration: 2.2, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
              style={{ filter: `drop-shadow(0 0 4px ${s.hue === "cyan" ? cyanColor : magentaColor})` }}
            />
          ))}
        </g>

        {/* Brainstem → vagus nerve descending */}
        <motion.path
          d="M 220 240 Q 218 280 216 320 Q 214 360 220 400"
          fill="none"
          stroke="url(#np-cyan)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity={cyanOpacity}
          filter="url(#np-glow)"
          initial={{ pathLength: 0 }}
          animate={reduce ? { pathLength: 1 } : { pathLength: [0.4, 1, 0.4], opacity: [cyanOpacity * 0.6, cyanOpacity, cyanOpacity * 0.6] }}
          transition={reduce ? { duration: 1 } : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Sympathetic chain on opposite side */}
        <motion.path
          d="M 232 250 Q 240 290 244 330 Q 246 370 240 410"
          fill="none"
          stroke="url(#np-magenta)"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity={magentaOpacity}
          filter="url(#np-glow)"
          initial={{ pathLength: 0 }}
          animate={reduce ? { pathLength: 1 } : { pathLength: [0.4, 1, 0.4], opacity: [magentaOpacity * 0.6, magentaOpacity, magentaOpacity * 0.6] }}
          transition={reduce ? { duration: 1 } : { duration: 3.6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        />

        {/* Travelling pulse particles along the spinal/vagal axis */}
        {!reduce && [...Array(4)].map((_, i) => (
          <motion.circle
            key={`pulse-${i}`}
            r="2.4"
            fill="hsl(195 95% 80%)"
            initial={{ offsetDistance: "0%", opacity: 0 } as any}
            animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] } as any}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.65, ease: "easeInOut" }}
            style={{
              offsetPath: `path("M 220 240 Q 218 280 216 320 Q 214 360 220 400")`,
              offsetDistance: "0%",
              filter: "drop-shadow(0 0 8px hsl(195 95% 70%))",
            } as any}
          />
        ))}
      </svg>
    </div>
  );
}

// Side-profile head silhouette (left-facing). Hand-tuned bezier path.
const HEAD_PROFILE_PATH = `
  M 240 60
  C 180 55, 110 90, 95 165
  C 80 220, 90 270, 110 290
  C 120 305, 118 320, 122 332
  C 128 348, 142 354, 158 354
  L 168 354
  L 172 372
  C 176 388, 188 396, 204 398
  L 220 400
  L 218 420
  L 240 420
  L 250 410
  L 250 380
  L 256 360
  L 268 340
  L 274 310
  L 286 280
  C 304 240, 304 180, 286 130
  C 270 88, 250 60, 240 60
  Z
`;
