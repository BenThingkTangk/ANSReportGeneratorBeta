import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import { apiRequest } from "@/lib/queryClient";
import { NervousSystemBody } from "./NervousSystemBody";
import { AutonomicBalanceGauge } from "./AutonomicBalanceGauge";
import { CinematicEcg } from "./CinematicEcg";
import { DiagnosisExplainer } from "./DiagnosisExplainer";
import { PlainEnglishSynopsis } from "./PlainEnglishSynopsis";
import { BodyHeatmap } from "./BodyHeatmap";
import { SupplementsPanel } from "./SupplementsPanel";
import { TreatmentsPanel } from "./TreatmentsPanel";
import { NextTestCard } from "./NextTestCard";
import { sbZoneLabel } from "@shared/colomboNorms";

interface PatientPortalProps {
  report: ANSReport;
  /** Optional — surfaces a subtle data-quality line when available. */
  ansStudy?: AnsStudy;
}

export function PatientPortal({ report }: PatientPortalProps) {
  const [synopsis, setSynopsis] = useState<string | null>(report.patientSynopsis ?? null);
  const [synopsisLoading, setSynopsisLoading] = useState(!report.patientSynopsis);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);

  const p = report.patientData;
  const ab = report.autonomicBalance;
  const tier = report.wellnessTier;

  // Per-patient gauge metrics — pulled from Baseline-A (resting reference)
  // with safe fallbacks across other available phases.
  const phases = Array.isArray(report.phaseEvents) ? report.phaseEvents : [];
  const baselinePhase =
    phases.find((e) => e.phase === "Baseline-A") ??
    phases.find((e) => e.phase === "Baseline-C") ??
    phases[0];
  const rmssd = baselinePhase?.HRV_RMSSD ?? 0;
  const sdnn = baselinePhase?.HRV_SDNN ?? 0;
  // Spectral availability gate: when the proprietary LFa/RFa/SB are not
  // reproducible, the balance split is "Not assessed". Never coerce to 0/100 or
  // label a balance zone.
  const spectralAvailable = report.spectralAvailable ?? ab.available ?? true;
  // LF/HF uses Colombo's LFa/RFa ratio (SB) — only meaningful when available.
  const lfHf: number | null =
    !spectralAvailable
      ? null
      : (baselinePhase?.SB ??
        (baselinePhase && (baselinePhase.RFa ?? 0) > 0 ? (baselinePhase.LFa as number) / (baselinePhase.RFa as number) : 0));
  // Hero balance chip reflects the measured sympathovagal balance (SB) via the
  // fixed Colombo cutoffs — NOT the score-derived wellness tier. This keeps the
  // patient hero from saying "Balanced" when the clinician view flags an
  // imbalance (S2-3). When SB is unavailable, show "Not assessed" — never a
  // fabricated balance label.
  const balanceChipLabel =
    spectralAvailable && baselinePhase && baselinePhase.SB != null && Number.isFinite(baselinePhase.SB)
      ? sbZoneLabel(baselinePhase.SB as number)
      : spectralAvailable
        ? tier
        : "Not assessed";
  // Decorative visual components animate on a numeric split. When spectral is
  // unavailable feed a neutral 50/50 so the animation still runs — the numeric
  // % is NEVER shown to the user (the gauge renders "Not assessed").
  const visSymp = spectralAvailable ? (ab.sympathetic ?? 50) : 50;
  const visPara = spectralAvailable ? (ab.parasympathetic ?? 50) : 50;

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
    if (!report.patientSynopsis) fetchSynopsis();
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
          <div className="flex flex-col items-center justify-center">
            <NervousSystemBody
              parasympathetic={visPara}
              sympathetic={visSymp}
              available={spectralAvailable}
            />
          </div>
          <div className="mt-4 max-w-2xl mx-auto">
            <AutonomicBalanceGauge
              sympathetic={spectralAvailable ? ab.sympathetic : null}
              parasympathetic={spectralAvailable ? ab.parasympathetic : null}
              hrvRmssdMs={rmssd}
              hrvSdnnMs={sdnn}
              lfHfRatio={lfHf}
              balanceLabel={balanceChipLabel}
              available={spectralAvailable}
              // PATIENT portal: P&S readouts only (output protocol).
              audience="patient"
            />
            {ab.interpretation && (
              <p className="text-sm text-white/70 leading-relaxed mt-4 text-center max-w-xl mx-auto">
                {ab.interpretation}
              </p>
            )}
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
          loading={synopsisLoading}
          error={synopsisError}
          onRetry={fetchSynopsis}
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
