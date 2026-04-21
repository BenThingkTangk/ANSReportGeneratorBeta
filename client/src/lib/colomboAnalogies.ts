/**
 * Dr. Joseph Colombo's plain-English explanations and analogies for the
 * PhysioPS-style Multi-Parameter Graphical report.
 *
 * Every string in this file is drawn from the 04-09-2025 consultation
 * transcript (Speaker 3 = Dr. Colombo) and the prior Zoom recordings.
 * Kept verbatim where possible, lightly punctuated for readability.
 *
 * Each chart has three fields so the UI can render them consistently:
 *   - whatThisShows   : objective description of the chart
 *   - whatItMeans     : clinical interpretation tailored to this report
 *   - analogy         : Colombo's signature metaphor/story
 */

export interface ColomboExplanation {
  title: string;
  whatThisShows: string;
  whatItMeans: string;
  analogy: string;
}

export const COLOMBO_EXPLANATIONS: Record<string, ColomboExplanation> = {
  // --- Trend Charts --------------------------------------------------------
  heartRateTrend: {
    title: "Heart Rate — Full Test Trend",
    whatThisShows:
      "Beat-to-beat heart rate across the entire six-phase protocol. Vertical shading marks phases A (Baseline), B (Deep Breathing), C (Recovery), D (Valsalva), E (Recovery), F (Stand).",
    whatItMeans:
      "A healthy autonomic nervous system produces a clear 'signature' on this curve: a gentle sinusoid during deep breathing (RSA), a sharp rise-fall-rise during Valsalva, and a rapid overshoot-then-settle on standing. Flat or chaotic responses point to autonomic dysfunction.",
    analogy:
      "The red peaks you see right after the patient stands up — that is the brain screaming for more blood. The body has just robbed the head of half a liter of circulation, and the heart is compensating at full throttle to get it back. If the peaks never settle, the brain is still yelling ten minutes later — that is orthostatic intolerance in plain sight.",
  },

  breathingTrend: {
    title: "Breathing Envelope — Full Test Trend",
    whatThisShows:
      "ECG-derived respiration (EDR) across the entire test. During Deep Breathing the patient paces at ~0.1 Hz (six breaths per minute); elsewhere they breathe freely.",
    whatItMeans:
      "The breathing signal must sit inside a narrow band (0.09–0.15 Hz) during Phase B for the parasympathetic numbers to be valid. A jittery, irregular sinusoid here almost always means an upper respiratory or pulmonary problem — asthma, post-COVID, chronic bronchitis — not an ANS problem per se.",
    analogy:
      "When the deep-breathing sinusoid looks jittery instead of smooth, that is a pulmonary fingerprint, not an autonomic one. I tell the clinician: before you blame the nerves, look at the lungs. Half the time the patient has undiagnosed reactive airway disease and the ANS numbers are innocent bystanders.",
  },

  lfaRfaTrend: {
    title: "LFa (Sympathetic) vs RFa (Parasympathetic) — Rolling Power",
    whatThisShows:
      "Continuous wavelet power in the low-frequency (LFa, sympathetic/accelerator) and respiratory-frequency (RFa, parasympathetic/brake) bands, updated every 4 seconds.",
    whatItMeans:
      "Watch how the two lines separate in each phase. A healthy response shows RFa surge during Deep Breathing, LFa surge during Valsalva strain, and PS-withdrawal (RFa drop) just before LFa rise on standing. Lines that move together or barely move at all are the hallmark of advanced autonomic dysfunction.",
    analogy:
      "RFa is the brakes of your car. LFa is the accelerator. A healthy nervous system uses them separately and in the right order — you lift your foot off the brake before you press the gas. A stressed nervous system slams both at once, all day long, and eventually wears out the brakes. That is exactly what parasympathetic excess looks like on this trace.",
  },

  // --- Scatter / Response Charts ------------------------------------------
  baselineLfaRfa: {
    title: "Baseline LFa vs RFa (Resting Sympathovagal Balance)",
    whatThisShows:
      "The patient's resting sympathetic (LFa) plotted against resting parasympathetic (RFa), with age-banded normal regions overlaid.",
    whatItMeans:
      "Position tells the story. Low-and-left is depleted autonomic tone. High-and-high with a low LFa/RFa ratio is parasympathetic excess — the patient is 'stomping the brakes' at rest. A ratio below 0.4 is considered advanced dysfunction in our 5,000-patient Chicago cohort.",
    analogy:
      "In the Chicago study we followed five thousand patients. The ones we got into the low-normal window — LFa/RFa between 0.4 and 1.0 — came off forty percent of their medications and had twenty percent fewer hospitalizations within a year. That one dot on this chart predicts more outcomes than most lab panels.",
  },

  deepBreathingRfa: {
    title: "Deep Breathing RFa vs Age",
    whatThisShows:
      "The patient's RFa surge during paced 0.1 Hz breathing plotted against the age-declining normal band.",
    whatItMeans:
      "This is the single cleanest test of vagal (parasympathetic) reserve. If the RFa climbs into the age-banded green region, the vagus is healthy. If it stays flat, the brake pedal has very little travel left.",
    analogy:
      "I call the declining normal band the 'physiologic age' line. A 45-year-old with the Deep Breathing RFa of a 65-year-old has an autonomic nervous system that is twenty years older than their birth certificate. That number is often more actionable than the patient's actual age.",
  },

  valsalvaLfa: {
    title: "Valsalva LFa vs Age",
    whatThisShows:
      "The sympathetic surge during the strain phase of Valsalva, plotted against the age-normal band.",
    whatItMeans:
      "A Valsalva LFa that shoots well above the age band in a patient with otherwise normal resting blood pressure is a stroke-risk signal. It means the cardiovascular system can deliver a dangerous pressure spike under everyday strain — climbing stairs, lifting groceries, straining on the toilet.",
    analogy:
      "Think of Valsalva as lifting something heavy — you take a quick breath, hold it, bear down. If the patient holds that strain more than about twenty seconds, the body triggers an unstoppable sixty-second parasympathetic cascade. That is why elderly patients pass out on the toilet. A high Valsalva LFa on this chart is the early warning.",
  },

  standResponse: {
    title: "Stand Response (F) — Postural Sympathetic Engagement",
    whatThisShows:
      "LFa surge and RFa withdrawal in the first 90 seconds after head-up tilt/active stand, compared to the age band.",
    whatItMeans:
      "Standing is a two-step dance: the brake releases first, then the accelerator presses. If RFa does not drop before LFa climbs, the patient is 'over-accelerating' — which is exhausting, causes palpitations, and eventually produces orthostatic hypotension or POTS.",
    analogy:
      "You are sitting at a green light. What do you do first? You take your foot off the brake — then you press the gas. If you try to do both at once you just burn out the brakes. Standing up is exactly the same. Patients who skip the parasympathetic withdrawal step wear out their cardiovascular system years before their time.",
  },

  rfaExcess: {
    title: "RFa Analysis — Parasympathetic Excess During Challenge",
    whatThisShows:
      "Percent change in RFa from Baseline (A) into Valsalva strain (D) and into Stand (F). Excess rise = parasympathetic excess.",
    whatItMeans:
      "Parasympathetic excess during physical challenge is the fingerprint of chronic vagal over-activation — often from anxiety, chronic pain, post-viral syndromes, or long-standing hypothyroidism. It is the single most common finding we see and the one most patients have never been told about.",
    analogy:
      "These patients are constantly hitting the brakes for every little stress — good, bad, or indifferent. A compliment at work, an argument, a doorbell — the brake slams down. They wear out the brakes faster than any other autonomic pattern, and they usually present as chronic fatigue before they present as anything cardiac.",
  },

  // --- Cardio-Respiratory Coupling Grid (2×2) -----------------------------
  couplingBaseline: {
    title: "Coupling — Baseline (A)",
    whatThisShows:
      "Sixty seconds of beat-to-beat HR overlaid on the breathing envelope during resting baseline. The rhythmic co-variation is Respiratory Sinus Arrhythmia (RSA).",
    whatItMeans:
      "At rest, HR should gently rise on inhalation and fall on exhalation. The depth of that modulation is a direct read-out of vagal tone. Flat coupling at rest is an early warning even when every other number looks normal.",
    analogy:
      "RSA is why we do not smack the floor every time we stand up. Heart rate up on the inhale, down on the exhale — that tiny gear-shift prevents a hundred micro-faints a day. When it is gone, the patient feels lightheaded every time they turn their head.",
  },

  couplingDeepBreathing: {
    title: "Coupling — Deep Breathing (B)",
    whatThisShows:
      "HR and breathing during paced 0.1 Hz breathing. The two curves should lock into a clean sinusoid with a large HR amplitude (the E/I excursion).",
    whatItMeans:
      "This window is the gold standard for vagal reserve. A clean high-amplitude sinusoid = healthy parasympathetic. A shallow, noisy curve = depleted vagal tone.",
    analogy:
      "If the sinusoid here is clean but shallow, the brake pedal works — there is just not much pedal travel left. That is someone who needs breathwork, cold exposure, and sleep — not another medication.",
  },

  couplingValsalva: {
    title: "Coupling — Valsalva (D)",
    whatThisShows:
      "HR and breathing during the 15-second Valsalva strain and release. Watch for the classic four-phase HR pattern: rise, plateau, drop, overshoot.",
    whatItMeans:
      "The overshoot on release is a clean test of baroreflex integrity. A blunted overshoot is one of the earliest signals of autonomic failure — seen long before orthostatic hypotension shows up on a tilt table.",
    analogy:
      "Valsalva is the test I trust most in older patients because you cannot fake it. The body does what the body does. If the overshoot is not there, the baroreflex is not there, and that patient is one bad day away from a syncopal fall.",
  },

  couplingStand: {
    title: "Coupling — Stand (F)",
    whatThisShows:
      "Ninety seconds of HR and breathing across the sit-to-stand transition. The first 15–30 seconds hold the most diagnostic information.",
    whatItMeans:
      "Look for the immediate HR transient (beats 15–20 high, beats 30 low — the 30:15 ratio), then how quickly the curve settles. Sustained tachycardia beyond 90 seconds is POTS; a slow roll with no overshoot is orthostatic hypotension.",
    analogy:
      "Women have smaller hearts than men, period. Add the vasodilatory effect of estrogen and progesterone, and a healthy young woman can still slide from POTS to orthostatic intolerance to orthostatic hypotension over a decade. This stand panel is where we catch that slide before it becomes a fall in the kitchen.",
  },

  // --- Time-Domain Ratios -------------------------------------------------
  eiRatio: {
    title: "E/I Ratio (Deep Breathing)",
    whatThisShows:
      "Maximum HR on exhalation divided by minimum HR on inhalation during paced breathing. Compared to the age-declining normal band.",
    whatItMeans:
      "The cleanest time-domain index of vagal function. Below the normal band = parasympathetic insufficiency. Above = parasympathetic excess.",
    analogy:
      "The E/I ratio is the oldest number in autonomic medicine and still the most honest. If this one is off, something is off — even if the spectral numbers look clean.",
  },

  valsalvaRatio: {
    title: "Valsalva Ratio",
    whatThisShows:
      "Maximum HR during strain divided by minimum HR after release. Age-banded normal region shown.",
    whatItMeans:
      "Primarily indexes baroreflex and sympathetic responsiveness. Low ratios in older patients predict falls; unusually high ratios in younger patients predict hypertensive events under strain.",
    analogy:
      "I had a patient — sympathetic baseline under 0.1, Valsalva ratio through the roof. Virtually no brakes, but a hot accelerator. I told his cardiologist he would have a heart attack or stroke within 72 hours. He had a stroke in 36.",
  },

  thirtyFifteenRatio: {
    title: "30:15 Ratio (Stand)",
    whatThisShows:
      "HR at beat 30 divided by HR at beat 15 after standing. Indexes the fast vagal rebound after the sympathetic transient.",
    whatItMeans:
      "A healthy value is above ~1.03 and declines gently with age. A flat 30:15 with a normal HR rise on stand is a specific fingerprint of vasovagal syncope.",
    analogy:
      "If I see a patient with parasympathetic excess somewhere in the test and a normal HR rise on stand but a flat 30:15 — that is vasovagal syncope. I have never been wrong on that combination.",
  },

  // --- Numerical Summary --------------------------------------------------
  numericalSummary: {
    title: "Numerical Summary",
    whatThisShows:
      "All raw ANS numbers — LFa, RFa, LFa/RFa ratio, HR, BP, SDNN, and time-domain ratios — phase by phase, exactly as they appear on the PhysioPS report.",
    whatItMeans:
      "This is the audit trail. Every colored chart above is derived from these numbers; every recommendation below is justified by them. A clinician should be able to reconstruct the clinical story from this table alone.",
    analogy:
      "I tell every new ANS clinician: the graphical report shows you the song, but the numerical summary is the sheet music. Learn to read the sheet music and you will never be fooled by a pretty chart.",
  },

  // --- Footer: Wavelet / Method ------------------------------------------
  waveletMethod: {
    title: "Spectral Method",
    whatThisShows:
      "Continuous Morlet wavelet decomposition, 5 cycles per spectral window, updated every 4 seconds. Parasympathetic (RFa) band is centered on the patient's fundamental respiratory frequency; sympathetic (LFa) band sits below it.",
    whatItMeans:
      "Using the respiratory frequency as the parasympathetic band — rather than a fixed 0.15–0.4 Hz window — is what makes this analysis work on patients who breathe outside the textbook range (athletes, COPD, anxiety). It is the reason the numbers are valid on people the traditional HRV literature excludes.",
    analogy:
      "We developed this 'low-and-slow' approach originally for astronauts in zero-G — their respiratory frequency is all over the map. It turns out it is also the fix for panic-disorder patients, and it is how we cure parasympathetic excess in the clinic.",
  },
};

export function getExplanation(key: string): ColomboExplanation | undefined {
  return COLOMBO_EXPLANATIONS[key];
}
