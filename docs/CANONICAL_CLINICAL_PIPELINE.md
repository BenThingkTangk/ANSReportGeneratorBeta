# Canonical clinical pipeline

## Scope and boundary

`api/upload.ts` is the upload boundary. It parses the binary upload with
`api/_ans/parseStudy.ts`, keeps the normalized `AnsStudy` and its per-field
provenance, and runs `api/_ans/scoring/index.ts#computeDiagnosticSummary`.
`computeDiagnosticSummary` is the only default-path creator of clinical
findings, phenotype labels, report confidence, missing/not-assessed domains,
and deterministic clinical conclusions.

The default response is a canonical compatibility report:

1. `parseStudy({ buffer, fileName })` extracts direct `.ans` data.
2. `ansStudyToLegacy` supplies measurement compatibility fields only.
3. The server reconciles a paired vendor payload with
   `reconcileVendorIdentity` before applying any vendor number.
4. `reconcileStudyWithReport` supplies supported measured values to the
   canonical scorer; `computeDiagnosticSummary` produces the summary.
5. `canonicalClinicalReport` removes legacy wellness, tier, risk, phase
   finding, therapy, body-impact, indication, phenotype, and impression
   outputs while retaining measured phase data, explicit provenance,
   `diagnosticSummary`, confidence, missing domains, the non-diagnostic
   disclaimer, and `Clinician review required`.

The response carries `report.clinicalPipeline.mode === "canonical"` and
`report.clinicalPipeline.clinicianReviewRequired === true`. Compatibility
fields use `null`, `Not assessed`, empty arrays, or all-false pattern maps;
they are not clinical interpretations.

## Legacy flag

The audited inlined formatter remains in `api/upload.ts#generateColomboReport`
for a controlled migration only. It is never the default response path.

`LEGACY_CLINICAL_INTERPRETATION_ENABLED` is `false` unless the server
environment variable of the same name is exactly `true`. Even when true, a raw
`.ans`-only upload remains canonical. The legacy path can be selected only for
a matched paired-vendor upload. If canonical scoring fails while the flag is
off, `/api/upload` fails closed with HTTP 422 instead of returning legacy
clinical content.

## Vendor PDF rules

Vendor values arrive through the `x-vendor-metrics` request header after the
client's PDF extraction step. The server alone decides whether to use them:

- `api/_ans/reconcileVendorIdentity.ts` must return a match on patient name and
  test date, with DOB checked when present.
- A mismatch, missing identity, or malformed payload is withheld and surfaced
  as `vendorReconciliationWarnings`; it is never silently applied.
- Matched displayed spectral fields use `vendor_reported` provenance.
- `report.metricSources` retains both `directAns` and `vendorReported` values,
  the displayed value, its precedence, and its display provenance. A vendor
  value is therefore not a silent overwrite of a direct `.ans` value.
- `client/src/pages/dashboard.tsx` passes `vendorExtraction` to report views
  only when `report.vendorReconciliation.status === "matched"`.
- `client/src/components/VendorReconciliationBanner.tsx` labels the content
  “Imported from paired vendor report — identity matched.”

The shared UI vocabulary is implemented in
`client/src/components/ProvenanceChip.tsx` and is limited to: `Measured from
.ans`, `Derived from raw ECG`, `Imported from paired vendor PDF`, `Generic
research threshold`, `AI draft explanation`, `Clinician-approved conclusion`,
and `Not assessed`.

## AI draft and approval workflow

No report page load calls `/api/synopsis`.

- `client/src/components/ClinicianPortalLive.tsx` and the fallback
  `client/src/components/clinician/ClinicianPortal.tsx` expose the
  clinician-only **Generate AI draft explanation** action.
- `client/src/lib/clinicalAiDraft.ts` stores a structured in-session object:
  `text`, `status` (`draft` or `approved`), `createdAt`, `approvedAt`,
  `storage: "session_only"`, and `patientVisible: false`.
- The UI labels a new object **Saved as clinician review draft**. Approval is
  explicit and adds `approvedAt`; it only permits clinician rendering in that
  browser session.
- `client/src/components/clinician/ClinicianSynopsis.tsx` labels it `AI draft
  explanation` and requires **Approve for clinician rendering** before it
  replaces the deterministic clinician synopsis.
- `client/src/components/PatientPortalTwoColumn.tsx` and
  `client/src/components/patient/PatientPortal.tsx` have no synopsis API call
  and have no AI-draft state or prop. They render deterministic patient text
  only.

There is currently **no durable draft persistence or patient-publication
endpoint**. The session-only state is the implemented safety boundary, not a
complete durable approval workflow. Durable clinician draft storage plus a
separate, audited patient-publication approval endpoint remain required before
any AI text can be made patient-visible.

## CAN and baroreflex limitation

`api/_ans/scoring/adrenergic.ts` marks raw `.ans` cuff-BP analysis as
`screenOnly`: it lacks beat-to-beat BP, Valsalva late phase II/phase IV, and
pressure-recovery data. `api/_ans/scoring/phenotypes.ts` therefore converts
possible-CAN risk to `unsafeOrUnsupportedClaimsBlocked` whenever the
adrenergic result is screen-only. It never emits a CAN-risk phenotype flag
from that input. This is a safety limitation, not clinical validation.

## Non-claims

This pipeline is clinical decision support, not a diagnosis. It does not claim
clinical validation of the application, equivalence to a vendor's proprietary
algorithm, or equivalence of calculated/raw-ECG values to vendor PDF outputs.
Vendor content is displayed as imported source material only after identity
reconciliation. Missing data is `Not assessed`, never normal or zero.
