import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
// Both portals live in the writable components/ root because their canonical
// clinician/ and patient/ directories are read-only here. Each is a drop-in
// replacement that renders the unchanged read-only child components; see each
// file header for reconcile notes.
//   • ClinicianPortalLive — immediate deterministic synopsis (no "Connection error")
//   • PatientPortalTwoColumn — two-column hero + overlap-fixed gauge + same synopsis fix
import { ClinicianPortalLive } from "./ClinicianPortalLive";
import { PatientPortalTwoColumn } from "./PatientPortalTwoColumn";
import { EvidenceStratification } from "./EvidenceStratification";
import { AskAtom } from "./AskAtom";
import { AtomLogo } from "./AtomLogo";
import { ThemeToggle } from "./ThemeToggle";
import { ViewToggle } from "./ViewToggle";
import { ErrorBoundary } from "./ErrorBoundary";
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
  // Ask ATOM open state is lifted so a non-overlaying mobile trigger (header
  // icon) can open the drawer. The fixed floating launcher inside AskAtom is
  // hidden below `sm` and shown for tablet/desktop.
  const [askOpen, setAskOpen] = useState(false);

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
          {/* Mobile-only Ask ATOM launcher. Lives in the sticky top bar so it can
              never overlay report metrics (unlike the fixed floating button,
              which is shown from `sm` up). */}
          <button
            onClick={() => setAskOpen(o => !o)}
            className="sm:hidden w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(185 85% 35%), hsl(185 85% 48%))",
              boxShadow: "0 0 12px hsl(185 85% 42% / 0.4)",
            }}
            data-testid="ask-atom-button-mobile"
            aria-label="Ask Atom"
            aria-expanded={askOpen}
          >
            <AtomLogo size={18} color="white" />
          </button>
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
            {role === "patient" ? (
              <ErrorBoundary label="Patient view">
                <PatientPortalTwoColumn report={report} ansStudy={ansStudy} />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary label="Clinician view">
                <div className="space-y-4">
                  {/* Evidence tiers: measured vs hypotheses vs missing vs
                      investigational — separated so certainty is never blurred. */}
                  <EvidenceStratification report={report} />
                  <ClinicianPortalLive report={report} ansStudy={ansStudy} />
                </div>
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Atom chatbot (blue logo) — adapts to viewer role. Open state is
          controlled here so the mobile header trigger and the tablet/desktop
          floating launcher share one drawer. */}
      <AskAtom report={report} viewerRole={role} open={askOpen} onOpenChange={setAskOpen} />
    </div>
  );
}
