import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { ClinicianPortal } from "./clinician/ClinicianPortal";
import { PatientPortal } from "./patient/PatientPortal";
import { AskAtom } from "./AskAtom";
import { ThemeToggle } from "./ThemeToggle";
import { ViewToggle } from "./ViewToggle";
import { ArrowLeft } from "lucide-react";

interface ReportDashboardProps {
  report: ANSReport;
  onReset: () => void;
}

type ViewerRole = "patient" | "clinician";

/**
 * Dashboard with Patient ⇄ Clinician toggle. Atom chat (blue logo) follows
 * the active role and is always available.
 */
export function ReportDashboard({ report, onReset }: ReportDashboardProps) {
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
            <svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <circle cx="28" cy="28" r="20" stroke="hsl(185 85% 42%)" strokeWidth="2" />
              <path
                d="M16 28 L22 28 L25 18 L28 38 L31 22 L34 28 L40 28"
                stroke="hsl(185 85% 42%)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="min-w-0">
              <h1 className="text-sm font-bold truncate" style={{ color: "hsl(185 85% 55%)" }}>
                HumanOS ANS Report
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
              ? <PatientPortal report={report} />
              : <ClinicianPortal report={report} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Floating Atom chatbot (blue logo) — adapts to viewer role */}
      <AskAtom report={report} viewerRole={role} />
    </div>
  );
}
