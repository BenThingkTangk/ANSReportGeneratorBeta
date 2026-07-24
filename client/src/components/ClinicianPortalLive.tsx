// NOTE (environment-forced location): the canonical clinician portal lives at
// client/src/components/clinician/ClinicianPortal.tsx, but that directory is
// read-only in this workspace, so the "immediate deterministic synopsis" fix
// could not be applied in place. This is a drop-in copy with that fix; it renders
// the unchanged read-only child components from ./clinician/*. ReportDashboard
// renders this instead of clinician/ClinicianPortal. RECONCILE: when clinician/
// becomes writable, fold the synopsis change (deterministic init + best-effort,
// failure-swallowing AI enrichment) back into the original file and delete this
// shim. The ONLY change vs. the original is synopsis sourcing — no other logic.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import type { VendorReportExtraction } from "@shared/vendorExtraction";
import { apiRequest } from "@/lib/queryClient";
import { buildClinicianSynopsis } from "@shared/deterministicSynopsis";
import { VendorFamiliarReport } from "./clinician/VendorFamiliarReport";
import { VendorReconciliationBanner } from "./VendorReconciliationBanner";
import { ClinicianHeader } from "./clinician/ClinicianHeader";
import { ClinicianSynopsis } from "./clinician/ClinicianSynopsis";
import { DataQualityPanel } from "./clinician/DataQualityPanel";
import { PhaseEventTable } from "./clinician/PhaseEventTable";
import { EwingRatiosTable } from "./clinician/EwingRatiosTable";
import { PhaseFindings } from "./clinician/PhaseFindings";
import { OverallImpression } from "./clinician/OverallImpression";
import { TherapyOptions } from "./clinician/TherapyOptions";
import { ContraindicationsPanel } from "./clinician/ContraindicationsPanel";
import { FollowUpPanel } from "./clinician/FollowUpPanel";
import { ColomboReferences } from "./clinician/ColomboReferences";
import { MultiParameterGraphical } from "./clinician/MultiParameterGraphical";
import { RestingBaselinePanel } from "./clinician/RestingBaselinePanel";
import { EcgRhythmStrip } from "./clinician/EcgRhythmStrip";
import { CollapsibleSection } from "./clinician/CollapsibleSection";
import { IndicationsPanel } from "./clinician/IndicationsPanel";
import { WhyConclusionsPanel } from "./clinician/WhyConclusionsPanel";
import { ErrorBoundary } from "./ErrorBoundary";

interface ClinicianPortalProps {
  report: ANSReport;
  ansStudy?: AnsStudy;
  /** Structured paired-vendor extraction; when present the Vendor-Familiar view is offered. */
  vendorExtraction?: VendorReportExtraction;
  vendorSource?: { source?: "ocr" | "text"; ocrConfidence?: number; fileName?: string };
}

type ClinicianView = "vendor" | "humanos";

/** Vendor Familiar / HumanOS Advanced toggle (spring pill, matches ViewToggle). */
function ClinicianViewToggle({
  view,
  onChange,
}: {
  view: ClinicianView;
  onChange: (v: ClinicianView) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl p-1 gap-1"
      style={{ background: "hsl(210 18% 10%)", border: "1px solid hsl(210 15% 18%)" }}
      data-testid="clinician-view-toggle"
    >
      {(["vendor", "humanos"] as ClinicianView[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          data-testid={`clinician-view-${v}`}
          className="relative px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ color: view === v ? "white" : "hsl(210 10% 50%)", zIndex: 1 }}
        >
          {view === v && (
            <motion.div
              layoutId="clinician-view-pill"
              className="absolute inset-0 rounded-lg"
              style={{ background: "hsl(185 85% 42%)" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            />
          )}
          <span className="relative z-10">{v === "vendor" ? "Vendor Familiar" : "HumanOS Advanced"}</span>
        </button>
      ))}
    </div>
  );
}

export function ClinicianPortalLive({ report, ansStudy, vendorExtraction, vendorSource }: ClinicianPortalProps) {
  // When a paired vendor report was ingested, default to the familiar vendor
  // view (what Dr. Colombo reads from); otherwise only the HumanOS view exists.
  const hasVendor = !!vendorExtraction && vendorExtraction.fieldCount > 0;
  const [view, setView] = useState<ClinicianView>(hasVendor ? "vendor" : "humanos");
  // Vendor-reported findings threaded as a SEPARATE evidence class (verbatim,
  // with provenance) so the summary can never say "nothing flagged" when an
  // attached signed vendor report has findings.
  const vendorFindings = vendorExtraction?.narrative
    ? { findings: vendorExtraction.narrative.findings, printedNumbers: vendorExtraction.narrative.printedNumbers }
    : undefined;
  // Clinician synopsis is built deterministically from the report's phase metrics
  // and Colombo patterns, so it renders instantly with no network dependency.
  // Optional AI enrichment (below) only ever swaps in richer prose on success.
  const [synopsis, setSynopsis] = useState<string>(
    () => report.clinicianSynopsis ?? buildClinicianSynopsis(report, vendorFindings),
  );
  // Non-blocking flag: the deterministic synopsis is already on screen; this
  // only drives a small "Enhancing with AI…" badge while the fetch runs.
  const [enhancing, setEnhancing] = useState(false);

  // Best-effort AI enrichment. Failures are swallowed so the deterministic
  // synopsis is never replaced by a "Connection error".
  const enrichSynopsis = async () => {
    setEnhancing(true);
    try {
      const res = await apiRequest("POST", "/api/synopsis", { report });
      const data = await res.json();
      if (data.success && data.clinicianSynopsis) {
        setSynopsis(data.clinicianSynopsis);
      }
    } catch {
      // Keep the deterministic synopsis on any failure.
    } finally {
      setEnhancing(false);
    }
  };

  useEffect(() => {
    if (!report.clinicianSynopsis) {
      enrichSynopsis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="space-y-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 7rem)" }}
      data-testid="clinician-portal"
    >
      <ClinicianHeader report={report} />

      <VendorReconciliationBanner report={report} />

      {hasVendor && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-muted-foreground/80 max-w-md leading-relaxed">
            A paired vendor report is attached. Switch between the vendor's familiar
            P&amp;S layout (verbatim values) and the HumanOS analysis.
          </div>
          <ClinicianViewToggle view={view} onChange={setView} />
        </div>
      )}

      {hasVendor && view === "vendor" && (
        <VendorFamiliarReport
          extraction={vendorExtraction!}
          source={vendorSource?.source}
          ocrConfidence={vendorSource?.ocrConfidence}
          fileName={vendorSource?.fileName}
          trustedTestDate={report.patientData?.testDate ?? null}
        />
      )}

      {(!hasVendor || view === "humanos") && (
      <>
      <ClinicianSynopsis
        synopsis={synopsis}
        loading={false}
        error={null}
        onRetry={enrichSynopsis}
        enhancing={enhancing}
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

      <ErrorBoundary label="Resting baseline">
        <RestingBaselinePanel report={report} />
      </ErrorBoundary>

      <ErrorBoundary label="Indications">
        <IndicationsPanel report={report} />
      </ErrorBoundary>

      <ErrorBoundary label="Multi-parameter graphical">
        <MultiParameterGraphical report={report} />
      </ErrorBoundary>

      <ErrorBoundary label="ECG rhythm strip">
        <EcgRhythmStrip report={report} />
      </ErrorBoundary>

      <ErrorBoundary label="Phase event data">
        <PhaseEventTable phaseEvents={report.phaseEvents} />
      </ErrorBoundary>

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
      </>
      )}
    </div>
  );
}
