import { useState, useCallback } from "react";
import type { ANSReport } from "@shared/schema";
import type { AnsStudy } from "@shared/ansStudy";
import type { DiagnosticSummary } from "@shared/diagnosticSummary";
import { UploadScreen } from "@/components/UploadScreen";
import { AnalyzingScreen } from "@/components/AnalyzingScreen";
import { ReportDashboard } from "@/components/ReportDashboard";
import { AtomAttribution } from "@/components/AtomAttribution";
import { ParsedDataReview } from "@/components/parsed/ParsedDataReview";
import { apiRequest } from "@/lib/queryClient";
import { resilientUpload } from "@/lib/resilientUpload";

type AppState = "upload" | "parsing" | "review" | "analyzing" | "report";

export default function Dashboard() {
  const [appState, setAppState] = useState<AppState>("upload");
  const [report, setReport] = useState<ANSReport | null>(null);
  const [ansStudy, setAnsStudy] = useState<AnsStudy | null>(null);
  const [diagnosticSummary, setDiagnosticSummary] =
    useState<DiagnosticSummary | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState("");

  /** Step 1: parse-only — give the user a chance to review extraction. */
  const parseFile = useCallback(async (file: File) => {
    setPendingFile(file);
    setAppState("parsing");
    setAnalysisProgress(0);
    setAnalysisStage("Parsing .ans file...");

    // Lightweight progress animation while /api/parse runs.
    const lightStages = [
      { progress: 20, label: "Reading .ans binary file..." },
      { progress: 45, label: "Parsing patient demographics..." },
      { progress: 70, label: "Extracting phase blocks..." },
      { progress: 90, label: "Building normalized AnsStudy..." },
    ];
    let cancelled = false;
    (async () => {
      for (const s of lightStages) {
        if (cancelled) return;
        setAnalysisProgress(s.progress);
        setAnalysisStage(s.label);
        await new Promise(r => setTimeout(r, 220 + Math.random() * 140));
      }
    })();

    try {
      // Resilient upload: 60s timeout, retry-once on 5xx/network, captures
      // x-vercel-id, and surfaces server {error, stage} JSON without throwing.
      const result = await resilientUpload<{
        success: boolean;
        ansStudy?: AnsStudy;
        diagnosticSummary?: DiagnosticSummary;
        error?: string;
        stage?: string;
      }>("/api/parse", file);
      cancelled = true;

      if (result.ok && result.data?.success && result.data.ansStudy) {
        setAnsStudy(result.data.ansStudy);
        setDiagnosticSummary(result.data.diagnosticSummary ?? null);
        setAnalysisProgress(100);
        setAnalysisStage("Parse complete.");
        await new Promise(r => setTimeout(r, 250));
        setAppState("review");
      } else {
        const reqId = result.vercelId ? ` [req:${result.vercelId.slice(-12)}]` : "";
        const stageTag = result.stage ? ` (stage: ${result.stage})` : "";
        const tries = result.attempts.length > 1 ? ` (after ${result.attempts.length} attempts)` : "";
        throw new Error(`${result.error || result.data?.error || `HTTP ${result.status}`}${stageTag}${tries}${reqId}`);
      }
    } catch (error: any) {
      cancelled = true;
      console.error("Parse error:", error);
      setAnalysisStage("Error: " + (error.message || "Parse failed"));
      await new Promise(r => setTimeout(r, 3500));
      setAppState("upload");
      setPendingFile(null);
    }
  }, []);

  /** Step 2: full report generation (existing /api/upload pipeline). */
  const generateReport = useCallback(async () => {
    if (!pendingFile) return;
    setAppState("analyzing");
    setAnalysisProgress(0);

    const stages = [
      { progress: 8, label: "Reading .ans binary file..." },
      { progress: 15, label: "Parsing patient demographics..." },
      { progress: 22, label: "Extracting ECG signal data..." },
      { progress: 30, label: "Detecting R-peaks and RR intervals..." },
      { progress: 38, label: "Computing Heart Rate Variability..." },
      { progress: 45, label: "Performing FFT spectral analysis..." },
      { progress: 52, label: "Calculating RFa (Parasympathetic)..." },
      { progress: 58, label: "Calculating LFa (Sympathetic)..." },
      { progress: 64, label: "Computing Sympathovagal Balance..." },
      { progress: 70, label: "Analyzing baseline phase..." },
      { progress: 76, label: "Analyzing deep breathing response..." },
      { progress: 80, label: "Analyzing Valsalva maneuver..." },
      { progress: 85, label: "Analyzing stand response..." },
      { progress: 90, label: "Pattern recognition: dysfunction classification..." },
      { progress: 94, label: "Generating therapy recommendations..." },
      { progress: 97, label: "Assembling diagnostic report..." },
    ];

    let cancelled = false;
    (async () => {
      for (const stage of stages) {
        if (cancelled) return;
        setAnalysisProgress(stage.progress);
        setAnalysisStage(stage.label);
        await new Promise(r => setTimeout(r, 280 + Math.random() * 200));
      }
    })();

    try {
      const result = await resilientUpload<{
        success: boolean;
        report?: ANSReport;
        ansStudy?: AnsStudy;
        error?: string;
        stage?: string;
      }>("/api/upload", pendingFile, { timeoutMs: 90_000 });
      cancelled = true;

      if (result.ok && result.data?.success && result.data.report) {
        setAnalysisProgress(100);
        setAnalysisStage("Report generation complete.");
        await new Promise(r => setTimeout(r, 600));
        setReport(result.data.report);
        if (result.data.ansStudy) setAnsStudy(result.data.ansStudy);
        setAppState("report");
      } else {
        const reqId = result.vercelId ? ` [req:${result.vercelId.slice(-12)}]` : "";
        const stageTag = result.stage ? ` (stage: ${result.stage})` : "";
        const tries = result.attempts.length > 1 ? ` (after ${result.attempts.length} attempts)` : "";
        throw new Error(`${result.error || result.data?.error || `HTTP ${result.status}`}${stageTag}${tries}${reqId}`);
      }
    } catch (error: any) {
      cancelled = true;
      console.error("Upload error:", error);
      setAnalysisStage("Error: " + (error.message || "Upload failed"));
      await new Promise(r => setTimeout(r, 3000));
      setAppState("review");
    }
  }, [pendingFile]);

  const handleReparse = useCallback(() => {
    if (pendingFile) {
      void parseFile(pendingFile);
    }
  }, [pendingFile, parseFile]);

  const handleBackToUpload = useCallback(() => {
    setAppState("upload");
    setPendingFile(null);
    setAnsStudy(null);
    setDiagnosticSummary(null);
    setAnalysisProgress(0);
  }, []);

  const handleReset = useCallback(() => {
    setAppState("upload");
    setReport(null);
    setAnsStudy(null);
    setDiagnosticSummary(null);
    setPendingFile(null);
    setAnalysisProgress(0);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* PhysioPS Deep Space radial atmosphere (replaces visible dotted grid) */}
      <div
        className="fixed inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 50% -8%, rgba(0,229,160,0.10), transparent 60%)," +
            "radial-gradient(ellipse 60% 45% at 92% 102%, rgba(74,158,255,0.09), transparent 60%)," +
            "radial-gradient(ellipse 60% 45% at 6% 100%, rgba(168,85,247,0.06), transparent 65%)",
        }}
      />

      <div className="relative z-10">
        {appState === "upload" && <UploadScreen onUpload={parseFile} />}
        {(appState === "parsing" || appState === "analyzing") && (
          <AnalyzingScreen progress={analysisProgress} stage={analysisStage} />
        )}
        {appState === "review" && (
          <ParsedDataReview
            ansStudy={ansStudy}
            diagnosticSummary={diagnosticSummary}
            fileName={pendingFile?.name ?? "ans-study"}
            file={pendingFile}
            onBack={handleBackToUpload}
            onReparse={handleReparse}
            onGenerate={generateReport}
          />
        )}
        {appState === "report" && report && (
          <ReportDashboard
            report={report}
            ansStudy={ansStudy ?? undefined}
            onReset={handleReset}
          />
        )}
      </div>
      <AtomAttribution />
    </div>
  );
}
