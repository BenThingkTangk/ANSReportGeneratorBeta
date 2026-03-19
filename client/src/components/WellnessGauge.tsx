import { useEffect, useState } from "react";

interface WellnessGaugeProps {
  score: number;
  riskLevel: string;
}

export function WellnessGauge({ score, riskLevel }: WellnessGaugeProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [needleAngle, setNeedleAngle] = useState(-135);

  useEffect(() => {
    // Animate score counter
    const duration = 1500;
    const start = Date.now();
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayScore(Math.round(score * eased));
      setNeedleAngle(-135 + (270 * score / 100) * eased);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [score]);

  // Generate gradient arc segments
  const arcSegments = [];
  const totalAngle = 270;
  const startAngle = -225;
  const cx = 150;
  const cy = 150;
  const r = 120;

  for (let i = 0; i < 100; i++) {
    const angle1 = startAngle + (totalAngle * i / 100);
    const angle2 = startAngle + (totalAngle * (i + 1) / 100);
    const rad1 = (angle1 * Math.PI) / 180;
    const rad2 = (angle2 * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad1);
    const y1 = cy + r * Math.sin(rad1);
    const x2 = cx + r * Math.cos(rad2);
    const y2 = cy + r * Math.sin(rad2);

    // Color gradient: red -> yellow -> green -> cyan
    let color;
    if (i < 25) color = `hsl(${i * 1.4}, 80%, 50%)`;
    else if (i < 50) color = `hsl(${35 + (i - 25) * 2.8}, 80%, 50%)`;
    else if (i < 75) color = `hsl(${105 + (i - 50) * 2.4}, 70%, 48%)`;
    else color = `hsl(${165 + (i - 75) * 0.8}, 80%, 48%)`;

    const opacity = i <= score ? 1 : 0.1;

    arcSegments.push(
      <path
        key={i}
        d={`M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`}
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
        opacity={opacity}
      />
    );
  }

  // Needle
  const needleRad = ((needleAngle - 90) * Math.PI) / 180;
  const needleLength = 85;
  const nx = cx + needleLength * Math.cos(needleRad);
  const ny = cy + needleLength * Math.sin(needleRad);

  // Tick marks
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const angle = startAngle + (totalAngle * i / 10);
    const rad = (angle * Math.PI) / 180;
    const outerR = r + 16;
    const innerR = r + 8;
    ticks.push(
      <line
        key={i}
        x1={cx + innerR * Math.cos(rad)}
        y1={cy + innerR * Math.sin(rad)}
        x2={cx + outerR * Math.cos(rad)}
        y2={cy + outerR * Math.sin(rad)}
        stroke="hsl(210 10% 30%)"
        strokeWidth="1.5"
      />
    );
  }

  return (
    <div className="rounded-2xl bg-card/50 border border-border/30 p-6" data-testid="wellness-gauge">
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 300 200" className="w-full max-w-[380px]">
          {/* Background arc */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(210 12% 12%)" strokeWidth="12" strokeDasharray="848 283" strokeDashoffset="141" />

          {/* Colored arc segments */}
          {arcSegments}

          {/* Tick marks */}
          {ticks}

          {/* Needle */}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="hsl(0 0% 85%)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="6" fill="hsl(210 15% 15%)" stroke="hsl(185 85% 42%)" strokeWidth="2" />

          {/* Center text */}
          <text x={cx} y={cy - 15} textAnchor="middle" className="text-[10px] uppercase tracking-wider" fill="hsl(210 10% 55%)" fontFamily="sans-serif" fontSize="10">
            Wellness Score
          </text>
          <text x={cx} y={cy + 25} textAnchor="middle" className="tabular-nums" fill="white" fontFamily="sans-serif" fontSize="52" fontWeight="700">
            {displayScore}%
          </text>
        </svg>
      </div>
    </div>
  );
}
