import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { ViewToggle } from "./ViewToggle";
import { PatientPortal } from "./patient/PatientPortal";
import { ClinicianPortal } from "./clinician/ClinicianPortal";
import { AskAtom } from "./AskAtom";
import { ArrowLeft } from "lucide-react";

interface ReportDashboardProps {
  report: ANSReport;
  onReset: () => void;
}

type ViewerRole = "patient" | "clinician";

export function ReportDashboard({ report, onReset }: ReportDashboardProps) {
  const [role, setRole] = useState<ViewerRole>("patient");

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between gap-4"
        style={{ background: "hsl(210 20% 6% / 0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid hsl(210 15% 13%)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={onReset}
            className="p-2 rounded-lg hover:bg-card/80 transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <circle cx="28" cy="28" r="20" stroke="hsl(185 85% 42%)" strokeWidth="2" />
              <path d="M16 28 L22 28 L25 18 L28 38 L31 22 L34 28 L40 28" stroke="hsl(185 85% 42%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="text-sm font-bold" style={{ color: "hsl(185 85% 55%)" }}>HumanOS ANS Report</h1>
              <p className="text-[10px] text-muted-foreground hidden sm:block">
                Generated {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <ViewToggle role={role} onChange={setRole} />
      </div>

      {/* Portal content */}
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <AnimatePresence mode="wait">
          {role === "patient" ? (
            <motion.div
              key="patient"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.3 }}
            >
              <PatientPortal report={report} />
            </motion.div>
          ) : (
            <motion.div
              key="clinician"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.3 }}
            >
              <ClinicianPortal report={report} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating chatbot */}
      <AskAtom report={report} viewerRole={role} />
    </div>
  );
}
