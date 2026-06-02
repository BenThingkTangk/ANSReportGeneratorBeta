# Evidence-Linked Explanations — Manual QA Checklist

PR4 ships the evidence layer. This checklist verifies the safety
invariants end-to-end. Run after each Supabase migration / API change.

## Pre-flight

- [ ] `supabase/migrations/0004_evidence_links.sql` has been applied.
- [ ] Tables exist: `ans_rule_evidence_links`, `ans_report_explanations`, `app_settings`.
- [ ] `app_settings.evidence_linked_explanations_enabled` row exists with default `false`.
- [ ] Unit tests pass: `npm run test:ans` (expect 57 tests — 48 legacy + 9 new).

## Authorisation

### Public / anonymous

- [ ] `POST /api/explanations` without `Authorization` header → **401**.
- [ ] `GET /api/admin/rule-evidence` without token → **401/403**.
- [ ] `PUT /api/admin/settings` without super_admin → **403**.
- [ ] `POST /api/admin/source-signed-url` without reviewer+ → **403**.

### Reviewer (read-only)

- [ ] Can `GET /api/admin/rule-evidence` (list).
- [ ] Can `GET /api/admin/settings` (read flag).
- [ ] Can `POST /api/admin/source-signed-url` (get signed URLs for active+approved sources).
- [ ] CANNOT `POST` to `/api/admin/rule-evidence` → 403.
- [ ] CANNOT `PUT /api/admin/settings` → 403.
- [ ] CANNOT `DELETE /api/admin/rule-evidence?id=…` → 403.

### Clinical admin

- [ ] Can `POST /api/admin/rule-evidence` to create mappings.
- [ ] CANNOT `DELETE` mappings (super_admin only).
- [ ] CANNOT `PUT /api/admin/settings` (super_admin only).

### Super admin

- [ ] All of the above + can delete mappings + can toggle flag.

## Toggle behaviour

- [ ] With flag = `false`: `POST /api/explanations` returns items with
      `mode: "rule-based"` for every non-blocked bullet, `evidence: []`.
- [ ] Flip flag to `true` via `PUT /api/admin/settings`.
- [ ] Within ≤60s, the next `POST /api/explanations` returns
      `mode: "evidence-backed"` for any rule with an active mapping.
- [ ] Bullets WITHOUT a mapping still get `mode: "rule-based"` and the
      bullet's `text` contains the literal string "Rule-based interpretation".

## Source gating

- [ ] Create a mapping linking a `draft` source — endpoint refuses with
      400 "source must be active_in_ai_analysis=true AND review_status='approved'".
- [ ] Approve + activate a source, link it, generate an explanation — citation appears.
- [ ] Archive that source. Generate an explanation again — citation
      disappears (active+approved gate enforced at READ time too).
- [ ] Wait ≥60s after archiving (cache TTL) — confirm citation stays gone.

## Blocked claims (transparency)

- [ ] Upload an .ans missing ratios — `unsafeOrUnsupportedClaimsBlocked`
      items appear in `summary`, AND become `ExplanationItem`s with
      `mode: "blocked"`.
- [ ] No blocked item ever has an `evidence` array length > 0,
      EVEN when the toggle is on AND a mapping exists for that rule key.

## Private bucket safety

- [ ] `EvidenceLink.url` only ever contains the public `url` column —
      never `file_path`.
- [ ] `POST /api/admin/source-signed-url` for an active+approved source:
      returns a `signedUrl` that opens the PDF.
- [ ] Same endpoint for an archived source: returns 403.
- [ ] Same endpoint for a source with `file_path=null`: returns 404.
- [ ] Signed URL TTL clamps to `[60, 3600]` seconds.

## Audit trail

- [ ] Every `POST /api/explanations` writes one row to
      `ans_report_explanations` (verify in admin UI or via SQL).
- [ ] Each row records `evidence_enabled`, `num_with_evidence`,
      `num_rule_based`, `source_ids[]`, `rule_keys[]`, `generated_by`.
- [ ] No PHI in `ans_report_explanations` (`report_ref` is free-form,
      caller-controlled; UI must not pass patient names).
- [ ] Creating / deleting a mapping writes to `admin_audit_log` with
      action `rule_evidence.create` / `rule_evidence.delete`.
- [ ] Flipping the toggle writes to `admin_audit_log` with action
      `settings.update`.
- [ ] Signed URL requests write `source.signed_url` audit entries.

## Patient-facing language

- [ ] Open `/admin/rule-evidence` and inspect a generated explanation.
- [ ] `patientText` never contains raw rule codes like
      `ORTHO_SBP_DROP_SEVERE` or `parasympathetic_withdrawal`.
- [ ] `patientText` never contains the words "fail", "broken", "error".
- [ ] Blocked items read as gentle "could not be evaluated" phrasing.
- [ ] Disclaimer + patient disclaimer always present.

## Regression gate

- [ ] `npm run eval:ci` still exits 0 — PR4 does NOT change scoring.
- [ ] `npx tsc --noEmit` clean.
