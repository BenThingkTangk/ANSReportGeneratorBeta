import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { ClinicianPortal } from "./clinician/ClinicianPortal";
import { AskAtom } from "./AskAtom";
import { ThemeToggle } from "./ThemeToggle";
import { ArrowLeft } from "lucide-react";

interface ReportDashboardProps {
  report: ANSReport;
  onReset: () => void;
}

/**
 * Clinical-only dashboard. Per Dr. Colombo, the patient/wellness Venn-style
 * view has been deferred from the clinical surface — it now lives in the
 * gamified mobile companion (Path D). Here we render the full clinician
 * portal exclusively.
 */
export function ReportDashboard({ report, onReset }: ReportDashboardProps) {
  return (
    <div className="min-h-screen">
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
          <ThemeToggle />
        </div>
      </div>

      {/* Portal content */}
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <ClinicianPortal report={report} />
        </motion.div>
      </div>

      {/* Floating chatbot */}
      <AskAtom report={report} viewerRole="clinician" />
    </div>
  );
}
