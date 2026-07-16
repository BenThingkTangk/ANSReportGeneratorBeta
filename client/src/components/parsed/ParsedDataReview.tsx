/**
 * ParsedDataReview
 *
 * Shown after /api/parse returns, before the user commits to generating the
 * full report. Composes every "parsed" card so the user can immediately see:
 *   - what was extracted (with provenance + confidence)
 *   - what is missing
 *   - what conflicts internally
 *   - how confident the system is
 *
 * Top action bar:
 *   - file name
 *   - Re-parse file
 *   - Download Parsed JSON
 *   - Generate Report  (disabled until ansStudy is non-null)
 */
import type { AnsStudy } from "@shared/ansStudy";
import type { DiagnosticSummary } from "@shared/diagnosticSummary";
import { useCallback, useState } from "react";
import { ArrowLeft, RefreshCw, Download, FileCheck2, Sparkles } from "lucide-react";

import { ConfidenceGauge } from "./ConfidenceGauge";
import { DemographicsCard } from "./DemographicsCard";
import { PhaseCard } from "./PhaseCard";
import { RatiosCard } from "./RatiosCard";
import { SympParaCard } from "./SympParaCard";
import { MissingDataCard } from "./MissingDataCard";
import { ConflictingDataCard } from "./ConflictingDataCard";
import { VendorPdfCard } from "./VendorPdfCard";

interface Props {
  ansStudy: AnsStudy | null;
  diagnosticSummary: DiagnosticSummary | null;
  fileName: string;
  /** Underlying File handle, so Re-parse / Generate can re-POST it. */
  file: File | null;
  onBack: () => void;
  onReparse: () => void;
  onGenerate: () => void;
  /** Receives verbatim vendor-reported metrics keyed by metric (LFa/RFa/SB/…). */
  onVendorMetrics?: (metrics: Record<string, number> | null) => void;
  /** Receives the full structured vendor extraction (drives Vendor-Familiar view). */
  onVendorExtraction?: (
    extraction: import("@shared/vendorExtraction").VendorReportExtraction,
    meta?: { source?: "ocr" | "text"; ocrConfidence?: number; fileName?: string },
  ) => void;
}

export function ParsedDataReview({
  ansStudy,
  diagnosticSummary,
  fileName,
  file,
  onBack,
  onReparse,
  onGenerate,
  onVendorMetrics,
  onVendorExtraction,
}: Props) {
  // Block Generate Report while a vendor PDF is being read/OCR'd, so a report is
  // never generated from a half-extracted attachment. Clearing the attachment
  // (cancel/remove) drops the flag and re-enables generation.
  const [vendorBusy, setVendorBusy] = useState(false);
  const canGenerate = !!ansStudy && !!file && !vendorBusy;

  const handleDownloadJson = useCallback(() => {
    if (!ansStudy) return;
    const payload = {
      ansStudy,
      diagnosticSummary: diagnosticSummary ?? null,
      exportedAt: new Date().toISOString(),
      sourceFile: fileName,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = fileName.replace(/\.[^.]+$/, "") || "ans-study";
    a.download = `${base}.parsed.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [ansStudy, diagnosticSummary, fileName]);

  if (!ansStudy) {
    // Defensive fallback — parent should never render us with null study,
    // but show a minimal state instead of crashing.
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-card/50 border border-border/30 p-6 max-w-md text-center">
          <p className="text-sm text-muted-foreground">
            No parsed data yet. Upload a .ans file to begin.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 px-4 py-2 rounded-lg text-xs uppercase tracking-[0.18em] border border-border/50 hover:bg-card/80"
            data-testid="button-review-back"
          >
            Back to upload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 md:px-8 py-6 md:py-10 max-w-7xl mx-auto">
      {/* Top action bar */}
      <header
        className="rounded-2xl bg-card/60 border border-border/40 p-4 md:p-5 mb-5 md:mb-6"
        data-testid="parsed-review-header"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-border/50 hover:bg-card/80 transition-colors shrink-0"
              aria-label="Back to upload"
              data-testid="button-review-back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                Parsed data review
              </div>
              <div
                className="flex items-center gap-2 text-sm md:text-base font-medium truncate"
                title={fileName}
              >
                <FileCheck2
                  className="w-4 h-4 shrink-0"
                  style={{ color: "var(--ps-brand-cyan, #4a9eff)" }}
                />
                <span className="truncate">{fileName}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onReparse}
              disabled={!file}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-reparse"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-parse
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 transition-colors"
              data-testid="button-download-json"
            >
              <Download className="w-3.5 h-3.5" />
              Download JSON
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              title={vendorBusy ? "Finishing vendor PDF extraction… cancel it to generate now" : undefined}
              aria-disabled={!canGenerate}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs uppercase tracking-[0.14em] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: canGenerate
                  ? "linear-gradient(135deg, var(--ps-brand-cyan, #4a9eff) 0%, #00e5a0 100%)"
                  : "var(--muted, #1f2937)",
                color: canGenerate ? "#0a0f1c" : "var(--color-text-muted, #94a3b8)",
                boxShadow: canGenerate
                  ? "0 0 24px rgba(0,229,160,0.25)"
                  : "none",
              }}
              data-testid="button-generate-report"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate Report
            </button>
          </div>
        </div>
      </header>

      {/* Confidence gauge — full-width top */}
      <div className="mb-5 md:mb-6">
        <ConfidenceGauge
          study={ansStudy}
          summary={diagnosticSummary ?? undefined}
        />
      </div>

      {/* Demographics */}
      <div className="mb-5 md:mb-6">
        <DemographicsCard study={ansStudy} />
      </div>

      {/* Test phases — 1 col mobile, 2 col tablet, 4 col wide */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5 mb-5 md:mb-6">
        <PhaseCard
          title="Baseline"
          phaseId="baseline"
          phase={ansStudy.baseline}
        />
        <PhaseCard
          title="Deep breathing"
          phaseId="deepBreathing"
          phase={ansStudy.deepBreathing}
        />
        <PhaseCard
          title="Valsalva"
          phaseId="valsalva"
          phase={ansStudy.valsalva}
        />
        <PhaseCard
          title="Stand / Tilt"
          phaseId="standOrTilt"
          phase={ansStudy.standOrTilt}
        />
      </div>

      {/* Ratios + Symp/Para — 1 col mobile, 2 col desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mb-5 md:mb-6">
        <RatiosCard study={ansStudy} />
        <SympParaCard study={ansStudy} />
      </div>

      {/* Missing + Conflicting — 1 col mobile, 2 col desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mb-5 md:mb-6">
        <MissingDataCard
          study={ansStudy}
          summary={diagnosticSummary ?? undefined}
        />
        <ConflictingDataCard study={ansStudy} />
      </div>

      {/* Optional paired vendor-PDF ingestion (vendor_reported provenance) */}
      <div className="mb-5 md:mb-6">
        <VendorPdfCard
          onIngested={(metrics) => {
            // Fold the verbatim vendor metric list into a keyed map and lift it
            // to the dashboard, which forwards it to /api/upload so report
            // generation unlocks the full Colombo spectral pathway.
            const map: Record<string, number> = {};
            for (const m of metrics) {
              if (typeof m.value === "number" && Number.isFinite(m.value)) map[m.key] = m.value;
            }
            onVendorMetrics?.(Object.keys(map).length > 0 ? map : null);
          }}
          onExtraction={(extraction, meta) => onVendorExtraction?.(extraction, meta)}
          onBusyChange={setVendorBusy}
        />
      </div>

      {/* Footer hint */}
      <p className="text-[11px] text-center text-muted-foreground/70 mt-2">
        Review the extraction above. When ready, click{" "}
        <span className="font-medium text-foreground/80">Generate Report</span>{" "}
        to run the full diagnostic pipeline.
      </p>
    </div>
  );
}
