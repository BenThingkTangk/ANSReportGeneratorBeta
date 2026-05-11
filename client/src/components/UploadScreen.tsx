import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Activity, Brain, Zap } from "lucide-react";
import { PhysioPSPulseNodeLogo } from "./brand/PhysioPSPulseNodeLogo";

interface UploadScreenProps {
  onUpload: (file: File) => void;
}

export function UploadScreen({ onUpload }: UploadScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".ans") || file.name.endsWith(".txt"))) {
      onUpload(file);
    }
  }, [onUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  return (
    <div className="ps-bg-deep min-h-screen flex flex-col items-center justify-center p-6">
      {/* Logo and title */}
      <div className="text-center mb-12 ps-fade-up">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="relative">
            <PhysioPSPulseNodeLogo
              variant="primary"
              title="PhysioPS Pulse Node"
              width={72}
              height={72}
              aria-label="PhysioPS Pulse Node mark"
            />
          </div>
          <div className="text-left">
            <h1 className="ps-text-display text-3xl tracking-tight ps-text-cyan">
              PhysioPS × HumanOS
            </h1>
            <p className="ps-overline mt-1">
              ANS Diagnostic Engine
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Advanced Autonomic Nervous System analysis powered by Dr. Colombo's P&amp;S methodology.
          Upload a <span className="ps-text-mono ps-text-cyan">.ans</span> file to generate a comprehensive diagnostic report.
        </p>
      </div>

      {/* Upload area */}
      <div
        className={`relative w-full max-w-xl transition-all duration-300 ${isDragging ? "scale-[1.02]" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className={`ps-glass-featured p-12 text-center cursor-pointer transition-all duration-300 ${isDragging ? "ps-glow-cyan" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          data-testid="upload-dropzone"
          style={isDragging ? { borderColor: "var(--ps-brand-cyan)" } : undefined}
        >
          <div className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center ps-pulse"
            style={{ background: "oklch(0.85 0.18 200 / 0.10)", border: "1px solid var(--ps-border-strong)" }}>
            <Upload className="w-9 h-9" style={{ color: "var(--ps-brand-cyan)" }} />
          </div>

          <h2 className="ps-text-display text-xl mb-2">
            {isDragging ? "Drop your .ans file" : "Upload ANS Data File"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Drag &amp; drop your <span className="ps-text-mono">.ans</span> file or click to browse
          </p>

          <div className="ps-cta">
            <FileText className="w-4 h-4" />
            Select .ans File
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".ans,.txt"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="file-input"
          />
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-4 mt-12 max-w-xl w-full ps-fade-up" style={{ animationDelay: "300ms" }}>
        {[
          { icon: Activity, label: "P&S Analysis", desc: "Spectral HRV analysis" },
          { icon: Brain, label: "AI Diagnostics", desc: "Pattern recognition" },
          { icon: Zap, label: "Real-time", desc: "Instant report generation" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="ps-glass p-4 text-center">
            <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: "var(--ps-brand-cyan)" }} />
            <p className="text-xs font-medium mb-0.5 ps-text-display">{label}</p>
            <p className="text-[10px] text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
