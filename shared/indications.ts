/**
 * Colombo P&S indication detection — Path B port from physio-reporting-tool.
 * Pure function from PhaseMetrics[] (already indexed A=0,B=1,C=2,D=3,E=4,F=5).
 *
 * Detects: CAN, AAN, Resting SE/PE, Dynamic SE Valsalva/Stand, Dynamic PE
 * Valsalva/Stand, Orthostatic Dysfunction (OD) with risk strat, POTS, VVS,
 * Pre-POTS (HR rise 20-30), Baroreceptor reflex (Valsalva BP <10% rise),
 * Diabetic AN risk, Neurogenic syncope risk, Cardiogenic syncope risk,
 * Cheynes-Stokes breathing, White-coat syndrome.
 */

import type { PhaseMetrics } from "./schema";

export interface Indication {
  /** Code key for tagging (e.g. "CAN", "POTS", "VVS"). */
  code: string;
  /** Human-readable name. */
  name: string;
  /** One-paragraph clinical description with measured values. */
  description: string;
  /** "high" — abnormal action, "moderate" — borderline, "low" — informational. */
  severity: "high" | "moderate" | "low";
}

interface DetectInput {
  phases: PhaseMetrics[];
  /** Optional clinical history flags from patient bio. */
  knownDiabetes?: boolean;
  /** Optional baseline office BP (for white-coat detection). */
  officeSBP?: number;
  officeDBP?: number;
  /** Optional EDR breathing trend (for Cheynes-Stokes detection). */
  breathingTrend?: { t: number[]; v: number[] };
  /** Optional HR trend (for Cheynes-Stokes — beat-by-beat or 1Hz). */
  heartRateTrend?: { t: number[]; v: number[] };
}

const pctChange = (a: number, b: number) => (a === 0 ? (b > 0 ? Infinity : 0) : ((b - a) / a) * 100);

/**
 * Detect Cheynes-Stokes breathing pattern: cyclical crescendo-decrescendo
 * respiration with apneic pauses, classically 30-60s period.
 * Heuristic: breathing envelope auto-correlation peak in 30-60s lag range.
 */
function detectCheynesStokes(breathing?: { t: number[]; v: number[] }): boolean {
  if (!breathing || breathing.v.length < 120) return false;
  const v = breathing.v;
  const t = breathing.t;
  if (t.length < 2) return false;
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (dt <= 0) return false;

  // Compute envelope: |v - mean|
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const env = v.map(x => Math.abs(x - mean));

  // Auto-correlate envelope at lags corresponding to 25-65s
  const minLag = Math.max(2, Math.round(25 / dt));
  const maxLag = Math.min(v.length - 1, Math.round(65 / dt));
  if (maxLag <= minLag + 2) return false;

  const envMean = env.reduce((a, b) => a + b, 0) / env.length;
  const envCentered = env.map(x => x - envMean);
  const envVar = envCentered.reduce((a, b) => a + b * b, 0);
  if (envVar < 1e-6) return false;

  let peakCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < envCentered.length; i++) s += envCentered[i] * envCentered[i + lag];
    const corr = s / envVar;
    if (corr > peakCorr) peakCorr = corr;
  }
  // Strong cyclical envelope with period 30-60s ≥ 0.55 normalized auto-corr
  // is consistent with Cheynes-Stokes. Keep threshold conservative.
  return peakCorr > 0.55;
}

export function detectIndications(input: DetectInput): Indication[] {
  const phases = input.phases;
  if (!phases || phases.length === 0) return [];

  const A = phases[0];           // Initial Baseline
  const D = phases[3] || null;   // Valsalva
  const F = phases[phases.length - 1]; // Stand (last phase, usually idx 5)

  const restingLfa = A?.LFa ?? null;
  const restingRfa = A?.RFa ?? null;
  const restingSb  = A?.SB ?? null;
  const restingHr  = A?.meanHR ?? null;
  const restingSbp = A?.SBP ?? null;
  const restingDbp = A?.DBP ?? null;
  const valsalvaLfa = D?.LFa ?? null;
  const valsalvaRfa = D?.RFa ?? null;
  const valsalvaSbp = D?.SBP ?? null;
  const standLfa = F?.LFa ?? null;
  const standRfa = F?.RFa ?? null;
  const standHr  = F?.meanHR ?? null;
  const standSbp = F?.SBP ?? null;
  const standDbp = F?.DBP ?? null;

  const out: Indication[] = [];
  const has = (code: string) => out.some(i => i.code === code);

  // === CAN: RFa < 0.1 at rest ===
  if (restingRfa != null && restingRfa < 0.1) {
    if (restingSb != null && restingSb >= 0.4 && restingSb <= 3.0) {
      out.push({ code: "CAN", name: "Cardiovascular Autonomic Neuropathy (CAN) with normal SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm² (< 0.1 threshold), SB ${restingSb.toFixed(2)} (within normal 0.4–3.0). Findings consistent with CAN with preserved sympathovagal balance.`,
        severity: "high" });
    } else if (restingSb != null && restingSb > 3.0) {
      out.push({ code: "CAN_HIGH_SB", name: "CAN with high SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm², SB ${restingSb.toFixed(2)} (> 3.0). Findings consistent with CAN plus concurrent Sympathetic Excess.`,
        severity: "high" });
    } else if (restingSb != null && restingSb < 0.4) {
      out.push({ code: "CAN_LOW_SB", name: "CAN with low SB",
        description: `Resting RFa ${restingRfa.toFixed(2)} bpm², SB ${restingSb.toFixed(2)} (< 0.4). Findings consistent with CAN plus concurrent Parasympathetic Excess.`,
        severity: "high" });
    } else {
      out.push({ code: "CAN", name: "Cardiovascular Autonomic Neuropathy (CAN)",
        description: `Very low resting parasympathetic activity (RFa ${restingRfa.toFixed(2)} bpm² < 0.1).`,
        severity: "high" });
    }
  }

  // === Resting SE: SB > 3.0 (skip if CAN_HIGH_SB) ===
  if (restingSb != null && restingSb > 3.0 && !has("CAN_HIGH_SB")) {
    out.push({ code: "SE_REST", name: "Resting Sympathetic Excess (SE)",
      description: `Sympathovagal balance ${restingSb.toFixed(2)} (> 3.0) at rest. Associated with hypertension, anxiety, and cardiovascular events.`,
      severity: "high" });
  }

  // === Resting PE: SB < 0.4 (skip if CAN_LOW_SB) ===
  if (restingSb != null && restingSb < 0.4 && !has("CAN_LOW_SB")) {
    out.push({ code: "PE_REST", name: "Resting Parasympathetic Excess (PE)",
      description: `Sympathovagal balance ${restingSb.toFixed(2)} (< 0.4) at rest. Associated with depression, fatigue, exercise intolerance, GI motility issues.`,
      severity: "moderate" });
  }

  // === AAN: LFa in [0.1, 0.5) OR RFa < 0.5 ===
  const aanFromLfa = restingLfa != null && restingLfa >= 0.1 && restingLfa < 0.5;
  const aanFromRfa = restingRfa != null && restingRfa < 0.5;
  if (aanFromLfa || aanFromRfa) {
    const parts = [];
    if (aanFromLfa) parts.push(`LFa ${restingLfa!.toFixed(2)} bpm²`);
    if (aanFromRfa) parts.push(`RFa ${restingRfa!.toFixed(2)} bpm²`);
    out.push({ code: "AAN", name: "Advanced Autonomic Neuropathy (AAN)",
      description: `Very low autonomic activity at rest (${parts.join("; ")}). Findings consistent with significant autonomic nerve damage.`,
      severity: "high" });
  }

  // === Dynamic SE — Valsalva: LFa > 500% increase ===
  if (restingLfa != null && valsalvaLfa != null && restingLfa > 0 && pctChange(restingLfa, valsalvaLfa) > 500) {
    out.push({ code: "SE_VALSALVA", name: "Dynamic Sympathetic Excess (SE) — Valsalva",
      description: `Sympathetic surge during Valsalva: LFa ${restingLfa.toFixed(2)} → ${valsalvaLfa.toFixed(2)} bpm² (+${pctChange(restingLfa, valsalvaLfa).toFixed(0)}%). Associated with hypertension and anxiety.`,
      severity: "moderate" });
  }

  // === Dynamic SE — Standing: LFa > 500% increase ===
  if (restingLfa != null && standLfa != null && restingLfa > 0 && pctChange(restingLfa, standLfa) > 500) {
    out.push({ code: "SE_STAND", name: "Dynamic Sympathetic Excess (SE) — Standing",
      description: `Sympathetic surge on standing: LFa ${restingLfa.toFixed(2)} → ${standLfa.toFixed(2)} bpm² (+${pctChange(restingLfa, standLfa).toFixed(0)}%).`,
      severity: "moderate" });
  }

  // === Dynamic PE — Valsalva: RFa > 600% increase ===
  if (restingRfa != null && valsalvaRfa != null && restingRfa > 0 && pctChange(restingRfa, valsalvaRfa) > 600) {
    out.push({ code: "PE_VALSALVA", name: "Dynamic Parasympathetic Excess (PE) — Valsalva",
      description: `Parasympathetic surge during Valsalva: RFa ${restingRfa.toFixed(2)} → ${valsalvaRfa.toFixed(2)} bpm² (+${pctChange(restingRfa, valsalvaRfa).toFixed(0)}%). Associated with difficult-to-control blood pressure or blood sugar.`,
      severity: "moderate" });
  }

  // === Dynamic PE — Standing: any RFa increase ===
  if (restingRfa != null && standRfa != null && standRfa > restingRfa) {
    out.push({ code: "PE_STAND", name: "Dynamic Parasympathetic Excess (PE) — Standing",
      description: `Parasympathetic activity rose on postural change (RFa ${restingRfa.toFixed(2)} → ${standRfa.toFixed(2)} bpm²). Atypical response — normally parasympathetic withdraws on standing.`,
      severity: "moderate" });
  }

  // === Orthostatic Dysfunction (OD) — risk-stratified ===
  const hasOD = restingLfa != null && standLfa != null && standLfa < restingLfa;
  if (hasOD) {
    const isHighRisk = restingSb != null && (restingSb < 0.4 || restingSb > 3.0);
    const sbNote = restingSb != null ? ` Resting SB ${restingSb.toFixed(2)} (${isHighRisk ? "outside" : "within"} 0.4–3.0).` : "";
    out.push({
      code: isHighRisk ? "OD_HIGH" : "OD_NORMAL",
      name: `Orthostatic Dysfunction (OD) — ${isHighRisk ? "High Risk" : "Normal Risk"}`,
      description: `LFa decreased rest → standing (${restingLfa!.toFixed(2)} → ${standLfa!.toFixed(2)} bpm²). Consistent with impaired sympathetic support of posture.${sbNote}`,
      severity: isHighRisk ? "high" : "moderate",
    });
  }

  // === POTS: OD AND (HR rise > 30 bpm OR standing HR > 120) ===
  if (hasOD && standHr != null && restingHr != null) {
    const rise = standHr - restingHr;
    if (rise > 30 || standHr > 120) {
      out.push({ code: "POTS", name: "Postural Orthostatic Tachycardia Syndrome (POTS)",
        description: `OD with HR rise of ${rise.toFixed(0)} bpm on standing (${restingHr.toFixed(0)} → ${standHr.toFixed(0)})${standHr > 120 ? ", exceeding 120 bpm" : ""}.`,
        severity: "high" });
    } else if (rise >= 20 && rise <= 30) {
      // Pre-POTS: 20-30 bpm rise on standing without other criteria
      out.push({ code: "PRE_POTS", name: "Pre-POTS",
        description: `Borderline orthostatic tachycardia: HR rose ${rise.toFixed(0)} bpm on standing (${restingHr.toFixed(0)} → ${standHr.toFixed(0)}). Below the 30 bpm POTS threshold but warrants monitoring.`,
        severity: "moderate" });
    }
  }

  // === Vasovagal Syncope (VVS) ===
  if (restingLfa != null && standLfa != null && restingLfa > 0 &&
      restingRfa != null && standRfa != null &&
      standLfa > 5 * restingLfa && standRfa > restingRfa) {
    out.push({ code: "VVS", name: "Vasovagal Syncope (VVS) Predisposition",
      description: `Large sympathetic surge on standing (LFa ${restingLfa.toFixed(2)} → ${standLfa.toFixed(2)} bpm²) with concurrent parasympathetic excess (RFa ${restingRfa.toFixed(2)} → ${standRfa.toFixed(2)}). Pattern consistent with predisposition to fainting on postural change.`,
      severity: "high" });
  }

  // === Baroreceptor reflex impairment: Valsalva SBP rise < 10% ===
  if (restingSbp != null && valsalvaSbp != null && restingSbp > 0) {
    const sbpRisePct = pctChange(restingSbp, valsalvaSbp);
    if (sbpRisePct < 10) {
      out.push({ code: "BARORECEPTOR", name: "Baroreceptor Reflex Impairment",
        description: `Systolic BP rose only ${sbpRisePct.toFixed(1)}% during Valsalva (${restingSbp} → ${valsalvaSbp} mmHg, expected ≥10%). Consistent with impaired baroreceptor sensitivity.`,
        severity: "moderate" });
    }
  }

  // === Diabetic Autonomic Neuropathy risk ===
  // CAN/AAN + history of diabetes (or hyperglycemic indicators) → flag
  if (input.knownDiabetes && (has("CAN") || has("AAN") || has("CAN_HIGH_SB") || has("CAN_LOW_SB"))) {
    out.push({ code: "DAN", name: "Diabetic Autonomic Neuropathy Risk",
      description: "Patient history of diabetes combined with measured autonomic neuropathy findings. Standard diabetic AN management, glycemic control, and tighter cardiovascular monitoring are warranted.",
      severity: "high" });
  }

  // === Neurogenic syncope risk: OD-high + AAN/CAN ===
  if ((has("OD_HIGH") || has("VVS")) && (has("AAN") || has("CAN") || has("CAN_HIGH_SB") || has("CAN_LOW_SB"))) {
    out.push({ code: "NEUROGENIC_SYNCOPE", name: "Neurogenic Syncope Risk",
      description: "Combined orthostatic dysfunction (high risk) and autonomic neuropathy markers raise concern for neurogenic syncope. Counsel patient on fall precautions; consider tilt-table referral.",
      severity: "high" });
  }

  // === Cardiogenic syncope risk: bradycardia + low LFa response on stand ===
  if (restingHr != null && restingHr < 50 && hasOD) {
    out.push({ code: "CARDIOGENIC_SYNCOPE", name: "Cardiogenic Syncope Risk",
      description: `Resting bradycardia (${restingHr.toFixed(0)} bpm) with orthostatic dysfunction. Consider cardiology evaluation for sinus node or conduction system disease.`,
      severity: "high" });
  }

  // === Cheynes-Stokes breathing ===
  if (detectCheynesStokes(input.breathingTrend)) {
    out.push({ code: "CHEYNES_STOKES", name: "Cheynes-Stokes Breathing",
      description: "Cyclical crescendo-decrescendo breathing pattern (period 30-60s) detected in the respiratory envelope. Often associated with congestive heart failure, stroke, or central sleep apnea.",
      severity: "high" });
  }

  // === White-coat syndrome: office BP much higher than test resting BP ===
  if (input.officeSBP != null && restingSbp != null) {
    const sbpDelta = input.officeSBP - restingSbp;
    const dbpDelta = (input.officeDBP ?? 0) - (restingDbp ?? 0);
    if (sbpDelta > 20 || dbpDelta > 10) {
      out.push({ code: "WHITE_COAT", name: "White-Coat Syndrome",
        description: `Office BP (${input.officeSBP}/${input.officeDBP ?? "?"}) markedly higher than test resting BP (${restingSbp}/${restingDbp ?? "?"}). Consistent with white-coat hypertension. Consider home/ambulatory BP monitoring before initiating antihypertensives.`,
        severity: "moderate" });
    }
  }

  // Avoid duplicate stand metrics if standSbp/standDbp suggests profound orthostatic hypotension
  if (restingSbp != null && standSbp != null && (restingSbp - standSbp) >= 20) {
    out.push({ code: "ORTHOSTATIC_HYPOTENSION", name: "Orthostatic Hypotension (BP)",
      description: `SBP fell ≥20 mmHg on standing (${restingSbp} → ${standSbp}). Meets BP-criteria for orthostatic hypotension.`,
      severity: "high" });
  }
  if (restingDbp != null && standDbp != null && (restingDbp - standDbp) >= 10) {
    if (!has("ORTHOSTATIC_HYPOTENSION")) {
      out.push({ code: "ORTHOSTATIC_HYPOTENSION", name: "Orthostatic Hypotension (BP)",
        description: `DBP fell ≥10 mmHg on standing (${restingDbp} → ${standDbp}). Meets BP-criteria for orthostatic hypotension.`,
        severity: "high" });
    }
  }

  return out;
}
