import { motion } from "framer-motion";

type ViewerRole = "patient" | "clinician";

interface ViewToggleProps {
  role: ViewerRole;
  onChange: (role: ViewerRole) => void;
}

export function ViewToggle({ role, onChange }: ViewToggleProps) {
  return (
    <div
      className="inline-flex rounded-xl p-1 gap-1"
      style={{ background: "hsl(210 18% 10%)", border: "1px solid hsl(210 15% 18%)" }}
      data-testid="view-toggle"
    >
      {(["patient", "clinician"] as ViewerRole[]).map(r => (
        <button
          key={r}
          onClick={() => onChange(r)}
          data-testid={`toggle-${r}`}
          className="relative px-4 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize"
          style={{
            color: role === r ? "white" : "hsl(210 10% 50%)",
            zIndex: 1,
          }}
        >
          {role === r && (
            <motion.div
              layoutId="toggle-pill"
              className="absolute inset-0 rounded-lg"
              style={{ background: "hsl(185 85% 42%)" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            />
          )}
          <span className="relative z-10">{r === "patient" ? "Patient" : "Clinician"}</span>
        </button>
      ))}
    </div>
  );
}
