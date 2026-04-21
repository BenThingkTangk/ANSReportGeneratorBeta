import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { WellnessMeter } from "./WellnessMeter";
import { PlainEnglishSynopsis } from "./PlainEnglishSynopsis";
import { BodyHeatmap } from "./BodyHeatmap";
import { KeyMetricsStrip } from "./KeyMetricsStrip";
import { PatternChips } from "./PatternChips";
import { SupplementsPanel } from "./SupplementsPanel";
import { TreatmentsPanel } from "./TreatmentsPanel";
import { NextTestCard } from "./NextTestCard";
import { AutonomicWave } from "@/components/AutonomicWave";

interface PatientPortalProps {
  report: ANSReport;
}

export function PatientPortal({ report }: PatientPortalProps) {
  const [synopsis, setSynopsis] = useState<string | null>(report.patientSynopsis ?? null);
  const [synopsisLoading, setSynopsisLoading] = useState(!report.patientSynopsis);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);

  const p = report.patientData;

  const fetchSynopsis = async () => {
    setSynopsisLoading(true);
    setSynopsisError(null);
    try {
      const res = await apiRequest("POST", "/api/synopsis", { report });
      const data = await res.json();
      if (data.success && data.patientSynopsis) {
        setSynopsis(data.patientSynopsis);
      } else {
        setSynopsisError("Unable to generate synopsis. Please try again.");
      }
    } catch {
      setSynopsisError("Connection error. Please retry.");
    } finally {
      setSynopsisLoading(false);
    }
  };

  useEffect(() => {
    if (!report.patientSynopsis) {
      fetchSynopsis();
    }
  }, []);

  const testDateStr = p.testDate
    ? new Date(p.testDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Date on file";

  return (
    <div className="space-y-4 pb-16" data-testid="patient-portal">
      {/* Header strip */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl bg-card/50 border border-border/30 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: "hsl(185 85% 42% / 0.15)", color: "hsl(185 85% 55%)" }}
          >
            {p.firstName[0]}{p.lastName[0]}
          </div>
          <span className="text-sm font-semibold">{p.firstName} {p.lastName}</span>
        </div>
        <span className="text-xs text-muted-foreground">Age {p.age}</span>
        {p.gender && <span className="text-xs text-muted-foreground">{p.gender}</span>}
        <span className="text-xs text-muted-foreground">Test: {testDateStr}</span>
        <span className="text-xs text-muted-foreground">Physician: Dr. {p.physician}</span>
      </motion.div>

      {/* Hero — Wellness Meter */}
      <WellnessMeter report={report} />

      {/* Plain-English Synopsis */}
      <PlainEnglishSynopsis
        report={report}
        synopsis={synopsis}
        loading={synopsisLoading}
        error={synopsisError}
        onRetry={fetchSynopsis}
      />

      {/* Body Heatmap */}
      <BodyHeatmap bodySystemImpact={report.bodySystemImpact} />

      {/* Key Metrics Strip */}
      <KeyMetricsStrip report={report} />

      {/* Autonomic Wave */}
      <AutonomicWave
        parasympathetic={report.autonomicBalance.parasympathetic}
        sympathetic={report.autonomicBalance.sympathetic}
        ecgData={report.patientData.ecgData}
      />

      {/* Pattern Chips */}
      <PatternChips patterns={report.dysfunctionPatterns} />

      {/* Three stacked panels */}
      <div className="space-y-4">
        <SupplementsPanel recommendations={report.therapyRecommendations} />
        <TreatmentsPanel recommendations={report.therapyRecommendations} />
        <NextTestCard followUp={report.followUp} />
      </div>
    </div>
  );
}
