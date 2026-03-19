import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

interface AnalyzingScreenProps {
  progress: number;
  stage: string;
}

export function AnalyzingScreen({ progress, stage }: AnalyzingScreenProps) {
  const [ecgPath, setEcgPath] = useState("");

  useEffect(() => {
    // Generate animated ECG waveform
    const interval = setInterval(() => {
      const points: string[] = [];
      const width = 600;
      const height = 80;
      const mid = height / 2;
      const step = 3;
      for (let x = 0; x < width; x += step) {
        const t = (x + Date.now() * 0.15) * 0.05;
        // ECG-like waveform
        const cycle = t % (Math.PI * 2);
        let y = mid;
        if (cycle > 2.5 && cycle < 2.8) {
          y = mid - 30 * Math.sin((cycle - 2.5) * Math.PI / 0.3); // R peak
        } else if (cycle > 2.8 && cycle < 3.1) {
          y = mid + 10 * Math.sin((cycle - 2.8) * Math.PI / 0.3); // S wave
        } else if (cycle > 1.8 && cycle < 2.2) {
          y = mid - 6 * Math.sin((cycle - 1.8) * Math.PI / 0.4); // P wave
        } else if (cycle > 3.5 && cycle < 4.0) {
          y = mid - 8 * Math.sin((cycle - 3.5) * Math.PI / 0.5); // T wave
        } else {
          y = mid + Math.sin(t * 0.3) * 1.5; // baseline wander
        }
        points.push(`${x === 0 ? "M" : "L"}${x} ${y}`);
      }
      setEcgPath(points.join(" "));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Central analyzing orb */}
      <div className="relative mb-12">
        <div className="w-48 h-48 rounded-full relative flex items-center justify-center">
          {/* Rotating rings */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(185 85% 42% / 0.1)" strokeWidth="1" />
            <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(185 85% 42%)" strokeWidth="2"
              strokeDasharray="40 520" strokeLinecap="round"
              style={{ animation: "spin 3s linear infinite", transformOrigin: "center" }}
            />
            <circle cx="100" cy="100" r="75" fill="none" stroke="hsl(140 60% 50% / 0.1)" strokeWidth="1" />
            <circle cx="100" cy="100" r="75" fill="none" stroke="hsl(140 60% 50%)" strokeWidth="1.5"
              strokeDasharray="30 440" strokeLinecap="round"
              style={{ animation: "spin 5s linear infinite reverse", transformOrigin: "center" }}
            />
            <circle cx="100" cy="100" r="60" fill="none" stroke="hsl(270 60% 55% / 0.1)" strokeWidth="1" />
            <circle cx="100" cy="100" r="60" fill="none" stroke="hsl(270 60% 55%)" strokeWidth="1.5"
              strokeDasharray="25 350" strokeLinecap="round"
              style={{ animation: "spin 4s linear infinite", transformOrigin: "center" }}
            />
          </svg>
          {/* Center percentage */}
          <div className="text-center z-10">
            <div className="text-4xl font-bold tabular-nums" style={{ color: "hsl(185 85% 55%)" }}>
              {Math.round(progress)}%
            </div>
            <div className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mt-1">
              Analyzing
            </div>
          </div>
        </div>
      </div>

      {/* ECG waveform */}
      <div className="w-full max-w-xl mb-8 overflow-hidden rounded-xl bg-card/30 border border-border/30 p-4">
        <svg viewBox="0 0 600 80" className="w-full h-16">
          <path d={ecgPath} className="ecg-path" stroke="hsl(185 85% 50%)" strokeWidth="2" opacity="0.8" />
          <path d={ecgPath} className="ecg-path" stroke="hsl(185 85% 50%)" strokeWidth="4" opacity="0.15" />
        </svg>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xl mb-4">
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Stage label */}
      <p className="text-sm text-muted-foreground text-center font-mono">
        {stage}
      </p>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
