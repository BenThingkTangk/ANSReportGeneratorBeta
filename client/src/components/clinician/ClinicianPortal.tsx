import { useEffect, useState } from "react";
import type { ANSReport } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { ClinicianHeader } from "./ClinicianHeader";
import { ClinicianSynopsis } from "./ClinicianSynopsis";
import { PhaseEventTable } from "./PhaseEventTable";
import { EwingRatiosTable } from "./EwingRatiosTable";
import { PhaseFindings } from "./PhaseFindings";
import { OverallImpression } from "./OverallImpression";
import { DysfunctionGrid } from "./DysfunctionGrid";
import { TherapyOptions } from "./TherapyOptions";
import { ContraindicationsPanel } from "./ContraindicationsPanel";
import { WellnessBreakdownPanel } from "./WellnessBreakdownPanel";
import { FollowUpPanel } from "./FollowUpPanel";
import { ColomboReferences } from "./ColomboReferences";
import { AutonomicWave } from "@/components/AutonomicWave";

interface ClinicianPortalProps {
  report: ANSReport;
}

export function ClinicianPortal({ report }: ClinicianPortalProps) {
  const [synopsis, setSynopsis] = useState<string | null>(report.clinicianSynopsis ?? null);
  const [synopsisLoading, setSynopsisLoading] = useState(!report.clinicianSynopsis);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);

  const fetchSynopsis = async () => {
    setSynopsisLoading(true);
    setSynopsisError(null);
    try {
      const res = await apiRequest("POST", "/api/synopsis", { report });
      const data = await res.json();
      if (data.success && data.clinicianSynopsis) {
        setSynopsis(data.clinicianSynopsis);
      } else {
        setSynopsisError("Unable to generate clinical synopsis. Please try again.");
      }
    } catch {
      setSynopsisError("Connection error. Please retry.");
    } finally {
      setSynopsisLoading(false);
    }
  };

  useEffect(() => {
    if (!report.clinicianSynopsis) {
      fetchSynopsis();
    }
  }, []);

  return (
    <div className="space-y-4 pb-16" data-testid="clinician-portal">
      <ClinicianHeader report={report} />

      <ClinicianSynopsis
        synopsis={synopsis}
        loading={synopsisLoading}
        error={synopsisError}
        onRetry={fetchSynopsis}
      />

      <PhaseEventTable phaseEvents={report.phaseEvents} />

      <EwingRatiosTable ratios={report.ratios} />

      <AutonomicWave
        parasympathetic={report.autonomicBalance.parasympathetic}
        sympathetic={report.autonomicBalance.sympathetic}
        ecgData={report.patientData.ecgData}
      />

      <PhaseFindings phaseFindings={report.phaseFindings} />

      <OverallImpression impression={report.overallImpression} />

      <DysfunctionGrid patterns={report.dysfunctionPatterns} />

      <TherapyOptions recommendations={report.therapyRecommendations} />

      {report.contraindications.length > 0 && (
        <ContraindicationsPanel contraindications={report.contraindications} />
      )}

      <WellnessBreakdownPanel
        breakdown={report.wellnessBreakdown}
        wellnessScore={report.wellnessScore}
      />

      <FollowUpPanel followUp={report.followUp} />

      <ColomboReferences />
    </div>
  );
}
