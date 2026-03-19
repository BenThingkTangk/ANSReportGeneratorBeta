import { useEffect, useState } from "react";
import type { ANSReport } from "@shared/schema";
import { Heart, Brain, Moon, Zap } from "lucide-react";

interface MetricCardsProps {
  report: ANSReport;
}

function AnimatedNumber({ value, suffix = "", decimals = 0, delay = 0 }: { value: number; suffix?: string; decimals?: number; delay?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const duration = 1200;
      const start = Date.now();
      const animate = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(value * eased);
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return <>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}{suffix}</>;
}

export function MetricCards({ report }: MetricCardsProps) {
  const cards = [
    {
      label: "Heart Rate Variability (HRV)",
      value: report.heartRateVariability,
      suffix: " ms",
      icon: Heart,
      color: "hsl(185 85% 50%)",
      bg: "hsl(185 85% 42% / 0.08)",
      border: "border-glow-cyan",
      trend: report.heartRateVariability > 40 ? "up" : "down",
      check: report.heartRateVariability > 30,
    },
    {
      label: "Stress Index",
      value: report.stressIndex,
      suffix: "",
      icon: Brain,
      color: "hsl(270 60% 60%)",
      bg: "hsl(270 60% 55% / 0.08)",
      border: "border-glow-purple",
      trend: report.stressIndex < 25 ? "up" : "down",
      check: report.stressIndex < 30,
    },
    {
      label: "Autonomic Balance (SB)",
      value: report.autonomicBalance.balance,
      suffix: "",
      icon: Moon,
      color: "hsl(35 90% 55%)",
      bg: "hsl(35 90% 55% / 0.08)",
      border: "border-glow-orange",
      decimals: 2,
      trend: report.autonomicBalance.balance <= 3 ? "up" : "down",
      check: report.autonomicBalance.balance >= 0.4 && report.autonomicBalance.balance <= 3.0,
    },
    {
      label: "Energy Levels",
      value: report.energyLevel === "High" ? 90 : report.energyLevel === "Moderate" ? 60 : 30,
      suffix: "",
      icon: Zap,
      color: report.energyLevel === "High" ? "hsl(140 60% 55%)" : report.energyLevel === "Moderate" ? "hsl(35 90% 55%)" : "hsl(0 72% 55%)",
      bg: report.energyLevel === "High" ? "hsl(140 60% 50% / 0.08)" : "hsl(35 90% 55% / 0.08)",
      border: report.energyLevel === "High" ? "border-glow-green" : "border-glow-orange",
      textValue: report.energyLevel,
      trend: "up",
      check: report.energyLevel === "High",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="metric-cards">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className={`rounded-xl p-4 ${card.border} transition-all hover:scale-[1.02]`}
          style={{ background: card.bg, animationDelay: `${i * 150}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground font-medium leading-tight max-w-[80%]">
              {card.label}
            </p>
            <card.icon className="w-4 h-4 flex-shrink-0" style={{ color: card.color }} />
          </div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: card.color }}>
              {card.textValue ? card.textValue : <AnimatedNumber value={card.value} suffix={card.suffix} decimals={card.decimals || 0} delay={i * 150 + 500} />}
            </span>
            <span className="text-xs mb-1" style={{ color: card.check ? "hsl(140 60% 55%)" : "hsl(35 90% 55%)" }}>
              {card.trend === "up" ? "↑" : "↓"}
            </span>
            {card.check && (
              <svg className="w-4 h-4 mb-1 flex-shrink-0" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="hsl(140 60% 55%)" strokeWidth="1.5" />
                <path d="M5 8L7 10L11 6" stroke="hsl(140 60% 55%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
