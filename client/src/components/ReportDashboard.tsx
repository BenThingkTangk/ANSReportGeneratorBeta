import { useState, useEffect } from "react";
import type { ANSReport } from "@shared/schema";
import { WellnessGauge } from "./WellnessGauge";
import { MetricCards } from "./MetricCards";
import { AutonomicWave } from "./AutonomicWave";
import { PatientSidebar } from "./PatientSidebar";
import { ReportSlides } from "./ReportSlides";
import { ArrowLeft, FileText, Download, ChevronRight } from "lucide-react";

interface ReportDashboardProps {
  report: ANSReport;
  onReset: () => void;
}

export function ReportDashboard({ report, onReset }: ReportDashboardProps) {
  const [showSlides, setShowSlides] = useState(false);
  const [revealStage, setRevealStage] = useState(0);

  useEffect(() => {
    // Staggered reveal animation
    const timers = [
      setTimeout(() => setRevealStage(1), 100),
      setTimeout(() => setRevealStage(2), 400),
      setTimeout(() => setRevealStage(3), 700),
      setTimeout(() => setRevealStage(4), 1000),
      setTimeout(() => setRevealStage(5), 1300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  if (showSlides) {
    return <ReportSlides report={report} onBack={() => setShowSlides(false)} />;
  }

  return (
    <div className="min-h-screen p-4 lg:p-6">
      {/* Top bar */}
      <div className={`flex items-center justify-between mb-6 transition-all duration-500 ${revealStage >= 1 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}`}>
        <div className="flex items-center gap-4">
          <button onClick={onReset} className="p-2 rounded-lg hover:bg-card/80 transition-colors" data-testid="button-back">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="20" stroke="hsl(185 85% 42%)" strokeWidth="2" />
              <path d="M16 28 L22 28 L25 18 L28 38 L31 22 L34 28 L40 28" stroke="hsl(185 85% 42%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="text-base font-bold" style={{ color: "hsl(185 85% 55%)" }}>HumanOS ANS Report</h1>
              <p className="text-[10px] text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSlides(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: "hsl(185 85% 42%)", color: "white" }}
            data-testid="button-view-report"
          >
            <FileText className="w-4 h-4" />
            View Full Report
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Left sidebar - Patient info */}
        <div className={`col-span-12 lg:col-span-3 transition-all duration-500 ${revealStage >= 1 ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"}`}>
          <PatientSidebar report={report} />
        </div>

        {/* Center - Wellness gauge and autonomic wave */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          <div className={`transition-all duration-700 ${revealStage >= 2 ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <WellnessGauge score={report.wellnessScore} riskLevel={report.riskLevel} />
          </div>
          <div className={`transition-all duration-600 ${revealStage >= 4 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <AutonomicWave
              parasympathetic={report.autonomicBalance.parasympathetic}
              sympathetic={report.autonomicBalance.sympathetic}
              ecgData={report.patientData.ecgData}
            />
          </div>
        </div>

        {/* Right sidebar - Improvement potential / upload */}
        <div className={`col-span-12 lg:col-span-3 transition-all duration-500 ${revealStage >= 3 ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}`}>
          <div className="rounded-2xl bg-card/50 border border-border/30 p-5 space-y-5">
            <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">Risk Assessment</h3>
            <div className={`rounded-xl p-4 ${
              report.riskLevel.includes("High") ? "border-glow-red bg-[hsl(0_72%_51%/0.05)]" :
              report.riskLevel.includes("Moderate") ? "border-glow-orange bg-[hsl(35_90%_55%/0.05)]" :
              report.riskLevel.includes("Low") ? "border-glow-cyan bg-[hsl(185_85%_42%/0.05)]" :
              "border-glow-green bg-[hsl(140_60%_50%/0.05)]"
            }`}>
              <p className="text-sm font-semibold mb-1" style={{
                color: report.riskLevel.includes("High") ? "hsl(0 72% 60%)" :
                       report.riskLevel.includes("Moderate") ? "hsl(35 90% 60%)" :
                       "hsl(140 60% 55%)"
              }}>
                {report.riskLevel}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {report.followUp.rationale}
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground">Dysfunction Markers</h4>
              {Object.entries(report.dysfunctionPatterns).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{formatDysfunctionKey(key)}</span>
                  <span className={`font-medium ${value ? "text-[hsl(0_72%_60%)]" : "text-[hsl(140_60%_55%)]"}`}>
                    {value ? "Detected" : "Clear"}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-border/30">
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Follow-Up</h4>
              <p className="text-sm font-semibold" style={{ color: "hsl(185 85% 55%)" }}>
                Retest: {report.followUp.retestInterval}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom metric cards */}
      <div className={`mt-4 transition-all duration-600 ${revealStage >= 5 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
        <MetricCards report={report} />
      </div>
    </div>
  );
}

function formatDysfunctionKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace("P O T S", "POTS");
}
