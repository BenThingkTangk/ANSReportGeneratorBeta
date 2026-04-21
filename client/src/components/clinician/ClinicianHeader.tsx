import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface ClinicianHeaderProps {
  report: ANSReport;
}

export function ClinicianHeader({ report }: ClinicianHeaderProps) {
  const p = report.patientData;
  const testDateStr = p.testDate
    ? new Date(p.testDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Date on file";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1"
      data-testid="clinician-header"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: "hsl(270 60% 55% / 0.15)", color: "hsl(270 60% 70%)" }}
        >
          {p.firstName[0]}{p.lastName[0]}
        </div>
        <span className="text-sm font-semibold">{p.firstName} {p.lastName}</span>
      </div>
      <span className="text-xs text-muted-foreground">Age {p.age} · {p.gender}</span>
      {p.bmi && <span className="text-xs text-muted-foreground">BMI {p.bmi.toFixed(1)}</span>}
      <span className="text-xs text-muted-foreground">Test: {testDateStr}</span>
      <span className="text-xs text-muted-foreground">Dr. {p.physician}</span>
      <span className="text-xs text-muted-foreground">Ectopic: {p.ectopicBeats}</span>
      <span
        className="ml-auto text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-widest"
        style={{ background: "hsl(270 60% 55% / 0.15)", color: "hsl(270 60% 70%)", border: "1px solid hsl(270 60% 55% / 0.3)" }}
      >
        Clinician View
      </span>
    </motion.div>
  );
}
