import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport, WellnessTier } from "@shared/schema";

interface WellnessMeterProps {
  report: ANSReport;
}

const tierConfig: Record<WellnessTier, { color: string; bg: string; glow: string; label: string; subtitle: string }> = {
  Optimal:   { color: "hsl(140 60% 55%)", bg: "hsl(140 60% 50% / 0.15)", glow: "hsl(140 60% 50% / 0.4)", label: "Optimal", subtitle: "Your autonomic nervous system is performing at peak capacity." },
  Resilient: { color: "hsl(160 70% 50%)", bg: "hsl(160 70% 45% / 0.15)", glow: "hsl(160 70% 45% / 0.4)", label: "Resilient", subtitle: "Your nervous system shows strong adaptive capacity and good regulation." },
  Balanced:  { color: "hsl(185 85% 42%)", bg: "hsl(185 85% 42% / 0.15)", glow: "hsl(185 85% 42% / 0.4)", label: "Balanced", subtitle: "Your autonomic balance is within a healthy functional range." },
  Stressed:  { color: "hsl(35 90% 55%)", bg: "hsl(35 90% 55% / 0.15)", glow: "hsl(35 90% 55% / 0.4)", label: "Stressed", subtitle: "Your nervous system is showing signs of chronic stress — attention recommended." },
  Depleted:  { color: "hsl(15 80% 55%)", bg: "hsl(15 80% 55% / 0.15)", glow: "hsl(15 80% 55% / 0.4)", label: "Depleted", subtitle: "Autonomic reserves are reduced — targeted intervention is recommended." },
  Critical:  { color: "hsl(0 72% 55%)", bg: "hsl(0 72% 51% / 0.15)", glow: "hsl(0 72% 51% / 0.4)", label: "Critical", subtitle: "Significant autonomic dysfunction detected — please consult your physician promptly." },
};

export function WellnessMeter({ report }: WellnessMeterProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const scorability = report.wellnessBreakdown?.scorability;
  // NOT SCORABLE: render the explicit state, never a number or a tier. This is
  // the surface that used to show "91 / Optimal" for a recording whose ECG had
  // failed the usability gate and whose sympathovagal domain was unassessable.
  const notScorable = report.wellnessScore == null || scorability?.scorable === false;
  const tier = report.wellnessTier ? tierConfig[report.wellnessTier] : undefined;
  const score = report.wellnessScore ?? 0;

  useEffect(() => {
    const duration = 1800;
    const start = Date.now();
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(score * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    const raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  if (notScorable) {
    return (
      <div
        className="rounded-2xl border border-border/30 p-6"
        data-testid="wellness-not-scorable"
      >
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Wellness score
        </div>
        <div className="mt-2 text-2xl font-semibold" data-testid="wellness-not-scorable-title">
          Not scorable
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {scorability?.notice ??
            "A composite wellness score is withheld because essential inputs are missing or unusable."}
        </p>
        {scorability?.blockers?.length ? (
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
            {scorability.blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground/80">
          Your measured values are still shown below as observations. They are not an assessment of
          your overall autonomic function, and no tier or grade is assigned.
        </p>
      </div>
    );
  }

  // SVG gauge params
  const cx = 150, cy = 150, r = 110;
  const totalAngle = 270;
  const startAngle = -225;
  const arcSegments = [];

  for (let i = 0; i < 100; i++) {
    const angle1 = startAngle + (totalAngle * i / 100);
    const angle2 = startAngle + (totalAngle * (i + 1) / 100);
    const rad1 = (angle1 * Math.PI) / 180;
    const rad2 = (angle2 * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad1);
    const y1 = cy + r * Math.sin(rad1);
    const x2 = cx + r * Math.cos(rad2);
    const y2 = cy + r * Math.sin(rad2);

    let color: string;
    if (i < 20) color = `hsl(0, 72%, 55%)`;
    else if (i < 40) color = `hsl(${(i - 20) * 2.5}, 80%, 55%)`;
    else if (i < 60) color = `hsl(${50 + (i - 40) * 2}, 80%, 52%)`;
    else if (i < 80) color = `hsl(${90 + (i - 60) * 2.5}, 70%, 50%)`;
    else color = `hsl(${140 + (i - 80) * 2.25}, 75%, 48%)`;

    const lit = i < displayScore;
    arcSegments.push(
      <path
        key={i}
        d={`M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`}
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
        opacity={lit ? 1 : 0.08}
      />
    );
  }

  // Needle
  const needleProgress = displayScore / 100;
  const needleAngleDeg = startAngle + totalAngle * needleProgress;
  const needleRad = ((needleAngleDeg + 90) * Math.PI) / 180;
  const needleLen = 78;
  const nx = cx + needleLen * Math.cos(needleRad);
  const ny = cy + needleLen * Math.sin(needleRad);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-border/30 p-6 text-center"
      style={{ background: tier?.bg, boxShadow: tier ? `0 0 40px ${tier.glow}` : undefined }}
      data-testid="wellness-meter"
    >
      <div className="flex flex-col items-center gap-3">
        <svg viewBox="0 0 300 210" className="w-full max-w-[340px]">
          {/* Background arc */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="hsl(210 12% 12%)"
            strokeWidth="12"
            strokeDasharray="778 259"
            strokeDashoffset="129"
          />
          {arcSegments}
          {/* Needle */}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="hsl(0 0% 85%)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="7" fill="hsl(210 15% 12%)" stroke={tier?.color} strokeWidth="2.5" />
          {/* Center text */}
          <text x={cx} y={cy - 18} textAnchor="middle" fill="hsl(210 10% 55%)" fontFamily="sans-serif" fontSize="10" letterSpacing="2">
            WELLNESS SCORE
          </text>
          <text x={cx} y={cy + 30} textAnchor="middle" fill="white" fontFamily="sans-serif" fontSize="56" fontWeight="700">
            {displayScore}
          </text>
          <text x={cx} y={cy + 50} textAnchor="middle" fill="hsl(210 10% 55%)" fontFamily="sans-serif" fontSize="11">
            out of 100
          </text>
        </svg>

        {/* Tier pill */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="px-4 py-1.5 rounded-full text-sm font-semibold border"
          style={{ color: tier?.color, borderColor: tier?.color, background: tier?.bg }}
        >
          {tier?.label}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-sm text-muted-foreground max-w-xs leading-relaxed"
        >
          {tier?.subtitle}
        </motion.p>
      </div>
    </motion.div>
  );
}
