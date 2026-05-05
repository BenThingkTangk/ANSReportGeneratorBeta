import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { NeuralProfile } from "./NeuralProfile";
import { HrvRingGauge } from "./HrvRingGauge";
import { AnimatedVenn } from "./AnimatedVenn";
import { CinematicEcg } from "./CinematicEcg";
import { DiagnosisExplainer } from "./DiagnosisExplainer";
import { PlainEnglishSynopsis } from "./PlainEnglishSynopsis";
import { BodyHeatmap } from "./BodyHeatmap";
import { SupplementsPanel } from "./SupplementsPanel";
import { TreatmentsPanel } from "./TreatmentsPanel";
import { NextTestCard } from "./NextTestCard";

interface PatientPortalProps {
  report: ANSReport;
}

export function PatientPortal({ report }: PatientPortalProps) {
  const [synopsis, setSynopsis] = useState<string | null>(report.patientSynopsis ?? null);
  const [synopsisLoading, setSynopsisLoading] = useState(!report.patientSynopsis);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);

  const p = report.patientData;
  const ab = report.autonomicBalance;
  const tier = report.wellnessTier;

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
      </motion.div>

      {/* HERO — Cinematic Neural Profile + HRV Ring */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: "radial-gradient(ellipse at 30% 30%, hsl(185 80% 25% / 0.35), transparent 60%), radial-gradient(ellipse at 80% 70%, hsl(295 80% 30% / 0.28), transparent 60%), hsl(220 30% 5%)",
          border: "1px solid hsl(185 85% 42% / 0.15)",
          boxShadow: "0 20px 60px hsl(185 85% 30% / 0.15), inset 0 0 40px hsl(220 30% 4% / 0.6)",
        }}
        data-testid="patient-hero"
      >
        {/* Decorative gridlines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }}
        />

        <div className="relative grid lg:grid-cols-2 gap-6 p-6 lg:p-8">
          {/* Left — Neural profile */}
          <div className="flex flex-col items-center justify-center">
            <div className="ps-overline mb-2 text-center" style={{ color: "hsl(185 85% 70%)" }}>
              Your Nervous System
            </div>
            <NeuralProfile
              parasympathetic={ab.parasympathetic}
              sympathetic={ab.sympathetic}
              wellnessScore={report.wellnessScore}
            />
          </div>

          {/* Right — HRV ring + Venn + caption */}
          <div className="flex flex-col gap-5 justify-center">
            <HrvRingGauge value={report.wellnessScore} status={tier} caption={ab.interpretation} />
            <AnimatedVenn
              sympathetic={ab.sympathetic}
              parasympathetic={ab.parasympathetic}
              balanceLabel={tier}
            />
          </div>
        </div>
      </motion.div>

      {/* Cinematic flowing ECG */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <CinematicEcg parasympathetic={ab.parasympathetic} sympathetic={ab.sympathetic} />
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
