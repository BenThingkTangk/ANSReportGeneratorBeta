import { motion } from "framer-motion";
import type { ANSReport, Indication } from "@shared/schema";
import { Activity, Heart, AlertCircle, ShieldCheck } from "lucide-react";

interface DiagnosisExplainerProps {
  report: ANSReport;
}

// Patient-friendly explainers per indication code
const EXPLAINERS: Record<string, { title: string; whatItIs: string; everyday: string; doNow: string[]; icon: React.ComponentType<any> }> = {
  CAN: {
    title: "Cardiovascular Autonomic Neuropathy",
    whatItIs: "The nerves that control your heart rate and blood pressure are showing reduced function.",
    everyday: "You may feel dizzy when standing up, get tired easily, or notice your heart racing without reason.",
    doNow: ["Increase fluid + salt intake", "Stand up slowly", "Avoid prolonged standing", "Discuss pacing therapy with your doctor"],
    icon: AlertCircle,
  },
  POTS: {
    title: "Postural Orthostatic Tachycardia",
    whatItIs: "Your heart rate jumps too high when you stand up — more than 30 beats per minute above your seated baseline.",
    everyday: "Standing makes you light-headed, foggy, or shaky. You feel better lying down.",
    doNow: ["Compression garments", "Salt + electrolytes", "Slow position changes", "Recumbent exercise (rowing, swimming)"],
    icon: Heart,
  },
  PRE_POTS: {
    title: "Pre-POTS Pattern",
    whatItIs: "An early POTS-like signature — your heart rate climbs 20–30 BPM on standing.",
    everyday: "Mild dizziness, fatigue, or brain fog when upright for long periods.",
    doNow: ["Increase fluid intake", "Salt with meals", "Counter-pressure maneuvers", "Re-test in 3 months"],
    icon: Heart,
  },
  PE_REST: {
    title: "Parasympathetic Excess at Rest",
    whatItIs: "Your 'rest and digest' system is overactive when sitting quietly.",
    everyday: "Low blood pressure, low mood, sluggish digestion, slow heart rate.",
    doNow: ["Aerobic exercise (low intensity)", "Cold exposure (face, shower)", "Adequate sleep", "Limit sedatives"],
    icon: ShieldCheck,
  },
  SE_REST: {
    title: "Sympathetic Excess at Rest",
    whatItIs: "Your 'fight or flight' system stays activated even when you should be relaxed.",
    everyday: "Anxiety, racing thoughts, poor sleep, elevated resting heart rate.",
    doNow: ["Slow nasal breathing", "HRV biofeedback", "Limit caffeine", "Magnesium glycinate"],
    icon: Activity,
  },
  AAN: {
    title: "Advanced Autonomic Neuropathy",
    whatItIs: "Both arms of the autonomic system are showing reduced response.",
    everyday: "Wide range of symptoms: dizziness, fatigue, GI changes, exercise intolerance.",
    doNow: ["Pacing — avoid push/crash cycles", "Hydration + salt", "Targeted supplementation", "Specialist follow-up"],
    icon: AlertCircle,
  },
  OD_HIGH: {
    title: "Orthostatic Dysfunction (High Risk)",
    whatItIs: "Your sympathetic system fails to compensate when you stand.",
    everyday: "Lightheaded on standing, may feel near-fainting, especially in the morning.",
    doNow: ["Stand slowly with a count of 5", "Compression stockings", "Avoid hot showers", "Discuss midodrine with your doctor"],
    icon: AlertCircle,
  },
  VVS: {
    title: "Vasovagal Syncope Risk",
    whatItIs: "Your body's response pattern matches that of people who experience fainting episodes.",
    everyday: "May faint with stress, blood draws, prolonged standing, or pain.",
    doNow: ["Recognize early warning signs", "Counter-pressure maneuvers", "Stay hydrated", "Sit down at first symptom"],
    icon: AlertCircle,
  },
  CHEYNES_STOKES: {
    title: "Cheyne–Stokes Breathing Pattern",
    whatItIs: "Your breathing waxes and wanes in a cyclical 30–60 second pattern.",
    everyday: "Often noticed during sleep — partner may describe pauses or rhythmic breathing.",
    doNow: ["Sleep study referral", "Cardiac evaluation", "Avoid sleep on back if possible", "CPAP titration if indicated"],
    icon: Activity,
  },
  ORTHOSTATIC_HYPOTENSION: {
    title: "Orthostatic Hypotension",
    whatItIs: "Your blood pressure drops when you stand up.",
    everyday: "Dizzy, blurred vision, or weak when getting up — especially after sitting/lying for a while.",
    doNow: ["Increase salt + water", "Stand in two stages", "Compression to abdomen + legs", "Review medications with your doctor"],
    icon: AlertCircle,
  },
  BARORECEPTOR: {
    title: "Baroreceptor Reflex Reduction",
    whatItIs: "The pressure-sensing reflex in your arteries is responding less than expected.",
    everyday: "Blood pressure swings — can feel light-headed in some positions and pressured in others.",
    doNow: ["Slow positional changes", "Steady hydration", "HRV-paced breathing", "Specialist evaluation"],
    icon: ShieldCheck,
  },
};

const FALLBACK = (code: string, severity: string): typeof EXPLAINERS[string] => ({
  title: code.replace(/_/g, " "),
  whatItIs: `An autonomic finding (${severity.toLowerCase()}) was detected on your test.`,
  everyday: "Your clinician will review this with you in detail.",
  doNow: ["Discuss this finding with your physician at follow-up"],
  icon: Activity,
});

const SEVERITY_STYLES: Record<string, { color: string; bg: string; ring: string; label: string }> = {
  low:      { color: "hsl(140 60% 60%)",  bg: "hsl(140 60% 50% / 0.1)", ring: "hsl(140 60% 50% / 0.3)", label: "Mild" },
  moderate: { color: "hsl(35 90% 60%)",   bg: "hsl(35 90% 55% / 0.1)",  ring: "hsl(35 90% 55% / 0.3)",  label: "Moderate" },
  high:     { color: "hsl(0 75% 62%)",    bg: "hsl(0 75% 55% / 0.1)",   ring: "hsl(0 75% 55% / 0.3)",   label: "Severe" },
};

export function DiagnosisExplainer({ report }: DiagnosisExplainerProps) {
  const indications: Indication[] = (report.indications ?? []);

  if (indications.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="ps-glass rounded-2xl p-6 text-center"
        data-testid="diagnosis-no-findings"
      >
        <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(140 60% 50% / 0.15)" }}>
          <ShieldCheck className="w-6 h-6" style={{ color: "hsl(140 60% 65%)" }} />
        </div>
        <h3 className="text-base font-semibold mb-1">No major findings detected</h3>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Your autonomic nervous system is performing within normal ranges across all measured patterns.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4" data-testid="diagnosis-explainer">
      <div className="flex items-baseline justify-between">
        <h2 className="ps-text-display text-xl font-semibold ps-underline-cyan">
          What We Found
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {indications.length} finding{indications.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-3">
        {indications.map((ind, i) => {
          const code = (ind.code ?? "").split("_")[0] === "OD" ? ind.code : ind.code;
          const expl = EXPLAINERS[ind.code] ?? EXPLAINERS[code] ?? FALLBACK(ind.code, ind.severity);
          const sev = SEVERITY_STYLES[ind.severity] ?? SEVERITY_STYLES.moderate;
          const Icon = expl.icon;

          return (
            <motion.div
              key={ind.code + i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="ps-glass rounded-2xl overflow-hidden"
              style={{ borderColor: sev.ring }}
              data-testid={`explainer-${ind.code}`}
            >
              {/* Header */}
              <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: sev.bg, border: `1px solid ${sev.ring}` }}
                >
                  <Icon className="w-5 h-5" style={{ color: sev.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{expl.title}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: sev.color }}>
                    {sev.label} · {ind.code}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-4 py-4 space-y-3">
                <div>
                  <div className="ps-overline mb-1" style={{ color: "hsl(185 80% 70%)" }}>What this means</div>
                  <p className="text-xs leading-relaxed text-foreground/85">{expl.whatItIs}</p>
                </div>
                <div>
                  <div className="ps-overline mb-1" style={{ color: "hsl(185 80% 70%)" }}>In daily life</div>
                  <p className="text-xs leading-relaxed text-foreground/85">{expl.everyday}</p>
                </div>
                <div>
                  <div className="ps-overline mb-1.5" style={{ color: "hsl(185 80% 70%)" }}>What you can do</div>
                  <ul className="space-y-1">
                    {expl.doNow.map((d, di) => (
                      <li key={di} className="text-xs flex items-start gap-2 text-foreground/85">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                          style={{ background: sev.color }}
                        />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
