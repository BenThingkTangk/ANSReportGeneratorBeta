import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import { ClinicianPortal } from "./clinician/ClinicianPortal";
import { PatientPortal } from "./patient/PatientPortal";
import { AskAtom } from "./AskAtom";
import { ThemeToggle } from "./ThemeToggle";
import { ViewToggle } from "./ViewToggle";
import { ArrowLeft } from "lucide-react";
import { PhysioPSPulseNodeLogo } from "./brand/PhysioPSPulseNodeLogo";

interface ReportDashboardProps {
  report: ANSReport;
  /** Optional normalized study so portals can show extraction warnings. */
  ansStudy?: AnsStudy;
  onReset: () => void;
}

type ViewerRole = "patient" | "clinician";

/**
 * Dashboard with Patient ⇄ Clinician toggle. Atom chat (blue logo) follows
 * the active role and is always available.
 */
export function ReportDashboard({ report, ansStudy, onReset }: ReportDashboardProps) {
  const [role, setRole] = useState<ViewerRole>("patient");

  return (
    <div className="ps-bg-deep min-h-screen">
      {/* Top bar */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between gap-4"
        style={{
          background: "hsl(var(--background) / 0.9)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onReset}
            className="p-2 rounded-lg hover:bg-card/80 transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <PhysioPSPulseNodeLogo
              variant="primary"
              title="PhysioPS Pulse Node"
              width={32}
              height={32}
              aria-label="PhysioPS Pulse Node mark"
            />
            <div className="min-w-0">
              <h1 className="text-sm font-bold truncate" style={{ color: "var(--color-parasym)" }}>
                PhysioPS × HumanOS ANS Report
              </h1>
              <p className="text-[10px] text-muted-foreground hidden sm:block">
                Generated {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <ViewToggle role={role} onChange={setRole} />
          <ThemeToggle />
        </div>
      </div>

      {/* Portal content */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={role}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {role === "patient"
              ? <PatientPortal report={report} ansStudy={ansStudy} />
              : <ClinicianPortal report={report} ansStudy={ansStudy} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Floating Atom chatbot (blue logo) — adapts to viewer role */}
      <AskAtom report={report} viewerRole={role} />
    </div>
  );
}
