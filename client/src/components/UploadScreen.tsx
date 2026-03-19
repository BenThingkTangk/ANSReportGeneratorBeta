import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Activity, Brain, Zap } from "lucide-react";

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
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Logo and title */}
      <div className="text-center mb-12 animate-fade-in">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="relative">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" className="animate-pulse-glow">
              <circle cx="28" cy="28" r="26" stroke="hsl(185 85% 42%)" strokeWidth="1.5" opacity="0.3" />
              <circle cx="28" cy="28" r="20" stroke="hsl(185 85% 42%)" strokeWidth="2" />
              <path d="M16 28 L22 28 L25 18 L28 38 L31 22 L34 28 L40 28" stroke="hsl(185 85% 42%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(185 85% 55%)" }}>
              HumanOS
            </h1>
            <p className="text-xs tracking-[0.2em] uppercase" style={{ color: "hsl(185 85% 42% / 0.6)" }}>
              ANS Diagnostic Engine
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Advanced Autonomic Nervous System analysis powered by Dr. Colombo's P&S methodology.
          Upload a .ans file to generate a comprehensive diagnostic report.
        </p>
      </div>

      {/* Upload area */}
      <div
        className={`relative w-full max-w-xl transition-all duration-300 ${isDragging ? "scale-[1.02]" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className={`
          rounded-2xl p-12 text-center cursor-pointer transition-all duration-300
          ${isDragging ? "border-glow-cyan bg-[hsl(185_85%_42%/0.05)]" : "border border-border/50 bg-card/50 hover:border-[hsl(185_85%_42%/0.3)] hover:bg-card/80"}
        `}
          onClick={() => fileInputRef.current?.click()}
          data-testid="upload-dropzone"
        >
          <div className={`
            w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center transition-all
            ${isDragging ? "bg-[hsl(185_85%_42%/0.15)]" : "bg-[hsl(185_85%_42%/0.08)]"}
          `}>
            <Upload className="w-9 h-9" style={{ color: "hsl(185 85% 55%)" }} />
          </div>

          <h2 className="text-lg font-semibold mb-2">
            {isDragging ? "Drop your .ans file" : "Upload ANS Data File"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Drag & drop your .ans file or click to browse
          </p>

          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: "hsl(185 85% 42%)", color: "white" }}
          >
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
      <div className="grid grid-cols-3 gap-4 mt-12 max-w-xl w-full animate-slide-in-up" style={{ animationDelay: "0.3s", opacity: 0 }}>
        {[
          { icon: Activity, label: "P&S Analysis", desc: "Spectral HRV analysis" },
          { icon: Brain, label: "AI Diagnostics", desc: "Pattern recognition" },
          { icon: Zap, label: "Real-time", desc: "Instant report generation" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-xl p-4 bg-card/30 border border-border/30 text-center">
            <Icon className="w-5 h-5 mx-auto mb-2" style={{ color: "hsl(185 85% 55%)" }} />
            <p className="text-xs font-medium mb-0.5">{label}</p>
            <p className="text-[10px] text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
