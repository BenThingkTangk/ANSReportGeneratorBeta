import { useState, useCallback } from "react";
import type { ANSReport } from "@shared/schema";
import { UploadScreen } from "@/components/UploadScreen";
import { AnalyzingScreen } from "@/components/AnalyzingScreen";
import { ReportDashboard } from "@/components/ReportDashboard";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { apiRequest } from "@/lib/queryClient";

type AppState = "upload" | "analyzing" | "report";

export default function Dashboard() {
  const [appState, setAppState] = useState<AppState>("upload");
  const [report, setReport] = useState<ANSReport | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState("");

  const handleFileUpload = useCallback(async (file: File) => {
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

    // Animate through stages
    for (const stage of stages) {
      setAnalysisProgress(stage.progress);
      setAnalysisStage(stage.label);
      await new Promise(r => setTimeout(r, 280 + Math.random() * 200));
    }

    // Actually upload and process
    const formData = new FormData();
    formData.append("ansFile", file);

    try {
      const response = await apiRequest("POST", "/api/upload", undefined, formData);
      const result = await response.json();

      if (result.success && result.report) {
        setAnalysisProgress(100);
        setAnalysisStage("Report generation complete.");
        await new Promise(r => setTimeout(r, 600));
        setReport(result.report);
        setAppState("report");
      } else {
        throw new Error(result.error || "Failed to process file");
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setAnalysisStage("Error: " + (error.message || "Upload failed"));
      await new Promise(r => setTimeout(r, 2000));
      setAppState("upload");
    }
  }, []);

  const handleReset = useCallback(() => {
    setAppState("upload");
    setReport(null);
    setAnalysisProgress(0);
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, hsl(185 85% 42%) 1px, transparent 0)", backgroundSize: "32px 32px" }}
      />

      <div className="relative z-10">
        {appState === "upload" && <UploadScreen onUpload={handleFileUpload} />}
        {appState === "analyzing" && (
          <AnalyzingScreen progress={analysisProgress} stage={analysisStage} />
        )}
        {appState === "report" && report && (
          <ReportDashboard report={report} onReset={handleReset} />
        )}
      </div>
      <PerplexityAttribution />
    </div>
  );
}
