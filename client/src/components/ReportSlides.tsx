import { useState } from "react";
import type { ANSReport } from "@shared/schema";
import { ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Activity, Pill, Clock } from "lucide-react";

interface ReportSlidesProps {
  report: ANSReport;
  onBack: () => void;
}

export function ReportSlides({ report, onBack }: ReportSlidesProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const p = report.patientData;

  const slides = [
    // Slide 1: Title / Patient Info
    () => (
      <div className="flex flex-col h-full">
        <div className="border-b-2 pb-5 mb-8" style={{ borderColor: "hsl(185 85% 42%)" }}>
          <h2 className="text-xl font-bold mb-1">Parasympathetic & Sympathetic Nervous System Assessment</h2>
          <p className="text-sm text-muted-foreground">P&S 4.0 ANS Diagnostic Implication Summary</p>
        </div>
        <div className="rounded-xl p-6 mb-6" style={{ background: "linear-gradient(135deg, hsl(185 85% 42% / 0.1), hsl(270 60% 55% / 0.05))" }}>
          <h3 className="text-sm font-bold mb-4" style={{ color: "hsl(185 85% 55%)" }}>Patient Information</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Patient", `${p.firstName} ${p.lastName}`],
              ["DOB", p.dobString || "N/A"],
              ["Gender", p.gender],
              ["Age", `${p.age}`],
              ["Height", p.height],
              ["BMI", p.bmi?.toFixed(2) || "N/A"],
              ["Physician", `Dr. ${p.physician}`],
              ["Ectopic Beats", `${p.ectopicBeats}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-1.5 border-b border-border/20">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl p-5 border border-border/30">
          <h3 className="text-sm font-bold mb-2">Report Purpose</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Baseline P&S testing to assess Parasympathetic and Sympathetic Nervous System function
            and identify autonomic dysfunction contributing to patient symptoms.
          </p>
        </div>
      </div>
    ),

    // Slide 2: Initial Baseline
    () => {
      const phase = report.phaseResults[0];
      return (
        <div className="flex flex-col h-full">
          <div className="border-b-2 pb-5 mb-6" style={{ borderColor: "hsl(185 85% 42%)" }}>
            <h2 className="text-xl font-bold mb-1">{phase.phase}</h2>
            <p className="text-sm text-muted-foreground">{phase.indication}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">At rest, Patient presents with:</p>
          <div className="space-y-3 flex-1">
            {phase.findings.map((finding, i) => {
              const isNormal = finding.toLowerCase().includes("normal");
              const isBorderline = finding.toLowerCase().includes("borderline");
              return (
                <div key={i} className={`flex items-start gap-3 rounded-lg p-3 ${
                  isNormal ? "bg-[hsl(140_60%_50%/0.05)] border border-[hsl(140_60%_50%/0.15)]" :
                  isBorderline ? "bg-[hsl(35_90%_55%/0.05)] border border-[hsl(35_90%_55%/0.15)]" :
                  "bg-[hsl(0_72%_51%/0.05)] border border-[hsl(0_72%_51%/0.15)]"
                }`}>
                  {isNormal ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(140 60% 55%)" }} /> :
                   <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: isBorderline ? "hsl(35 90% 55%)" : "hsl(0 72% 55%)" }} />}
                  <span className="text-sm">{finding}</span>
                </div>
              );
            })}
          </div>
          {phase.measurements && (
            <div className="grid grid-cols-3 gap-3 mt-6">
              {Object.entries(phase.measurements).map(([key, val]) => (
                <div key={key} className="rounded-lg p-3 bg-card/50 border border-border/20 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">{key}</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: "hsl(185 85% 55%)" }}>{typeof val === 'number' ? val.toFixed(2) : val}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },

    // Slide 3: DB and Valsalva
    () => {
      const phase = report.phaseResults[1];
      return (
        <div className="flex flex-col h-full">
          <div className="border-b-2 pb-5 mb-6" style={{ borderColor: "hsl(270 60% 55%)" }}>
            <h2 className="text-xl font-bold mb-1">{phase.phase}</h2>
            <p className="text-sm text-muted-foreground">{phase.indication}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">During the DB and Valsalva phases, Patient presents with:</p>
          <div className="space-y-3 flex-1">
            {phase.findings.map((finding, i) => {
              const isNormal = finding.toLowerCase().includes("normal");
              return (
                <div key={i} className={`flex items-start gap-3 rounded-lg p-3 ${
                  isNormal ? "bg-[hsl(140_60%_50%/0.05)] border border-[hsl(140_60%_50%/0.15)]" :
                  "bg-[hsl(35_90%_55%/0.05)] border border-[hsl(35_90%_55%/0.15)]"
                }`}>
                  {isNormal ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(140 60% 55%)" }} /> :
                   <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(35 90% 55%)" }} />}
                  <span className="text-sm">{finding}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    },

    // Slide 4: Stand Response
    () => {
      const phase = report.phaseResults[2];
      return (
        <div className="flex flex-col h-full">
          <div className="border-b-2 pb-5 mb-6" style={{ borderColor: "hsl(35 90% 55%)" }}>
            <h2 className="text-xl font-bold mb-1">{phase.phase}</h2>
            <p className="text-sm text-muted-foreground">{phase.indication}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-4">On standing, Patient presents with:</p>
          <div className="space-y-3 flex-1">
            {phase.findings.map((finding, i) => {
              const isNormal = finding.toLowerCase().includes("normal");
              const isHigh = finding.toLowerCase().includes("high") || finding.toLowerCase().includes("risk") || finding.toLowerCase().includes("excess");
              return (
                <div key={i} className={`flex items-start gap-3 rounded-lg p-3 ${
                  isNormal ? "bg-[hsl(140_60%_50%/0.05)] border border-[hsl(140_60%_50%/0.15)]" :
                  isHigh ? "bg-[hsl(0_72%_51%/0.05)] border border-[hsl(0_72%_51%/0.15)]" :
                  "bg-[hsl(35_90%_55%/0.05)] border border-[hsl(35_90%_55%/0.15)]"
                }`}>
                  {isNormal ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(140 60% 55%)" }} /> :
                   <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: isHigh ? "hsl(0 72% 55%)" : "hsl(35 90% 55%)" }} />}
                  <span className="text-sm">{finding}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    },

    // Slide 5: Therapy & Follow-up
    () => (
      <div className="flex flex-col h-full">
        <div className="border-b-2 pb-5 mb-6" style={{ borderColor: "hsl(140 60% 50%)" }}>
          <h2 className="text-xl font-bold mb-1">Therapy Options & Follow-Up</h2>
          <p className="text-sm text-muted-foreground">Based on autonomic and hemodynamic responses</p>
        </div>
        <div className="rounded-xl p-4 mb-6 bg-[hsl(35_90%_55%/0.05)] border border-[hsl(35_90%_55%/0.15)]">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The following options are based solely on the autonomic and hemodynamic responses.
            Ultimately the physician must decide the therapy option based on the patient's specific history.
          </p>
        </div>
        <div className="space-y-4 flex-1">
          {report.therapyRecommendations.map((rec, i) => (
            <div key={i} className="rounded-xl p-4 bg-card/50 border border-border/20">
              <div className="flex items-center gap-2 mb-2">
                <Pill className="w-4 h-4" style={{ color: "hsl(185 85% 55%)" }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(185 85% 55%)" }}>{rec.category}</span>
              </div>
              <p className="text-sm font-semibold mb-1">{rec.intervention}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{rec.details}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-4 mt-4 border-glow-cyan">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4" style={{ color: "hsl(185 85% 55%)" }} />
            <span className="text-sm font-bold">Follow-Up: {report.followUp.retestInterval}</span>
          </div>
          <p className="text-xs text-muted-foreground">{report.followUp.rationale}</p>
        </div>
      </div>
    ),
  ];

  const totalSlides = slides.length;

  return (
    <div className="min-h-screen flex flex-col p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-slides">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5" style={{ color: "hsl(185 85% 55%)" }} />
          P&S 4.0 ANS Report — {p.firstName} {p.lastName}
        </div>
      </div>

      {/* Slide content */}
      <div className="flex-1 max-w-3xl mx-auto w-full">
        <div className="rounded-2xl bg-card/80 border border-border/30 p-8 min-h-[500px] animate-fade-in" key={currentSlide}>
          {slides[currentSlide]()}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 max-w-3xl mx-auto w-full">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30 transition-all hover:bg-card/80"
          data-testid="button-prev-slide"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`w-2 h-2 rounded-full transition-all ${i === currentSlide ? "w-6" : ""}`}
              style={{ background: i === currentSlide ? "hsl(185 85% 42%)" : "hsl(210 12% 25%)" }}
            />
          ))}
          <span className="text-xs text-muted-foreground ml-3">{currentSlide + 1} / {totalSlides}</span>
        </div>
        <button
          onClick={() => setCurrentSlide(Math.min(totalSlides - 1, currentSlide + 1))}
          disabled={currentSlide === totalSlides - 1}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30 transition-all hover:bg-card/80"
          data-testid="button-next-slide"
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Notes */}
      <div className="max-w-3xl mx-auto w-full mt-6 text-[9px] text-muted-foreground/50 leading-relaxed space-y-0.5">
        <p>Due to patient-specific nature of ANS responses, boundary conditions computed from population studies may vary slightly.</p>
        <p>Results must be considered in the context of the patient's medical history, current medications, diagnoses, symptoms, etc.</p>
      </div>
    </div>
  );
}
