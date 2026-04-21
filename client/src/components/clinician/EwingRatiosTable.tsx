import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface EwingRatiosTableProps {
  ratios: ANSReport["ratios"];
}

const severityColor = {
  Normal: "hsl(140 60% 55%)",
  Warning: "hsl(35 90% 55%)",
  Abnormal: "hsl(0 72% 60%)",
};

export function EwingRatiosTable({ ratios }: EwingRatiosTableProps) {
  const rows = [
    { label: "E/I Ratio",       ...ratios.eiRatio },
    { label: "Valsalva Ratio",  ...ratios.valsalvaRatio },
    { label: "30:15 Ratio",     ...ratios.thirtyFifteenRatio },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5 overflow-x-auto"
      data-testid="ewing-ratios-table"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Ewing Autonomic Ratios
      </h3>
      <table className="w-full text-xs border-collapse min-w-[420px]">
        <thead>
          <tr className="border-b border-border/30">
            {["Ratio", "Measured", "Normal Range", "Classification"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const color = severityColor[row.classification.severity] ?? "inherit";
            return (
              <tr key={row.label} className={`border-b border-border/20 ${i % 2 === 0 ? "bg-card/20" : ""}`}>
                <td className="py-2.5 pr-4 font-medium">{row.label}</td>
                <td className="py-2.5 pr-4 tabular-nums font-semibold" style={{ color }}>
                  {row.value.toFixed(2)}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground tabular-nums">{row.normal}</td>
                <td className="py-2.5 pr-4">
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{
                      color,
                      background: `${color.replace(")", " / 0.12)").replace("hsl(", "hsl(")}`,
                      border: `1px solid ${color.replace(")", " / 0.35)").replace("hsl(", "hsl(")}`,
                    }}
                  >
                    {row.classification.label} — {row.classification.severity}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}
