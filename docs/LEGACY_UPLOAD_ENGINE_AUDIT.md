# Legacy upload engine audit

## Audited file and retained code

All legacy clinical logic below is retained in `api/upload.ts`, chiefly inside
`generateColomboReport` and its inlined helpers. It is not the default upload
response. The runtime gate is
`LEGACY_CLINICAL_INTERPRETATION_ENABLED` (`false` by default), enforced in the
`/api/upload` handler after canonical scoring. Raw `.ans` uploads are always
canonical regardless of the flag.

| Legacy area | Paths / symbols | Default-path treatment |
|---|---|---|
| Wellness score and tier | `computeWellness`, `tierFromScore`, `PATTERN_PENALTIES`, `WellnessBreakdown` | `wellnessScore: null`, `wellnessTier: "Not assessed"`, null-like compatibility breakdown |
| Spectral balance labels | `balanceInterpretation`, `autonomicBalance`, `classifyLowSbDriver` | null balance and `Not assessed` |
| Dysfunction patterns | `DysfunctionPatterns`, rules around `parasympatheticDominance`, `parasympatheticExcess`, `parasympatheticWithdrawal`, `sympatheticExcess`, `sympatheticWithdrawal`, `maskedSW`, `advancedAutonomicDysfunction` | all false; canonical phenotype flags come only from `computeDiagnosticSummary` |
| CAN/POTS/orthostatic/vasovagal/presyncope | `CAN`, `POTS`, `orthostaticHypotension`, `vasovagalRisk`, `preSyncopeRisk`, `detectIndicationsLocal` | legacy values removed; `indications: []`; canonical scoring controls supported flags |
| Phase narratives | `phaseFindings`, baseline/DB/Valsalva/Stand builders | `phaseFindings: []` |
| Therapy and follow-up | `therapies`, `contraindications`, follow-up/retest logic | `therapyRecommendations: []`, no contraindication or monitoring recommendation |
| Body-system impacts | `computeBodyImpact` | all systems are `Not assessed`, with no impact conclusion |
| Overall impression and risk | `overall`, `riskLevel`, `energyLevel`, `clinicalFlags` | fixed non-diagnostic compatibility text, no legacy clinical conclusion |
| Vendor handling | baseline vendor assignments in `generateColomboReport` | permitted only after handler reconciliation; values retain `vendor_reported` provenance and `metricSources` precedence |

## Canonical data flow

`api/upload.ts` → `api/_ans/parseStudy.ts` → normalized `AnsStudy` →
`api/_ans/reconcileStudy.ts` → `api/_ans/scoring/index.ts#computeDiagnosticSummary`
→ `api/upload.ts#canonicalClinicalReport` → client report UI.

The canonical response includes direct measurements, raw-ECG derivatives,
provenance, summary confidence, missing domains, the fixed disclaimer, and the
clinician-review requirement. It omits legacy therapeutic, vendor-equivalent,
CAN/baroreflex, body-system, phase, wellness, and overall clinical claims.

## Vendor and AI audit points

Vendor identity is verified in `api/_ans/reconcileVendorIdentity.ts` before the
handler passes metrics to the formatter. `client/src/pages/dashboard.tsx`
withholds the extracted vendor document from report UI unless the server marks
it `matched`. `client/src/components/ProvenanceChip.tsx` defines the only
display labels.

`client/src/components/ClinicianPortalLive.tsx` and
`client/src/components/clinician/ClinicianPortal.tsx` have no automatic
synopsis effect. They make an explicit request to `/api/synopsis` only from
Generate AI draft explanation. `client/src/lib/clinicalAiDraft.ts` models
`draft`/`approved` status, creation/approval timestamps, `session_only`
storage, and `patientVisible: false`. The reviewer UI calls this **Saved as
clinician review draft**. It is not durable persistence: a durable storage
and separately audited patient-publication workflow are unresolved blockers.
Both `client/src/components/PatientPortalTwoColumn.tsx` and
`client/src/components/patient/PatientPortal.tsx` do not call
`/api/synopsis` and cannot render a draft.

At the canonical scoring layer,
`api/_ans/scoring/phenotypes.ts#detectPossibleCanRisk` blocks CAN-risk when
`api/_ans/scoring/adrenergic.ts` marks the result `screenOnly`. Raw `.ans`
cuff-BP data lacks full beat-to-beat BP/baroreflex inputs, so the response
records a `BlockedClaim` instead of a CAN-risk phenotype. This does not claim
clinical validity.

## Explicit non-claims

The legacy code's continued presence does not validate it clinically and does
not establish vendor equivalence. The canonical pipeline does not claim that
raw `.ans` processing reproduces proprietary spectral, baroreflex, P&S, or
vendor diagnostic outputs. Imported vendor PDF data remains vendor-reported
source material, not an application-generated equivalent.
