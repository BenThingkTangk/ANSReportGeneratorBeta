import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface ClinicianHeaderProps {
  report: ANSReport;
}

/**
 * Render the physician with exactly one "Dr." prefix. Strips any duplicate or
 * leading "Dr." / "Doctor" from the parsed value before re-prefixing.
 */
function formatPhysician(raw: string | undefined | null): string {
  if (!raw) return "Dr. Unknown";
  const cleaned = raw.replace(/^(?:dr\.?\s+|doctor\s+)+/i, "").trim();
  return cleaned ? `Dr. ${cleaned}` : "Dr. Unknown";
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
      className="ps-glass px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1"
      data-testid="clinician-header"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ps-pulse"
          style={{ background: "oklch(0.85 0.18 200 / 0.15)", color: "var(--ps-brand-cyan)", border: "1px solid var(--ps-border-strong)" }}
        >
          {p.firstName[0]}{p.lastName[0]}
        </div>
        <span className="text-sm font-semibold ps-text-display tracking-tight">{p.firstName} {p.lastName}</span>
      </div>
      <span className="text-xs text-muted-foreground ps-text-mono">Age {p.age} · {p.gender}</span>
      {p.bmi && <span className="text-xs text-muted-foreground ps-text-mono">BMI {p.bmi.toFixed(1)}</span>}
      <span className="text-xs text-muted-foreground">Test: <span className="ps-text-mono text-foreground/90">{testDateStr}</span></span>
      <span className="text-xs text-muted-foreground">{formatPhysician(p.physician)}</span>
      <span className="text-xs text-muted-foreground">Ectopy: <span className="ps-text-mono text-foreground/90">{p.ectopicBeats}</span></span>
      <span
        className="ml-auto ps-overline px-2.5 py-1 rounded-md"
        style={{ background: "oklch(0.85 0.18 200 / 0.10)", border: "1px solid var(--ps-border-strong)" }}
      >
        Clinician View
      </span>
    </motion.div>
  );
}
