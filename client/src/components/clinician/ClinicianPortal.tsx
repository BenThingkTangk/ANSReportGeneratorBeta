import { useEffect, useState } from "react";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import { apiRequest } from "@/lib/queryClient";
import { ClinicianHeader } from "./ClinicianHeader";
import { ClinicianSynopsis } from "./ClinicianSynopsis";
import { DataQualityPanel } from "./DataQualityPanel";
import { PhaseEventTable } from "./PhaseEventTable";
import { EwingRatiosTable } from "./EwingRatiosTable";
import { PhaseFindings } from "./PhaseFindings";
import { OverallImpression } from "./OverallImpression";
import { TherapyOptions } from "./TherapyOptions";
import { ContraindicationsPanel } from "./ContraindicationsPanel";
import { FollowUpPanel } from "./FollowUpPanel";
import { ColomboReferences } from "./ColomboReferences";
import { MultiParameterGraphical } from "./MultiParameterGraphical";
import { RestingBaselinePanel } from "./RestingBaselinePanel";
import { EcgRhythmStrip } from "./EcgRhythmStrip";
import { CollapsibleSection } from "./CollapsibleSection";
import { IndicationsPanel } from "./IndicationsPanel";
import { WhyConclusionsPanel } from "./WhyConclusionsPanel";

interface ClinicianPortalProps {
  report: ANSReport;
  ansStudy?: AnsStudy;
}

export function ClinicianPortal({ report, ansStudy }: ClinicianPortalProps) {
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

      {/* PR2 — Data Quality & Confidence panel slots in above clinical content. */}
      {report.diagnosticSummary && (
        <DataQualityPanel
          summary={report.diagnosticSummary}
          ansStudy={ansStudy}
        />
      )}

      {/* PR5 — "Why this conclusion?" expanders under each finding / phenotype. */}
      {report.diagnosticSummary && (
        <WhyConclusionsPanel
          summary={report.diagnosticSummary}
          ansStudy={ansStudy}
        />
      )}

      <RestingBaselinePanel report={report} />

      <IndicationsPanel report={report} />

      <MultiParameterGraphical report={report} />

      <EcgRhythmStrip report={report} />

      <PhaseEventTable phaseEvents={report.phaseEvents} />

      <CollapsibleSection
        title="Ewing Autonomic Ratios (Time-Domain)"
        subtitle="Classical E/I, Valsalva, 30:15 ratios with normal ranges"
        testId="toggle-ewing"
      >
        <EwingRatiosTable
          ratios={report.ratios}
          cardiovagalScore={report.diagnosticSummary?.cardiovagalScore}
        />
      </CollapsibleSection>

      <PhaseFindings phaseFindings={report.phaseFindings} />

      <OverallImpression impression={report.overallImpression} />

      <TherapyOptions recommendations={report.therapyRecommendations} />

      {report.contraindications.length > 0 && (
        <ContraindicationsPanel contraindications={report.contraindications} />
      )}

      <FollowUpPanel followUp={report.followUp} />

      <ColomboReferences />
    </div>
  );
}
