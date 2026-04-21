import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { TrendPanel } from "./mpg/TrendPanel";
import { ScatterPanel } from "./mpg/ScatterPanel";
import { CouplingGrid } from "./mpg/CouplingGrid";
import { RatiosPanel } from "./mpg/RatiosPanel";
import { NumericalSummary } from "./mpg/NumericalSummary";
import { ColomboExplainer } from "./ColomboExplainer";

interface MultiParameterGraphicalProps {
  report: ANSReport;
}

/**
 * Supercharged replica of Dr. Colombo's PhysioPS "Multi-Parameter Graphical"
 * report — derived entirely from the uploaded .ans file.
 *
 * Layout (top to bottom):
 *   1) Header banner with patient metadata
 *   2) Three trend charts (HR / Breathing / LFa+RFa) with A-F phase shading
 *   3) Five autonomic response maps (scatter + age-banded)
 *   4) Cardio-respiratory coupling 2×2 grid
 *   5) Time-domain ratios vs age (E/I, Valsalva, 30:15)
 *   6) Numerical summary table (audit trail)
 *   7) Method footer (wavelet parameters)
 *
 * Under every chart: a collapsible Dr. Colombo explainer.
 *
 * If `report.multiParameter` is absent (older reports before STAGE 7.5 shipped)
 * the section renders a graceful fallback instead of crashing.
 */
export function MultiParameterGraphical({ report }: MultiParameterGraphicalProps) {
  const mpg = report.multiParameter;

  return (
    <section
      className="space-y-4"
      aria-label="Multi-parameter graphical report"
      data-testid="multi-parameter-graphical"
    >
      <Header report={report} />

      {!mpg ? (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-[12px] text-amber-200/90"
          data-testid="mpg-unavailable"
        >
          Multi-parameter graphical data is not available for this report. Re-upload the .ans file to generate the graphical view.
        </div>
      ) : (
        <>
          <TrendPanel mpg={mpg} />
          <ScatterPanel mpg={mpg} patientAge={report.patientData.age} />
          <CouplingGrid mpg={mpg} />
          <RatiosPanel ratios={report.ratios} patientAge={report.patientData.age} />
          <NumericalSummary report={report} />

          <MethodFooter mpg={mpg} />
        </>
      )}
    </section>
  );
}

function Header({ report }: { report: ANSReport }) {
  const p = report.patientData;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/5 via-card/50 to-card/30 p-5"
      data-testid="mpg-header"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[9px] uppercase tracking-[0.25em] text-emerald-400/80 font-semibold">
            Clinician — PhysioPS Style Report
          </div>
          <h2 className="text-lg font-semibold mt-1">Multi-Parameter Graphical</h2>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Full-resolution reproduction of the six-phase Colombo autonomic report, derived directly from the uploaded .ans waveform. Every chart below includes Dr. Colombo's own plain-English explanation and analogy.
          </p>
        </div>
        <div className="text-right text-[11px] text-muted-foreground tabular-nums space-y-0.5">
          <div className="font-medium text-foreground/80">{[p.firstName, p.lastName].filter(Boolean).join(" ") || "—"}</div>
          <div>Age {p.age} · {p.gender}</div>
          <div>Test {new Date(report.generatedAt).toLocaleDateString()}</div>
        </div>
      </div>
    </motion.div>
  );
}

function MethodFooter({ mpg }: { mpg: NonNullable<ANSReport["multiParameter"]> }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.35 }}
      className="rounded-2xl bg-card/30 border border-border/20 p-4"
      data-testid="mpg-method-footer"
    >
      <div className="text-[10px] text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground/70">Spectral method:</span>{" "}
        {mpg.wavelet.type} wavelet · {mpg.wavelet.cycles} cycles · spectral update every {mpg.wavelet.spectralUpdateSec}s
      </div>
      <ColomboExplainer chartKey="waveletMethod" />
    </motion.div>
  );
}
