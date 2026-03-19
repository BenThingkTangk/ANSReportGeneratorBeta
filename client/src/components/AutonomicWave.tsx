import { useEffect, useRef, useState } from "react";

interface AutonomicWaveProps {
  parasympathetic: number;
  sympathetic: number;
  ecgData: number[];
}

export function AutonomicWave({ parasympathetic, sympathetic, ecgData }: AutonomicWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    let offset = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      offset += 0.5;

      const mid = height / 2;

      // Parasympathetic wave (blue-cyan)
      ctx.beginPath();
      const pGrad = ctx.createLinearGradient(0, 0, width, 0);
      pGrad.addColorStop(0, "hsla(220, 70%, 55%, 0)");
      pGrad.addColorStop(0.2, "hsla(220, 70%, 55%, 0.7)");
      pGrad.addColorStop(0.5, "hsla(200, 80%, 60%, 0.8)");
      pGrad.addColorStop(0.8, "hsla(270, 60%, 60%, 0.6)");
      pGrad.addColorStop(1, "hsla(270, 60%, 60%, 0)");
      ctx.strokeStyle = pGrad;
      ctx.lineWidth = 2.5;

      for (let x = 0; x < width; x++) {
        const t = (x + offset) * 0.015;
        const amplitude = 18 * (parasympathetic / 2);
        const y = mid - amplitude * Math.sin(t) * Math.cos(t * 0.3) - 5 * Math.sin(t * 2.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Parasympathetic fill
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const t = (x + offset) * 0.015;
        const amplitude = 18 * (parasympathetic / 2);
        const y = mid - amplitude * Math.sin(t) * Math.cos(t * 0.3) - 5 * Math.sin(t * 2.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, mid);
      ctx.lineTo(0, mid);
      ctx.closePath();
      const pFill = ctx.createLinearGradient(0, mid - 40, 0, mid);
      pFill.addColorStop(0, "hsla(210, 80%, 55%, 0.08)");
      pFill.addColorStop(1, "hsla(210, 80%, 55%, 0)");
      ctx.fillStyle = pFill;
      ctx.fill();

      // Sympathetic wave (warm red-orange)
      ctx.beginPath();
      const sGrad = ctx.createLinearGradient(0, 0, width, 0);
      sGrad.addColorStop(0, "hsla(340, 70%, 55%, 0)");
      sGrad.addColorStop(0.3, "hsla(15, 80%, 55%, 0.6)");
      sGrad.addColorStop(0.6, "hsla(35, 90%, 55%, 0.7)");
      sGrad.addColorStop(1, "hsla(340, 70%, 55%, 0)");
      ctx.strokeStyle = sGrad;
      ctx.lineWidth = 2.5;

      for (let x = 0; x < width; x++) {
        const t = (x + offset * 0.7) * 0.012;
        const amplitude = 15 * (sympathetic / 2);
        const y = mid + amplitude * Math.sin(t * 1.3) * Math.cos(t * 0.5) + 4 * Math.cos(t * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Sympathetic fill
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const t = (x + offset * 0.7) * 0.012;
        const amplitude = 15 * (sympathetic / 2);
        const y = mid + amplitude * Math.sin(t * 1.3) * Math.cos(t * 0.5) + 4 * Math.cos(t * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, mid);
      ctx.lineTo(0, mid);
      ctx.closePath();
      const sFill = ctx.createLinearGradient(0, mid, 0, mid + 40);
      sFill.addColorStop(0, "hsla(25, 90%, 55%, 0)");
      sFill.addColorStop(1, "hsla(25, 90%, 55%, 0.06)");
      ctx.fillStyle = sFill;
      ctx.fill();

      // Center line
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.strokeStyle = "hsla(210, 10%, 40%, 0.2)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [parasympathetic, sympathetic, ecgData]);

  return (
    <div className="rounded-2xl bg-card/50 border border-border/30 p-5" data-testid="autonomic-wave">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Autonomic Balance
        </h3>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full" style={{ background: "hsl(210 80% 60%)" }} />
            <span className="text-muted-foreground">Parasympathetic</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full" style={{ background: "hsl(25 90% 55%)" }} />
            <span className="text-muted-foreground">Sympathetic</span>
          </span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg"
        style={{ height: "120px" }}
      />
    </div>
  );
}
