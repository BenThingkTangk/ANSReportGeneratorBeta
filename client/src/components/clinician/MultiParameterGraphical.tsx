import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { TrendPanel } from "./mpg/TrendPanel";
import { SpectrogramPanel } from "./mpg/SpectrogramPanel";
import { ScatterPanel } from "./mpg/ScatterPanel";
import { CouplingGrid } from "./mpg/CouplingGrid";
import { RatiosPanel } from "./mpg/RatiosPanel";
import { NumericalSummary } from "./mpg/NumericalSummary";
import { ColomboExplainer } from "./ColomboExplainer";
import { CollapsibleSection } from "./CollapsibleSection";
import { SpectralEstimateBanner } from "./mpg/SpectralEstimateBanner";
import { spectralMode } from "@/lib/spectralProvenance";

interface MultiParameterGraphicalProps {
  report: ANSReport;
}

/**
 * Supercharged replica of Dr. Colombo's PhysioPS "Multi-Parameter Graphical"
 * report — decoded from the uploaded .ans file.
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
  // FOUR-WAY spectral mode (see client/src/lib/spectralProvenance.ts):
  //   stored      → exact PhysioPS values embedded in the .ans
  //   vendor      → plot with Colombo norm bands and normal/abnormal colouring
  //   estimated   → plot the HumanOS waveform estimates, prominently labelled,
  //                 with NO norm bands and NO normal/abnormal colouring
  //   unavailable → honest unavailable card, no numbers
  // The old two-state gate hid genuine measurements behind a "not reproducible"
  // card even when the payload carried them, which is a self-contradiction.
  const mode = spectralMode(report);
  const spectralAvailable = mode === "stored" || mode === "vendor";
  const spectralEstimated = mode === "estimated";

  return (
    <section
      className="space-y-4"
      aria-label="Multi-parameter graphical report"
      data-testid="multi-parameter-graphical"
    >
      <Header report={report} />

      {spectralEstimated ? <SpectralEstimateBanner report={report} /> : null}

      {!mpg ? (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-[12px] text-amber-200/90"
          data-testid="mpg-unavailable"
        >
          Multi-parameter graphical data is not available for this report. Re-upload the .ans file to generate the graphical view.
        </div>
      ) : (
        <>
          {mpg.ecgAvailable ? (
            <TrendPanel
              mpg={mpg}
              spectralAvailable={spectralAvailable}
              spectralEstimated={spectralEstimated}
              report={report}
            />
          ) : (
            <EcgUnavailableNotice report={report} />
          )}

          {/* Stored PhysioPS wavelet spectrogram. Rendered whenever the file
              carries one (it does not depend on the raw ECG being usable),
              with an explicit state when it is absent or unreadable. */}
          {mpg.vendorVisualization || mpg.seriesProvenance ? (
            <SpectrogramPanel mpg={mpg} />
          ) : null}

          <ScatterPanel
            mpg={mpg}
            patientAge={report.patientData.age}
            spectralAvailable={spectralAvailable}
            spectralEstimated={spectralEstimated}
            report={report}
          />

          {mpg.ecgAvailable && (
            <CollapsibleSection
              title="Cardio-Respiratory Coupling"
              subtitle="Per-beat HR overlaid on breathing envelope, one window per phase"
              testId="toggle-coupling"
            >
              <CouplingGrid mpg={mpg} />
            </CollapsibleSection>
          )}

          <RatiosPanel ratios={report.ratios} patientAge={report.patientData.age} />
          <NumericalSummary report={report} />

          {mpg.ecgAvailable && <MethodFooter mpg={mpg} />}
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
      className="ps-glass-featured p-6"
      data-testid="mpg-header"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="ps-overline">
            Clinician — PhysioPS Style Report
          </div>
          <h2 className="ps-text-display text-2xl mt-1">Multi-Parameter Graphical</h2>
          <p className="text-[12px] text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Six-phase Colombo autonomic report decoded from the uploaded .ans, using stored PhysioPS channels when present and waveform-derived values only where explicitly labeled. Every chart below includes Dr. Colombo's plain-English explanation and analogy.
          </p>
        </div>
        <div className="text-right text-[11px] text-muted-foreground space-y-0.5 ps-text-mono">
          <div className="ps-text-display text-foreground tracking-tight" style={{fontFamily:'var(--ps-font-display)'}}>{[p.firstName, p.lastName].filter(Boolean).join(" ") || "—"}</div>
          <div>Age {p.age} · {p.gender}</div>
          <div>Test {p.testDate || new Date(report.generatedAt).toLocaleDateString()}</div>
        </div>
      </div>
    </motion.div>
  );
}

function EcgUnavailableNotice({ report }: { report: ANSReport }) {
  const storedSummary = spectralMode(report) === "stored";
  return (
    <div
      className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5"
      data-testid="mpg-ecg-unavailable"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-amber-300" aria-hidden="true">⚠</div>
        <div className="space-y-1.5">
          <div className="text-[12px] font-semibold text-amber-200">
            Raw ECG waveform not present in this .ans file
          </div>
          <p className="text-[11px] text-amber-200/80 leading-relaxed max-w-2xl">
            {storedSummary
              ? "This file does not expose usable beat-to-beat ECG samples, but its stored PhysioPS six-phase measurements and supported visualization channels remain available below. Only waveform-dependent overlays such as raw ECG coupling are omitted."
              : "This file does not expose usable beat-to-beat ECG samples. Stored or paired-report measurements that are present remain visible below; waveform-dependent trend and coupling overlays are omitted, and absent values remain not assessed."}
          </p>
          <p className="text-[12px] text-amber-100/90 leading-relaxed">
            To generate the trend charts, re-export the test from the PhysioPS system with the raw ECG waveform included.
          </p>
        </div>
      </div>
    </div>
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
      <div className="text-[12px] text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground/90">Spectral method:</span>{" "}
        {mpg.wavelet.type} wavelet ·{" "}
        {mpg.wavelet.cycles > 0
          ? `${mpg.wavelet.cycles} cycles`
          : "cycle count not stored in this file"}{" "}
        · spectral update every {mpg.wavelet.spectralUpdateSec}s
      </div>
      <ColomboExplainer chartKey="waveletMethod" />
    </motion.div>
  );
}
