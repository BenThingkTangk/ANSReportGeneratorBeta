# HumanOS ANS — Patient & Clinician Portal Rebuild Spec

## Context
Existing React + Vite + Tailwind + shadcn dark-themed medical app at `/home/user/workspace/humanos-ans/`. The algorithm has been upgraded to Colombo V2 (see `api/upload.ts`). The shared types have been refreshed in `shared/schema.ts`. Some existing components reference fields that no longer exist (`heartRateVariability`, `stressIndex`, `phaseResults`, old dysfunction keys) — these must be fixed or rebuilt.

## The Report Shape (from shared/schema.ts)
```ts
interface ANSReport {
  patientData: ANSPatientData; // includes baselineSystolicBP/DBP when known
  wellnessScore: number; // 0-100
  wellnessTier: "Optimal"|"Resilient"|"Balanced"|"Stressed"|"Depleted"|"Critical";
  wellnessBreakdown: { baselineAutonomic, sympathovagalBalance, reflexIntegrity, orthostaticResponse, hrvReserve: {score,weight,contribution,notes[]}, ageMultiplier, rawTotal, ageAdjusted, final };
  riskLevel: string;
  energyLevel: "Low"|"Moderate"|"High";
  autonomicBalance: { parasympathetic, sympathetic, balance, interpretation };
  phaseEvents: PhaseMetrics[6]; // Baseline-A, DB-B, Baseline-C, Valsalva-D, Baseline-E, Stand-F
  ratios: { eiRatio, valsalvaRatio, thirtyFifteenRatio : {value,normal,classification:{label,severity,value,lo,hi}} };
  phaseFindings: { phase, indication, findings[] }[];
  dysfunctionPatterns: { parasympatheticDominance, parasympatheticExcess, parasympatheticWithdrawal, sympatheticExcess, sympatheticWithdrawal, maskedSW, advancedAutonomicDysfunction, CAN, POTS, orthostaticHypotension, vasovagalRisk, preSyncopeRisk, bradycardia, highFRF };
  therapyRecommendations: { category, intervention, dose?, rationale, contraindications?, priority: "primary"|"secondary"|"optional" }[];
  contraindications: string[];
  followUp: { retestInterval, rationale, monitorParameters[] };
  bodySystemImpact: { system: "cardiovascular"|..., impact: -100..+100, label, description }[];
  clinicalFlags: string[];
  overallImpression: string;
  // Optional (filled by /api/synopsis after upload):
  patientSynopsis?: string;
  clinicianSynopsis?: string;
}
```

Each `PhaseMetrics`:
```ts
{ phase, label, duration (mm:ss), durationSec, meanHR, rangeHR, FRF, LFa, RFa, SB, SBP?, DBP?, PP?, MAP?, HRV_SDNN, HRV_RMSSD }
```

## New APIs
- `POST /api/synopsis` — body `{ report }` → `{ success, patientSynopsis, clinicianSynopsis }` (Perplexity Sonar).
- `POST /api/ask-atom` — body `{ messages: [{role,content}], report?, viewerRole: "patient"|"clinician" }` → `{ success, message, citations }`.

## Your Task
Rebuild the report UI so there is:

### 1. View Toggle
Top-right of the report view, a segmented toggle **[Patient | Clinician]**, stored in local React state. Default to Patient on first render.

### 2. Patient Portal (viewerRole="patient")
Must feel **gamified, visually mesmerizing, warm, encouraging**. Medical dark theme with teal accent (already in index.css).

Layout (desktop, top to bottom):

**Header strip** — patient name, age, test date, physician. Compact.

**Hero — Wellness Meter** (keep existing WellnessGauge but upgrade):
- Big circular gauge showing wellnessScore 0-100.
- Tier pill ("Balanced", etc.) with matching color.
- Subtitle: one sentence plain-English interpretation.
- Animated entry. Glow effect.

**Plain-English Synopsis Card** (NEW):
- Large card that fetches `/api/synopsis` on mount and shows `patientSynopsis`.
- While loading: skeleton with shimmer and "Atom is reading your report…" text.
- After loaded: show the synopsis in friendly serif-ish body text (use `font-sans` but semibold with generous line-height).
- Below: small "— powered by Perplexity Sonar" attribution.

**Body System Heatmap** (NEW):
- Stylized front-view body outline (SVG) with 7 regions corresponding to the systems. Use simple anatomical-ish shapes (head, chest, gut, spine, arms, legs).
- Each region color-shifts based on `bodySystemImpact` — red/orange for negative impact, teal/green for positive, grey for neutral.
- Click a region → popover shows label + description + impact value.
- Show all 7 systems listed with mini-meters underneath on narrow viewports.

**Key Metrics Strip**:
- Baseline Heart Rate (phaseEvents[0].meanHR) with status dot (green if 60-100, amber if <60 or >100).
- Blood Pressure (phaseEvents[0].SBP/DBP) — show "92/55" if present, "Not recorded" otherwise.
- Sympathovagal Balance (phaseEvents[0].SB) with "Balanced/Parasympathetic-dominant/Sympathetic-dominant" interpretation.
- Ectopic Beats count.

**Dysfunction Pattern Chips** (only show `true` patterns):
- Render true patterns as amber-outlined pill chips with friendly labels:
  - parasympatheticDominance → "Parasympathetic Dominance at Rest"
  - parasympatheticExcess → "Parasympathetic Excess on Standing"
  - bradycardia → "Low Resting Heart Rate"
  - highFRF → "Breathing Irregularity Noted"
  - etc.
- If none true: green "All Clear" chip.

**Three stacked panels**:
(a) **Supplements to Consider** — filter `therapyRecommendations` for category="Neuroprotective" or category="Therapeutic Target". If empty: "Your physician will advise". Show intervention + dose + rationale. Add contraindications in red below if present.
(b) **Treatments & Lifestyle** — filter for category="Lifestyle" or "Exercise" or "Pharmacological". Same card style. Always include "Discuss with your physician before starting any treatment." footnote.
(c) **Next ANS Test** — show `followUp.retestInterval` as a big friendly card ("Next retest in 3 months"). List the `monitorParameters` as bullet points to watch for.

### 3. Clinician Portal (viewerRole="clinician")
Dense, precise, matches the PDF report layout as closely as possible.

Layout (desktop):

**Header** — same compact strip, plus a badge "CLINICIAN VIEW".

**Clinician Synopsis Card** (NEW) — mirrors patient synopsis card but uses `clinicianSynopsis`. Formal tone, more data-dense formatting.

**6-Phase Event Table** (NEW — critical for PDF parity):
A wide table exactly like the Jill Shah numerical PDF: columns = Phase | Duration | HR mean (range) | FRF | LFa | RFa | SB | BP. Rows = Baseline A, DB B, Baseline C, Valsalva D, Baseline E, Stand F. Color-code cells that are out of Colombo norms (use PhaseMetrics values). Include a small legend below the table: "LFa = Sympathetic Activity (bpm²); RFa = Parasympathetic Activity (bpm²); FRF = Fundamental Respiratory Frequency (Hz); SB = Sympathovagal Balance (LFa/RFa)".

**Ewing Ratios Table** — 3-row table with E/I, Valsalva, 30:15. Columns: Ratio | Measured | Normal | Classification (with colored chip).

**Phase Findings** — render `phaseFindings[]` as three sections (INITIAL BASELINE, DB/VALSALVA, STAND), each with the indication sub-header and findings as bulleted list. Match PDF voice exactly — these strings already contain the Colombo narrative.

**Overall Impression Callout** — highlight the `overallImpression` in a bordered card with an icon.

**Dysfunction Patterns Grid** — all 14 patterns shown as boolean indicators (Detected / Clear) with definitions on hover/tooltip.

**Therapy Options Panel** — grouped by priority (primary > secondary > optional). Each card: intervention name, dose, rationale, and (if any) contraindications list in red.

**Contraindications Panel** — if `contraindications[]` non-empty, render a prominent red-bordered card listing each one. For Jill Shah, this will show the ALA contraindication.

**Wellness Breakdown Panel** — show the 5 sub-scores from `wellnessBreakdown` with their weights and notes. Small horizontal bars.

**Follow-Up & Monitoring** — retestInterval as big text + rationale + bulleted monitorParameters.

**Colombo References Footer**:
"Based on Colombo P&S Methodology — DynaCardia / Physio PS / ANS Element. Key references:
- Colombo et al., *Clinical Autonomic Research* (2004–2019).
- Prendergast P, *Clinical Autonomic Research*, 2001 (ALA neuroprotection).
- Magidenko, 2007; NutritionalReviews.org, 2007 (ALA BP contraindication)."

### 4. Ask Atom Floating Chatbot (NEW)
Always-visible floating button in the lower-right corner of the report page (both patient and clinician views).

- **Collapsed state**: circular button (64px), teal gradient, with the Atom logo (sparkle / orbital SVG icon from Lucide — use `Sparkles`). When hover, expand with slight scale and a tooltip "Ask Atom".
- **Expanded state**: 380px × 560px panel anchored bottom-right, 8px above the bottom edge. Design per the attached screenshot reference at `/home/user/workspace/image-5.jpg`:
  - Header: "Ask Atom" title + subtitle "powered by Perplexity" + close X button.
  - Scrollable message log (user messages right-aligned in teal pills, assistant messages left-aligned in dark cards with small Atom avatar).
  - If no messages yet, show 3 suggested prompts as tappable chips:
    * "What does my score mean for daily life?"
    * "Why is my blood pressure low?"
    * "What should I ask my doctor?"
    (For clinician role: "Explain the Colombo interpretation", "Differential diagnoses?", "Dosing guidance for PE")
  - Input bar at bottom with send button.
- On send: POST to `/api/ask-atom` with `{ messages, report, viewerRole }`. Show typing indicator while awaiting. Append response as assistant message. If citations returned, render them as small numbered links below the message.
- Keep last 10 messages in memory (React state, no localStorage).

## Component Organization
Create these files:
```
client/src/components/patient/
  WellnessMeter.tsx        (upgrade of WellnessGauge)
  PlainEnglishSynopsis.tsx
  BodyHeatmap.tsx          (SVG body outline with region highlighting)
  KeyMetricsStrip.tsx
  PatternChips.tsx
  SupplementsPanel.tsx
  TreatmentsPanel.tsx
  NextTestCard.tsx
  PatientPortal.tsx        (composes everything above)

client/src/components/clinician/
  ClinicianHeader.tsx
  ClinicianSynopsis.tsx
  PhaseEventTable.tsx
  EwingRatiosTable.tsx
  PhaseFindings.tsx
  OverallImpression.tsx
  DysfunctionGrid.tsx
  TherapyOptions.tsx
  ContraindicationsPanel.tsx
  WellnessBreakdownPanel.tsx
  FollowUpPanel.tsx
  ColomboReferences.tsx
  ClinicianPortal.tsx

client/src/components/AskAtom.tsx       (the floating chatbot)
client/src/components/ViewToggle.tsx    (Patient/Clinician segmented toggle)
client/src/components/AtomLogo.tsx      (small SVG mark)
```

Replace or rewrite the following existing files to use the new types:
- `ReportDashboard.tsx` — now just composes the `ViewToggle` + currently-selected portal + `AskAtom`.
- `MetricCards.tsx` — DELETE (logic split into KeyMetricsStrip).
- `ReportSlides.tsx` — DELETE (full-report view no longer needed; clinician portal replaces it).
- `PatientSidebar.tsx` — DELETE.
- `AutonomicWave.tsx` — KEEP, but use `autonomicBalance.parasympathetic` and `.sympathetic` as it already does.
- `WellnessGauge.tsx` — KEEP as-is (used under the hood by WellnessMeter if desired).

## Styling Rules
- Dark medical theme already configured in `client/src/index.css` (teal primary `hsl(185 85% 42%)`, dark surfaces).
- Max heading size in the app is `text-xl` (webapp rule).
- Rounded, generous padding cards (`rounded-2xl`, `p-5`, `border border-border/30`).
- Motion: framer-motion for fade-in, scale, stagger. Reduced-motion aware.
- Typography: Inter body, semibold for display territory.
- Never use localStorage / sessionStorage — React state only.

## Data Fetching
- Add a `useEffect` in `PatientPortal` and `ClinicianPortal` that POSTs `/api/synopsis` with the report on mount if `patientSynopsis` / `clinicianSynopsis` is not already present. Store the response in a local `useState`. Show skeleton while loading. On error, show a retry button.
- Use `apiRequest` from `@/lib/queryClient` (never raw fetch). Remember the `__PORT_5000__` replacement used for deployment.

## Critical: No regressions
- Keep the current `dashboard.tsx` upload → analyzing → report state machine.
- Keep `PerplexityAttribution` global footer.
- The app must build cleanly: `npm run build:vercel` with no TypeScript errors.

## Testing
After building, run `npm run build:vercel` and verify it succeeds. Screenshots aren't required — code review is sufficient.

## Deliverables
1. All new/updated TSX files above.
2. A final `npm run build:vercel` that succeeds.
3. A one-paragraph summary of what you built, plus any assumptions made.
