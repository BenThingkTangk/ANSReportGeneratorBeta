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
  PE_STAND: {
    title: "Parasympathetic Excess on Standing",
    whatItIs: "When you stand, your 'rest and digest' system spikes instead of stepping back — the opposite of the normal response.",
    everyday: "Dizziness, unsteady blood pressure, or a wave of fatigue when you get to your feet.",
    doNow: ["Stand up in two slow stages", "Hydration + salt", "Counter-pressure maneuvers (leg crossing, buttock squeeze)", "Discuss with your doctor"],
    icon: ShieldCheck,
  },
  PE_VALSALVA: {
    title: "Parasympathetic Excess during Valsalva",
    whatItIs: "During the bear-down (Valsalva) part of the test, your vagal 'brake' engaged more strongly than expected.",
    everyday: "May go with low resting heart rate and a tendency to feel faint when straining, coughing, or lifting.",
    doNow: ["Avoid heavy straining/breath-holding", "Exhale through exertion", "Stay hydrated", "Mention to your physician"],
    icon: ShieldCheck,
  },
  SE_STAND: {
    title: "Sympathetic Excess on Standing",
    whatItIs: "Your 'fight or flight' system over-fires when you stand, pushing heart rate and vascular tone higher than needed.",
    everyday: "Racing heart, jitteriness, or a pressured feeling when upright; sometimes trouble settling afterward.",
    doNow: ["Slow, paced breathing on standing", "Limit caffeine", "Gentle recumbent-to-upright conditioning", "Discuss with your doctor"],
    icon: Activity,
  },
  SE_VALSALVA: {
    title: "Sympathetic Excess during Valsalva",
    whatItIs: "During the bear-down (Valsalva) maneuver your sympathetic surge was larger than the typical response.",
    everyday: "Blood-pressure spikes with straining or stress; can feel tense or wired.",
    doNow: ["Breathe out through exertion — don't hold your breath", "Stress-reduction / HRV biofeedback", "Limit stimulants", "Physician follow-up"],
    icon: Activity,
  },
  CAN_HIGH_SB: {
    title: "Cardiovascular Autonomic Neuropathy (Sympathetic-Predominant)",
    whatItIs: "Reduced autonomic nerve function with the balance tipped toward the 'fight or flight' side (high sympathovagal balance).",
    everyday: "Elevated resting heart rate, poor stress recovery, and dizziness on standing can occur together.",
    doNow: ["Hydration + salt", "Paced breathing / stress reduction", "Targeted supplementation as advised", "Specialist follow-up"],
    icon: AlertCircle,
  },
  CAN_LOW_SB: {
    title: "Cardiovascular Autonomic Neuropathy (Parasympathetic-Predominant)",
    whatItIs: "Reduced autonomic nerve function with the balance tipped toward the 'rest and digest' side (low sympathovagal balance).",
    everyday: "Fatigue, low blood pressure, sluggish digestion, and exercise intolerance are common.",
    doNow: ["Low-intensity aerobic conditioning", "Hydration + salt", "Adequate sleep", "Specialist follow-up"],
    icon: AlertCircle,
  },
  DAN: {
    title: "Diabetic / Diffuse Autonomic Neuropathy",
    whatItIs: "A broad reduction in autonomic nerve function affecting several body systems.",
    everyday: "May include dizziness, digestive changes, temperature or sweating changes, and exercise intolerance.",
    doNow: ["Optimize any underlying metabolic condition with your doctor", "Pacing to avoid push/crash", "Hydration + salt", "Specialist referral"],
    icon: AlertCircle,
  },
  NEUROGENIC_SYNCOPE: {
    title: "Neurogenic Syncope Pattern",
    whatItIs: "Your autonomic pattern matches fainting that originates from nerve-signaling rather than the heart's pump.",
    everyday: "Fainting or near-fainting triggered by standing, heat, emotion, or pain.",
    doNow: ["Recognize early warning signs and sit/lie down", "Counter-pressure maneuvers", "Hydration + salt", "Discuss tilt-table testing with your doctor"],
    icon: AlertCircle,
  },
  CARDIOGENIC_SYNCOPE: {
    title: "Cardiogenic Syncope Risk",
    whatItIs: "Features that can be associated with fainting arising from the heart itself — this warrants prompt cardiac review.",
    everyday: "Fainting with little warning, sometimes during exertion or lying down; may feel palpitations.",
    doNow: ["Seek cardiac evaluation promptly", "Avoid strenuous exertion until cleared", "Do not drive if you have unexplained fainting", "Follow your physician's guidance"],
    icon: AlertCircle,
  },
  WHITE_COAT: {
    title: "White-Coat Response",
    whatItIs: "Your readings suggest a stress response to the testing situation itself, which can transiently raise blood pressure and heart rate.",
    everyday: "Numbers may look higher in clinic than they do at home during normal daily life.",
    doNow: ["Consider home BP monitoring", "Relaxed, paced breathing before readings", "Share home readings with your doctor", "Re-test in a calm setting"],
    icon: ShieldCheck,
  },
  OD_NORMAL: {
    title: "Orthostatic Response — Within Normal Limits",
    whatItIs: "Your blood pressure and heart-rate response to standing fell within the expected range.",
    everyday: "You are unlikely to feel dizzy or faint from position changes on this measure.",
    doNow: ["Maintain good hydration", "Keep up regular activity", "No specific action needed for this finding"],
    icon: ShieldCheck,
  },
};

// Safety net for any code without authored copy. It must NEVER surface a raw
// code (e.g. "SE_VALSALVA") to the patient — it renders a neutral, human title
// so a missing entry degrades gracefully instead of showing a boilerplate code.
const FALLBACK = (_code: string, severity: string): typeof EXPLAINERS[string] => ({
  title: "Autonomic Finding",
  whatItIs: `Your test flagged an autonomic pattern (${severity.toLowerCase()} significance) that your clinician will interpret in context.`,
  everyday: "Your clinician will review what this means for you in detail.",
  doNow: ["Discuss this finding with your physician at your follow-up"],
  icon: Activity,
});

const SEVERITY_STYLES: Record<string, { color: string; bg: string; ring: string; label: string }> = {
  low:      { color: "hsl(140 60% 60%)",  bg: "hsl(140 60% 50% / 0.1)", ring: "hsl(140 60% 50% / 0.3)", label: "Mild" },
  moderate: { color: "hsl(17 100% 60%)",   bg: "hsl(35 90% 55% / 0.1)",  ring: "hsl(35 90% 55% / 0.3)",  label: "Moderate" },
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
                    {/* Patient-facing: show severity only, never the raw indication
                        code (S4-2). Clinicians see codes in the clinician view. */}
                    {sev.label}
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
