import type { ANSReport } from "@shared/schema";
import { User, Calendar, Ruler, Weight, Stethoscope, Activity } from "lucide-react";

interface PatientSidebarProps {
  report: ANSReport;
}

export function PatientSidebar({ report }: PatientSidebarProps) {
  const p = report.patientData;

  const infoItems = [
    { icon: User, label: "Gender", value: p.gender },
    { icon: Calendar, label: "Age", value: `${p.age} years` },
    { icon: Ruler, label: "Height", value: p.height },
    { icon: Weight, label: "BMI", value: p.bmi?.toFixed(1) || "N/A" },
    { icon: Stethoscope, label: "Physician", value: `Dr. ${p.physician}` },
    { icon: Activity, label: "Ectopic Beats", value: `${p.ectopicBeats}` },
  ];

  const ratios = [
    { label: "E/I Ratio", value: p.eiRatio, normal: p.eiRatio >= 1.0 && p.eiRatio <= 2.0 },
    { label: "Valsalva Ratio", value: p.valsalvaRatio, normal: p.valsalvaRatio >= 1.1 && p.valsalvaRatio <= 2.5 },
    { label: "30:15 Ratio", value: p.thirtyFifteenRatio, normal: p.thirtyFifteenRatio >= 1.0 && p.thirtyFifteenRatio <= 1.8 },
  ];

  return (
    <div className="rounded-2xl bg-card/50 border border-border/30 p-5 space-y-5" data-testid="patient-sidebar">
      {/* Patient avatar and name */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
          style={{ background: "hsl(185 85% 42% / 0.15)", color: "hsl(185 85% 55%)" }}>
          {p.firstName[0]}{p.lastName[0]}
        </div>
        <div>
          <h2 className="text-sm font-bold">{p.firstName} {p.lastName}</h2>
          <p className="text-[10px] text-muted-foreground">Patient ID: {p.lastName.slice(0,3).toUpperCase()}{p.age}{p.firstName[0]}</p>
        </div>
      </div>

      {/* Demographics */}
      <div className="space-y-2.5">
        {infoItems.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 text-xs">
            <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground flex-1">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>

      {/* Ratios */}
      <div className="pt-3 border-t border-border/30 space-y-3">
        <h4 className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium">Autonomic Ratios</h4>
        {ratios.map(({ label, value, normal }) => (
          <div key={label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium tabular-nums" style={{ color: normal ? "hsl(140 60% 55%)" : "hsl(35 90% 55%)" }}>
                {value.toFixed(2)}
              </span>
            </div>
            <div className="w-full h-1 rounded-full bg-[hsl(210_12%_15%)]">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, (value / 3) * 100)}%`,
                  background: normal
                    ? "linear-gradient(90deg, hsl(185 85% 42%), hsl(140 60% 50%))"
                    : "linear-gradient(90deg, hsl(35 90% 55%), hsl(0 72% 51%))"
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Medical History */}
      <div className="pt-3 border-t border-border/30">
        <h4 className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-medium mb-2">Test Info</h4>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Sampling Rate: {Math.round(1 / p.samplingInterval)} Hz
        </p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Data Points: {p.dataPointCount.toLocaleString()}
        </p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Duration: {((p.dataPointCount * p.samplingInterval) / 60).toFixed(1)} min
        </p>
      </div>
    </div>
  );
}
