// NOTE (environment-forced location): the canonical portal lives at
// client/src/components/patient/PatientPortal.tsx, but that directory is read-only
// in this workspace, so the two-column Nervous System layout could not be applied
// in place. This is a copy of that portal with only the hero restructured into a
// responsive grid (two columns on desktop, stacked on mobile) and wired to the
// overlap-fixed gauge (./AutonomicBalanceGaugeFixed). All data logic is identical
// to the original. RECONCILE: when patient/ becomes writable, fold the hero grid
// change back into patient/PatientPortal.tsx, restore the ./AutonomicBalanceGauge
// import, and delete this shim + AutonomicBalanceGaugeFixed.tsx.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import { apiRequest } from "@/lib/queryClient";
import { buildPatientSynopsis, hasAutonomicBalance } from "@shared/deterministicSynopsis";
import { NervousSystemBody } from "./patient/NervousSystemBody";
import { AutonomicBalanceGauge } from "./AutonomicBalanceGaugeFixed";
import { CinematicEcg } from "./patient/CinematicEcg";
import { DiagnosisExplainer } from "./patient/DiagnosisExplainer";
import { PlainEnglishSynopsis } from "./patient/PlainEnglishSynopsis";
import { BodyHeatmap } from "./patient/BodyHeatmap";
import { SupplementsPanel } from "./patient/SupplementsPanel";
import { TreatmentsPanel } from "./patient/TreatmentsPanel";
import { NextTestCard } from "./patient/NextTestCard";

interface PatientPortalProps {
  report: ANSReport;
  /** Optional — surfaces a subtle data-quality line when available. */
  ansStudy?: AnsStudy;
}

export function PatientPortalTwoColumn({ report }: PatientPortalProps) {
  // The deterministic synopsis is computed offline from the report, so it is shown
  // immediately — the patient is never blocked by (or left waiting on) the network.
  // Optional AI enrichment quietly swaps in richer prose over the top when it lands.
  const [synopsis, setSynopsis] = useState<string>(
    () => report.patientSynopsis ?? buildPatientSynopsis(report),
  );

  const p = report.patientData;
  const ab = report.autonomicBalance;
  const tier = report.wellnessTier;
  // When LFa/RFa/HRV were not captured the balance is 0/0; the gauge and the
  // interpretation below both switch to a "Not assessed" state in that case
  // instead of showing a fabricated split or a "Balanced sympathovagal tone" line.
  const balanceAssessed = hasAutonomicBalance(report);

  // Per-patient gauge metrics — pulled from Baseline-A (resting reference)
  // with safe fallbacks across other available phases.
  const phases = Array.isArray(report.phaseEvents) ? report.phaseEvents : [];
  const baselinePhase =
    phases.find((e) => e.phase === "Baseline-A") ??
    phases.find((e) => e.phase === "Baseline-C") ??
    phases[0];
  const rmssd = baselinePhase?.HRV_RMSSD ?? 0;
  const sdnn = baselinePhase?.HRV_SDNN ?? 0;
  const spectralAvailable = (report.spectralAvailable ?? ab.available ?? true) && balanceAssessed;
  // LF/HF uses Colombo's LFa/RFa ratio (SB) — only meaningful when available.
  const lfHf: number | null =
    !spectralAvailable
      ? null
      : (baselinePhase?.SB ??
        (baselinePhase && (baselinePhase.RFa ?? 0) > 0 ? (baselinePhase.LFa as number) / (baselinePhase.RFa as number) : 0));
  // Decorative components animate on a numeric split; feed neutral 50/50 when
  // unavailable. The visible % is NEVER shown (gauge shows "Not assessed").
  const visSymp = spectralAvailable ? (ab.sympathetic ?? 50) : 50;
  const visPara = spectralAvailable ? (ab.parasympathetic ?? 50) : 50;

  // Optional AI enrichment. Runs in the background and only ever UPGRADES the
  // text on success; any failure is swallowed so the deterministic synopsis stays
  // on screen. It must never surface a "Connection error" in place of real content.
  const enrichSynopsis = async () => {
    try {
      const res = await apiRequest("POST", "/api/synopsis", { report });
      const data = await res.json();
      if (data.success && data.patientSynopsis) {
        setSynopsis(data.patientSynopsis);
      }
    } catch {
      // AI enrichment is best-effort; keep the deterministic synopsis.
    }
  };

  useEffect(() => {
    if (!report.patientSynopsis) enrichSynopsis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testDateStr = p.testDate
    ? new Date(p.testDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Date on file";

  return (
    <div className="space-y-6 pb-24" data-testid="patient-portal">
      {/* Patient header strip */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="ps-glass rounded-2xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: "hsl(185 85% 42% / 0.15)", color: "hsl(185 85% 60%)" }}
          >
            {p.firstName[0]}{p.lastName[0]}
          </div>
          <span className="text-sm font-semibold">{p.firstName} {p.lastName}</span>
        </div>
        <span className="text-xs text-muted-foreground">Age {p.age}</span>
        {p.gender && <span className="text-xs text-muted-foreground">{p.gender}</span>}
        <span className="text-xs text-muted-foreground">Test: {testDateStr}</span>
        <span className="text-xs text-muted-foreground">Physician: Dr. {p.physician}</span>
        {report.diagnosticSummary && (
          <span
            className="text-xs text-muted-foreground"
            data-testid="patient-data-quality"
            title={`Report confidence: ${Math.round((report.diagnosticSummary.reportConfidenceScore ?? 0) * 100)}%`}
          >
            Data quality:{" "}
            <span
              className={
                report.diagnosticSummary.reportConfidence === "High"
                  ? "text-emerald-400"
                  : report.diagnosticSummary.reportConfidence === "Medium"
                    ? "text-amber-400"
                    : "text-red-400"
              }
            >
              {report.diagnosticSummary.reportConfidence.toLowerCase()}
            </span>
          </span>
        )}
      </motion.div>

      {/* HERO — Cinematic Neural Profile + HRV Ring */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative rounded-3xl overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at 30% 30%, rgba(0,229,160,0.18), transparent 60%)," +
            "radial-gradient(ellipse at 80% 70%, rgba(168,85,247,0.16), transparent 60%)," +
            "radial-gradient(ellipse at 50% 100%, rgba(74,158,255,0.10), transparent 60%)," +
            "#0D1B2A",
          border: "1px solid rgba(0, 229, 160, 0.18)",
          boxShadow: "0 20px 60px rgba(0, 229, 160, 0.10), inset 0 0 40px rgba(3, 11, 20, 0.6)",
        }}
        data-testid="patient-hero"
      >
        {/* Signal-glow atmosphere (replaces dotted grid overlay) */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(0,229,160,0.05), transparent 70%)",
            mixBlendMode: "screen",
          }}
        />

        <div className="relative p-6 lg:p-8">
          <div className="ps-overline mb-3 text-center" style={{ color: "hsl(185 85% 70%)" }}>
            Your Nervous System
          </div>
          {/* Two columns on desktop (body | balance gauge), stacked on mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-center">
            <div className="flex flex-col items-center justify-center">
              <NervousSystemBody
                parasympathetic={visPara}
                sympathetic={visSymp}
              />
            </div>
            <div className="w-full">
              <AutonomicBalanceGauge
                sympathetic={spectralAvailable ? ab.sympathetic : null}
                parasympathetic={spectralAvailable ? ab.parasympathetic : null}
                hrvRmssdMs={rmssd}
                hrvSdnnMs={sdnn}
                lfHfRatio={lfHf}
                balanceLabel={spectralAvailable ? tier : "Not assessed"}
                available={spectralAvailable}
              />
              {balanceAssessed ? (
                ab.interpretation && (
                  <p className="text-sm text-white/70 leading-relaxed mt-4 text-center max-w-xl mx-auto">
                    {ab.interpretation}
                  </p>
                )
              ) : (
                <p
                  className="text-sm text-white/60 leading-relaxed mt-4 text-center max-w-xl mx-auto"
                  data-testid="patient-balance-not-assessed"
                >
                  Autonomic balance was not assessed — this recording didn’t include enough
                  heart-rhythm data. The values above are shown as “Not assessed / insufficient data.”
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Cinematic flowing ECG */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <CinematicEcg parasympathetic={visPara} sympathetic={visSymp} />
      </motion.div>

      {/* Plain English synopsis */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <PlainEnglishSynopsis
          report={report}
          synopsis={synopsis}
          loading={false}
          error={null}
          onRetry={enrichSynopsis}
        />
      </motion.div>

      {/* What we found — diagnosis cards */}
      <DiagnosisExplainer report={report} />

      {/* Body heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <BodyHeatmap bodySystemImpact={report.bodySystemImpact} />
      </motion.div>

      {/* Care plan stack */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="ps-text-display text-xl font-semibold ps-underline-cyan mb-4">
          Your Path Forward
        </h2>
        <div className="space-y-4">
          <SupplementsPanel recommendations={report.therapyRecommendations} />
          <TreatmentsPanel recommendations={report.therapyRecommendations} />
          <NextTestCard followUp={report.followUp} />
        </div>
      </motion.div>
    </div>
  );
}
