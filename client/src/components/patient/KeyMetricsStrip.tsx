import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface KeyMetricsStripProps {
  report: ANSReport;
}

function sbInterpretation(sb: number): string {
  if (sb < 0.4) return "Parasympathetic dominant";
  if (sb <= 3.0) return "Balanced";
  return "Sympathetic dominant";
}

function sbColor(sb: number): string {
  if (sb < 0.4) return "hsl(210 80% 60%)";
  if (sb <= 3.0) return "hsl(140 60% 55%)";
  return "hsl(0 72% 60%)";
}

export function KeyMetricsStrip({ report }: KeyMetricsStripProps) {
  const baseline = report.phaseEvents[0];
  const hr = baseline?.meanHR ?? 0;
  const sbp = baseline?.SBP;
  const dbp = baseline?.DBP;
  const sb = baseline?.SB ?? 0;
  const ectopic = report.patientData.ectopicBeats;

  const hrNormal = hr >= 60 && hr <= 100;
  const hrColor = hrNormal ? "hsl(140 60% 55%)" : "hsl(35 90% 55%)";

  const metrics = [
    {
      label: "Resting Heart Rate",
      value: `${Math.round(hr)} bpm`,
      color: hrColor,
      dot: hrColor,
      sub: hrNormal ? "Normal range" : hr < 60 ? "Below normal" : "Above normal",
      testId: "metric-hr",
    },
    {
      label: "Blood Pressure",
      value: (sbp && dbp) ? `${Math.round(sbp)}/${Math.round(dbp)} mmHg` : "Not recorded",
      color: "hsl(185 85% 55%)",
      dot: "hsl(185 85% 42%)",
      sub: (sbp && dbp) ? "Baseline reading" : "BP not captured",
      testId: "metric-bp",
    },
    {
      label: "Sympathovagal Balance",
      value: sb.toFixed(2),
      color: sbColor(sb),
      dot: sbColor(sb),
      sub: sbInterpretation(sb),
      testId: "metric-sb",
    },
    {
      label: "Ectopic Beats",
      value: `${ectopic}`,
      color: ectopic > 5 ? "hsl(35 90% 55%)" : "hsl(140 60% 55%)",
      dot: ectopic > 5 ? "hsl(35 90% 55%)" : "hsl(140 60% 55%)",
      sub: ectopic > 5 ? "Elevated — discuss with doctor" : "Within normal range",
      testId: "metric-ectopic",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="key-metrics-strip">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.4 }}
          className="rounded-xl bg-card/50 border border-border/30 p-4"
          data-testid={m.testId}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.dot }} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">{m.label}</p>
          </div>
          <p className="text-lg font-bold tabular-nums mb-0.5" style={{ color: m.color }}>{m.value}</p>
          <p className="text-[10px] text-muted-foreground">{m.sub}</p>
        </motion.div>
      ))}
    </div>
  );
}
