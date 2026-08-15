
STOP_SHIP = [
    {"id": "SS-01", "criterion": "Any rule with priority P0 is open (not verified closed by its blocking tests).",
     "rationale": "P0 rules are the clinical-safety spine of the release.", "owner": "qa"},
    {"id": "SS-02", "criterion": "Any high-risk claim class (oncology, fixed cardiovascular-event risk, named diagnosis, treatment or dose, urgency window) is emitted by the engine on any surface.",
     "rationale": "These are the classes with the largest patient-harm and regulatory exposure and none has an approved source.", "owner": "legal_regulatory"},
    {"id": "SS-03", "criterion": "Retrieval returns any passage outside the approved closed corpus, or any citation cannot be resolved to document and page.",
     "rationale": "Observed directly in the walkthrough; contaminates every AI narrative downstream.", "owner": "engineering"},
    {"id": "SS-04", "criterion": "Elevated blood pressure classifies or summarizes as normal on any fixture.",
     "rationale": "A demonstrated false-negative on a routine vital sign.", "owner": "clinical_authority"},
    {"id": "SS-05", "criterion": "A parasympathetic response to Valsalva is labelled low anywhere, or 'parasympathetic withdrawal' appears anywhere.",
     "rationale": "Both were explicitly rejected as physiologically wrong by the clinical authority.", "owner": "clinical_authority"},
    {"id": "SS-06", "criterion": "The same file processed twice produces differing values.",
     "rationale": "Without determinism no clinical claim about the engine is testable.", "owner": "engineering"},
    {"id": "SS-07", "criterion": "Two distinct acquisitions are described as duplicates, or a sub-15% delta is asserted as clinically constant without the clinician stability attestation.",
     "rationale": "Written email direction from the clinical authority.", "owner": "clinical_authority"},
    {"id": "SS-08", "criterion": "Any patient-visible item exists without a matching clinician approval record, or any patient path is reachable in the clinician-only release.",
     "rationale": "Scope and authorship boundary for the first release.", "owner": "product_owner"},
    {"id": "SS-09", "criterion": "The physician-interpretation disclaimer is missing from any view, export or download.",
     "rationale": "Baseline legal posture, already applied to the vendor's other reports.", "owner": "legal_regulatory"},
    {"id": "SS-10", "criterion": "Any rule in needs_clinician_wording status ships as generated clinician-facing text.",
     "rationale": "Prevents engine-invented clinical language filling a gap the clinical authority has not closed.", "owner": "clinical_authority"},
    {"id": "SS-11", "criterion": "Any released artifact claims that prior parity work established clinical accuracy.",
     "rationale": "Numeric parity is necessary, not sufficient; overclaiming it is a regulatory and trust risk.", "owner": "product_owner"},
    {"id": "SS-12", "criterion": "A patient surname or other direct identifier appears in any publishable artifact.",
     "rationale": "PHI containment; identifiers are confined to the internal restricted manifest.", "owner": "qa"},
]

SIGNOFF_MATRIX = [
    {"scope": "Physiologic interpretation, thresholds, classification wording",
     "domains": ["interpretation_ordering", "interpretation", "baseline_estimation", "baseline_semantics",
                 "classification", "longitudinal"],
     "accountable": "clinical_authority", "consulted": ["product_owner"], "informed": ["engineering", "qa"],
     "artifact_of_record": "Signed rule-by-rule disposition in the clinician validation workbook, referencing ledger rule IDs.",
     "gate": "No P0 or P1 clinical rule may be closed without this signature."},
    {"scope": "High-risk claim classes (oncology, cardiovascular-event risk, diagnosis, treatment, urgency)",
     "domains": ["high_risk_claim"],
     "accountable": "legal_regulatory", "consulted": ["clinical_authority"], "informed": ["product_owner", "engineering"],
     "artifact_of_record": "Written approval naming the source document and the permitted wording, or a documented refusal.",
     "gate": "Absent this signature, the claim class remains blocked in code and in the ledger."},
    {"scope": "Regulatory posture, labelling, intended use, terminology references",
     "domains": ["regulatory", "disclaimers", "wording_safety", "governance_claims"],
     "accountable": "legal_regulatory", "consulted": ["clinical_authority", "product_owner"], "informed": ["engineering"],
     "artifact_of_record": "Approved labelling and disclaimer copy, version-pinned in the repository.",
     "gate": "Build fails on missing or altered labelling strings."},
    {"scope": "Product scope, audience separation, patient experience",
     "domains": ["product_scope", "release_scope", "attribution", "process", "clinician_workflow"],
     "accountable": "product_owner", "consulted": ["clinical_authority"], "informed": ["engineering", "qa"],
     "artifact_of_record": "Release scope decision record referencing ledger rule IDs.",
     "gate": "Clinician-only release cannot ship with any reachable patient path."},
    {"scope": "Determinism, parser correctness, provenance and RAG isolation",
     "domains": ["determinism", "provenance", "provenance_ux", "defect_operational"],
     "accountable": "engineering", "consulted": ["qa"], "informed": ["clinical_authority", "product_owner"],
     "artifact_of_record": "Green regression run for layers L1, L2, L5 and L10 with the run manifest archived.",
     "gate": "Stop-ship criteria SS-03 and SS-06."},
    {"scope": "Visual encoding, accessibility, information architecture",
     "domains": ["visual_encoding", "information_architecture", "accessibility", "report_composition"],
     "accountable": "product_owner", "consulted": ["clinical_authority"], "informed": ["engineering"],
     "artifact_of_record": "Visual acceptance run with archived screenshots plus the approved palette and section order.",
     "gate": "Clinician pilot sign-off."},
    {"scope": "Governance gate integrity (this ledger, the spec and the validator)",
     "domains": ["*"],
     "accountable": "qa", "consulted": ["engineering"], "informed": ["clinical_authority", "product_owner"],
     "artifact_of_record": "Validator exit code 0 recorded on the release commit.",
     "gate": "No release without a passing governance validation run."},
]

REQUIRED_COVERAGE = [
    ("Recovery phases are intentionally too short to be true baseline returns", ["CLIN-BASE-001"]),
    ("Valid C/E average may estimate a corrupted Baseline A for the sympathetic, parasympathetic and ratio values", ["CLIN-BASE-002", "CLIN-BASE-003"]),
    ("Separate physiologic tests are not duplicates; within 15% may be considered clinically constant only when symptoms and context are stable", ["CLIN-RETEST-001", "CLIN-RETEST-002"]),
    ("The same file processed twice must be byte and value deterministic", ["CLIN-DET-001"]),
    ("High-FRF ordering and non-invalidation of the test", ["CLIN-FRF-001", "CLIN-FRF-002"]),
    ("Blood-pressure classification defect", ["CLIN-BP-001", "CLIN-BP-002"]),
    ("Normal Valsalva parasympathetic response defect", ["CLIN-VALS-001"]),
    ("Removal of parasympathetic withdrawal language", ["CLIN-LANG-001"]),
    ("Stand response and orthostatic interpretation correction", ["CLIN-STAND-001", "CLIN-STAND-002", "CLIN-LANG-002"]),
    ("Removal or de-emphasis of E:I, Valsalva and 30:15 ratios", ["CLIN-RATIO-001", "CLIN-RATIO-002"]),
    ("High-contrast visual states", ["UX-CLIN-001", "UX-A11Y-001"]),
    ("Collapsible technical sections", ["UX-CLIN-002"]),
    ("Rhythm-strip inspection", ["UX-CLIN-003"]),
    ("Clinician-only first release", ["GOV-SCOPE-001"]),
    ("Separate patient experience populated only from clinician-approved content", ["GOV-SCOPE-002", "PROD-PAT-001", "PROD-PAT-002"]),
    ("Closed approved RAG corpus with exact document and page provenance", ["GOV-RAG-001", "GOV-RAG-002", "GOV-RAG-003", "UX-CLIN-006"]),
    ("Removal of the clinical authority's name from generic analogies", ["GOV-NAME-001"]),
    ("Physician-of-record routing for patient questions", ["GOV-NAME-002", "GOV-NAME-003"]),
    ("Voice dictation failure", ["OPS-VOICE-001"]),
    ("Removal of the misleading not-vendor-validated wording", ["GOV-WORD-001"]),
    ("Physician-interpretation disclaimer", ["GOV-DISC-001", "GOV-DISC-002", "GOV-DISC-003"]),
    ("High-risk claims are provisional and blocked, never active production rules", ["GOV-RISK-001", "GOV-RISK-002", "GOV-RISK-003", "GOV-RISK-004", "GOV-RISK-005", "CLIN-FRF-008"]),
    ("Honest scoping of prior parity evidence", ["GOV-PARITY-001"]),
]

HONESTY_STATEMENTS = [
    "Prior parity work compared numeric field families between the engine and the paired vendor PDFs. It did not establish clinical accuracy, clinical safety or regulatory fitness, and nothing in these artifacts should be read as claiming that it did.",
    "The 2026-08-14 walkthrough reviewed one study end to end. The clinical authority stated explicitly at 00:00:43 that the corrections being given were not universal. Rules derived from a single case-specific remark are marked needs_clinician_wording or provisional_needs_source.",
    "This validator checks structure, completeness and internal coherence of the governance artifacts. It cannot and does not check clinical correctness.",
    "No open-web research was used to produce these artifacts. Every rule traces to the 2026-08-09 email, the 2026-08-14 recorded walkthrough, or an internal repository artifact.",
    "The vendor's per-phase spectral scalars are produced by an undisclosed proprietary algorithm and are not stored in the .ans binary. Values the engine computes for those fields are approximations and must never be presented as vendor-validated.",
]


# ---------------------------------------------------------------------------
# Build-time internal consistency checks (fail loudly rather than emit junk)
# ---------------------------------------------------------------------------

def build_checks():
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids)), "duplicate rule ids"
    known = set(ids)
    for r in RULES:
        assert r["status"] in STATUS_DEFS, (r["id"], r["status"])
        assert r["priority"] in PRIORITY_DEFS, r["id"]
        assert r["data_class"] in DATA_CLASS_DEFS, r["id"]
        assert r["approval_owner"] in OWNERS, r["id"]
        assert r["source_evidence"], r["id"]
        for e in r["source_evidence"]:
            assert e["source"] in SOURCES, (r["id"], e["source"])
        assert r["acceptance_criteria"], r["id"]
        for d in r["dependencies"]:
            assert d in known, (r["id"], "unknown dependency", d)
    covered = set()
    for tc in TESTS:
        for rid in tc["rules"]:
            assert rid in known, (tc["id"], "unknown rule", rid)
            covered.add(rid)
    missing = sorted(known - covered)
    assert not missing, f"rules with no regression test: {missing}"
    for topic, rids in REQUIRED_COVERAGE:
        for rid in rids:
            assert rid in known, (topic, rid)
    layer_ids = {l["id"] for l in LAYERS}
    for tc in TESTS:
        assert tc["layer"] in layer_ids, tc["id"]
    for l in LAYERS:
        assert any(tc["layer"] == l["id"] for tc in TESTS), l["id"]
    # High-risk claims must never be confirmed/active.
    for r in RULES:
        if r["domain"] == "high_risk_claim":
            assert r["status"] == "provisional_needs_source", r["id"]


def counts():
    by_status, by_priority, by_domain, by_class, by_owner = {}, {}, {}, {}, {}
    for r in RULES:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        by_priority[r["priority"]] = by_priority.get(r["priority"], 0) + 1
        by_domain[r["domain"]] = by_domain.get(r["domain"], 0) + 1
        by_class[r["data_class"]] = by_class.get(r["data_class"], 0) + 1
        by_owner[r["approval_owner"]] = by_owner.get(r["approval_owner"], 0) + 1
    return {
        "rules_total": len(RULES),
        "by_status": dict(sorted(by_status.items())),
        "by_priority": dict(sorted(by_priority.items())),
        "by_domain": dict(sorted(by_domain.items())),
        "by_data_class": dict(sorted(by_class.items())),
        "by_approval_owner": dict(sorted(by_owner.items())),
        "tests_total": len(TESTS),
        "blocking_tests": sum(1 for t_ in TESTS if t_["blocking"]),
        "layers": len(LAYERS),
        "open_questions_total": sum(len(r.get("open_questions", [])) for r in RULES),
    }


def open_questions():
    out = []
    for r in RULES:
        for q in r.get("open_questions", []):
            out.append({"rule": r["id"], "status": r["status"], "priority": r["priority"], "question": q})
    return out


# ---------------------------------------------------------------------------
# Emit JSON
# ---------------------------------------------------------------------------

def ledger_json():
    return {
        "artifact": "humanos_ans_clinical_rule_ledger",
        "version": LEDGER_VERSION,
        "generated": GENERATED,
        "generator": "governance/_build_governance.py",
        "scope": (
            "Source-controlled clinical governance ledger for the HumanOS ANS clinician "
            "reporting application. Records every actionable decision extracted from the "
            "2026-08-09 clinical-authority email and the 38:59 recorded clinical walkthrough "
            "of 2026-08-14, with status, evidence and acceptance criteria."
        ),
        "not_a_claim_of_clinical_correctness": HONESTY_STATEMENTS,
        "sources": SOURCES,
        "status_definitions": STATUS_DEFS,
        "priority_definitions": PRIORITY_DEFS,
        "data_class_definitions": DATA_CLASS_DEFS,
        "owners": OWNERS,
        "counts": counts(),
        "required_coverage": [{"topic": k, "rules": v} for k, v in REQUIRED_COVERAGE],
        "rules": RULES,
        "open_questions_for_clinical_authority": open_questions(),
    }


def spec_json():
    return {
        "artifact": "humanos_ans_clinical_regression_spec",
        "version": LEDGER_VERSION,
        "generated": GENERATED,
        "generator": "governance/_build_governance.py",
        "ledger_ref": "governance/clinical-rule-ledger.json",
        "scope": (
            "Layered regression strategy that binds every ledger rule to at least one test. "
            "Specification only: it defines what must be tested and what constitutes a pass. "
            "It does not itself assert that any test currently passes."
        ),
        "not_a_claim_of_clinical_correctness": HONESTY_STATEMENTS,
        "layers": LAYERS,
        "fixtures": FIXTURES,
        "phi_restricted_fixture_manifest": PHI_RESTRICTED_FIXTURE_MANIFEST,
        "tests": TESTS,
        "stop_ship_criteria": STOP_SHIP,
        "signoff_matrix": SIGNOFF_MATRIX,
        "counts": {
            "tests_total": len(TESTS),
            "blocking_tests": sum(1 for x in TESTS if x["blocking"]),
            "tests_by_layer": {l["id"]: sum(1 for x in TESTS if x["layer"] == l["id"]) for l in LAYERS},
            "fixtures": len(FIXTURES),
            "stop_ship_criteria": len(STOP_SHIP),
            "signoff_rows": len(SIGNOFF_MATRIX),
        },
    }


# ---------------------------------------------------------------------------
# Emit Markdown
# ---------------------------------------------------------------------------

def md_escape(s):
    return str(s).replace("|", "\\|")


def ledger_md():
    c = counts()
    L = []
    L.append("# HumanOS ANS - Clinical Rule Ledger")
    L.append("")
    L.append(f"**Version** {LEDGER_VERSION} &nbsp;&nbsp; **Generated** {GENERATED} &nbsp;&nbsp; "
             f"**Rules** {c['rules_total']} &nbsp;&nbsp; **Generator** `governance/_build_governance.py`")
    L.append("")
    L.append("> Generated artifact. Edit `governance/_build_governance.py` and regenerate; do not hand-edit "
             "this file or `clinical-rule-ledger.json`. Validate with "
             "`node governance/validate-clinical-governance.mjs`.")
    L.append("")
    L.append("## 1. What this document is, and is not")
    L.append("")
    for s in HONESTY_STATEMENTS:
        L.append(f"- {s}")
    L.append("")
    L.append("## 2. Sources of record")
    L.append("")
    for k, s in SOURCES.items():
        L.append(f"### `{k}`")
        L.append("")
        for kk, vv in s.items():
            if kk == "id":
                continue
            if isinstance(vv, list):
                vv = "; ".join(vv)
            L.append(f"- **{kk}**: {vv}")
        L.append("")
    L.append("## 3. Status vocabulary")
    L.append("")
    L.append("| Status | Meaning |")
    L.append("| --- | --- |")
    for k, v in STATUS_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("An ambiguous transcript statement is never promoted to `confirmed_*`. Where the direction is "
             "clear but the clinical language is not, the rule is `needs_clinician_wording` and the gate "
             "blocks generated text. Where the statement is clinically consequential and unsourced, the rule "
             "is `provisional_needs_source` and is blocked in code.")
    L.append("")
    L.append("## 4. Data-class vocabulary")
    L.append("")
    L.append("| Data class | Definition |")
    L.append("| --- | --- |")
    for k, v in DATA_CLASS_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("The escalation order is one-way: measured data and deterministic calculations may feed AI "
             "narrative; only a licensed clinician may convert narrative into a clinician-approved conclusion; "
             "only a clinician-approved conclusion (or raw data released under the physician-interpretation "
             "disclaimer) may become patient-visible content.")
    L.append("")
    L.append("## 5. Priority and ownership")
    L.append("")
    L.append("| Priority | Meaning |")
    L.append("| --- | --- |")
    for k, v in PRIORITY_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("| Owner key | Person / role |")
    L.append("| --- | --- |")
    for k, v in OWNERS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("## 6. Counts")
    L.append("")
    for label, key in [("Status", "by_status"), ("Priority", "by_priority"),
                       ("Data class", "by_data_class"), ("Approval owner", "by_approval_owner"),
                       ("Domain", "by_domain")]:
        L.append(f"**By {label.lower()}**")
        L.append("")
        L.append(f"| {label} | Rules |")
        L.append("| --- | ---: |")
        for k, v in c[key].items():
            L.append(f"| `{k}` | {v} |")
        L.append("")
    L.append(f"Open questions requiring the clinical authority or legal/regulatory: **{c['open_questions_total']}**.")
    L.append("")
    L.append("## 7. Rule index")
    L.append("")
    L.append("| ID | Title | Domain | Status | Pri | Owner |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for r in RULES:
        L.append(f"| `{r['id']}` | {md_escape(r['title'])} | `{r['domain']}` | `{r['status']}` | "
                 f"{r['priority']} | `{r['approval_owner']}` |")
    L.append("")
    L.append("## 8. Rules")
    L.append("")
    for r in RULES:
        L.append(f"### `{r['id']}` - {r['title']}")
        L.append("")
        L.append(f"| Field | Value |")
        L.append("| --- | --- |")
        L.append(f"| Domain | `{r['domain']}` |")
        L.append(f"| Status | `{r['status']}` |")
        L.append(f"| Priority | `{r['priority']}` |")
        L.append(f"| Confidence | `{r['confidence']}` |")
        L.append(f"| Data class | `{r['data_class']}` |")
        L.append(f"| Approval owner | `{r['approval_owner']}` ({md_escape(OWNERS[r['approval_owner']])}) |")
        deps = ", ".join(f"`{d}`" for d in r["dependencies"]) or "none"
        L.append(f"| Dependencies | {deps} |")
        L.append("")
        L.append("**Source evidence**")
        L.append("")
        for e in r["source_evidence"]:
            kind = "email" if e["source"].startswith("email") else "walkthrough"
            L.append(f"- {kind} `{e['ref']}` - \"{e['quote']}\"")
            if e.get("note"):
                L.append(f"  - note: {e['note']}")
        L.append("")
        L.append("**Trigger**")
        L.append("")
        L.append(f"- {r['trigger']['description']}")
        if r["trigger"].get("inputs"):
            L.append(f"- input fields: {', '.join('`' + i + '`' for i in r['trigger']['inputs'])}")
        L.append("")
        L.append("**Deterministic preconditions**")
        L.append("")
        for p in r["preconditions"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Required output behavior**")
        L.append("")
        for p in r["required_behavior"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Prohibited wording / behavior**")
        L.append("")
        for p in r["prohibited"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Acceptance criteria**")
        L.append("")
        for a in r["acceptance_criteria"]:
            L.append(f"- **Given** {a['given']} **when** {a['when']} **then** {a['then']}.")
        L.append("")
        if r.get("open_questions"):
            L.append("**Open questions**")
            L.append("")
            for q in r["open_questions"]:
                L.append(f"- {q}")
            L.append("")
    L.append("## 9. Required coverage checklist")
    L.append("")
    L.append("| Mandated topic | Rules |")
    L.append("| --- | --- |")
    for topic, rids in REQUIRED_COVERAGE:
        L.append(f"| {md_escape(topic)} | {', '.join('`' + r + '`' for r in rids)} |")
    L.append("")
    L.append("## 10. Open questions for the clinical authority")
    L.append("")
    L.append("| # | Rule | Status | Question |")
    L.append("| ---: | --- | --- | --- |")
    for i, q in enumerate(open_questions(), 1):
        L.append(f"| {i} | `{q['rule']}` | `{q['status']}` | {md_escape(q['question'])} |")
    L.append("")
    L.append("## 11. Regeneration and validation")
    L.append("")
    L.append("```bash")
    L.append("python3 governance/_build_governance.py        # regenerate all four artifacts")
    L.append("node governance/validate-clinical-governance.mjs   # schema / completeness / coherence gate")
    L.append("```")
    L.append("")
    return "\n".join(L) + "\n"


def spec_md():
    s = spec_json()
    L = []
    L.append("# HumanOS ANS - Clinical Regression Specification")
    L.append("")
    L.append(f"**Version** {LEDGER_VERSION} &nbsp;&nbsp; **Generated** {GENERATED} &nbsp;&nbsp; "
             f"**Tests** {len(TESTS)} ({sum(1 for x in TESTS if x['blocking'])} blocking) &nbsp;&nbsp; "
             f"**Layers** {len(LAYERS)}")
    L.append("")
    L.append("> Generated artifact. Companion to `governance/CLINICAL_RULE_LEDGER.md`. Specification only: "
             "it states what must be tested and what a pass means. It does not assert that any test passes today.")
    L.append("")
    L.append("## 1. Honest scope")
    L.append("")
    for x in HONESTY_STATEMENTS:
        L.append(f"- {x}")
    L.append("")
    L.append("## 2. Layers")
    L.append("")
    L.append("| Layer | Name | Purpose | Verdict type | Tests |")
    L.append("| --- | --- | --- | --- | ---: |")
    for l in LAYERS:
        n = sum(1 for x in TESTS if x["layer"] == l["id"])
        L.append(f"| `{l['id']}` | {l['title']} | {md_escape(l['purpose'])} | `{l['verdict_type']}` | {n} |")
    L.append("")
    L.append("Layers run in order. A failure in L1 invalidates the interpretation of every later layer, so "
             "the gate short-circuits: parser determinism first, then bounded vendor parity, then "
             "classification, then everything that depends on classification being right.")
    L.append("")
    L.append("## 3. Fixture cohort (anonymized)")
    L.append("")
    L.append("Direct identifiers are **not** in this document. The anonymized IDs below map to vendor "
             "filenames only inside the `phi_restricted_fixture_manifest` block of "
             "`clinical-regression-spec.json`, which is marked PHI-restricted and must never be published.")
    L.append("")
    L.append("| Fixture | Oracle case | Role | Notes |")
    L.append("| --- | --- | --- | --- |")
    for f in FIXTURES:
        L.append(f"| `{f['id']}` | {f['oracle_case'] or '-'} | `{f['role']}` | {md_escape(f['notes'])} |")
    L.append("")
    L.append("## 4. Tests")
    L.append("")
    for l in LAYERS:
        L.append(f"### `{l['id']}` {l['title']}")
        L.append("")
        L.append(f"{l['purpose']}")
        L.append("")
        for x in TESTS:
            if x["layer"] != l["id"]:
                continue
            L.append(f"#### `{x['id']}` - {x['title']}")
            L.append("")
            L.append(f"- **Rules**: {', '.join('`' + r + '`' for r in x['rules'])}")
            L.append(f"- **Fixtures**: {', '.join('`' + f + '`' for f in x['fixtures']) or 'n/a (process test)'}")
            L.append(f"- **Kind**: `{x['kind']}` &nbsp; **Blocking**: {'yes' if x['blocking'] else 'no'} "
                     f"&nbsp; **Implementation**: `{x['implementation_status']}`")
            L.append(f"- **Given** {x['acceptance']['given']} **when** {x['acceptance']['when']} "
                     f"**then** {x['acceptance']['then']}.")
            L.append(f"- **Pass criteria**: {x['pass_criteria']}")
            if x.get("notes"):
                L.append(f"- **Notes**: {x['notes']}")
            L.append("")
    L.append("## 5. Rule-to-test traceability")
    L.append("")
    L.append("| Rule | Status | Pri | Tests |")
    L.append("| --- | --- | --- | --- |")
    for r in RULES:
        ts = [x["id"] for x in TESTS if r["id"] in x["rules"]]
        L.append(f"| `{r['id']}` | `{r['status']}` | {r['priority']} | {', '.join('`' + t_ + '`' for t_ in ts)} |")
    L.append("")
    L.append("## 6. Stop-ship criteria")
    L.append("")
    L.append("Any single criterion below blocks the release. None may be waived on schedule grounds.")
    L.append("")
    L.append("| ID | Criterion | Why | Owner |")
    L.append("| --- | --- | --- | --- |")
    for x in STOP_SHIP:
        L.append(f"| `{x['id']}` | {md_escape(x['criterion'])} | {md_escape(x['rationale'])} | `{x['owner']}` |")
    L.append("")
    L.append("## 7. Sign-off matrix")
    L.append("")
    L.append("| Scope | Accountable | Consulted | Informed | Artifact of record | Gate |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for x in SIGNOFF_MATRIX:
        L.append(f"| {md_escape(x['scope'])} | `{x['accountable']}` | "
                 f"{', '.join('`' + y + '`' for y in x['consulted'])} | "
                 f"{', '.join('`' + y + '`' for y in x['informed'])} | "
                 f"{md_escape(x['artifact_of_record'])} | {md_escape(x['gate'])} |")
    L.append("")
    L.append("Domain ownership map:")
    L.append("")
    L.append("| Scope | Ledger domains |")
    L.append("| --- | --- |")
    for x in SIGNOFF_MATRIX:
        L.append(f"| {md_escape(x['scope'])} | {', '.join('`' + d + '`' for d in x['domains'])} |")
    L.append("")
    L.append("## 8. Execution and gating")
    L.append("")
    L.append("```bash")
    L.append("node governance/validate-clinical-governance.mjs   # structural gate for these artifacts")
    L.append("npm run test:ans && npm run test:client            # existing unit/integration suites")
    L.append("npm run eval:ci                                    # existing evaluation harness")
    L.append("npm run qa:visual                                  # existing visual acceptance")
    L.append("```")
    L.append("")
    L.append("The governance validator is the only new gate introduced here. It is structural: it verifies "
             "that the ledger and this spec are complete, internally coherent and free of identifier leakage. "
             "It makes no clinical claim.")
    L.append("")
    return "\n".join(L) + "\n"


def main():
    build_checks()
    out = [
        ("clinical-rule-ledger.json", json.dumps(ledger_json(), indent=2, sort_keys=False) + "\n"),
        ("clinical-regression-spec.json", json.dumps(spec_json(), indent=2, sort_keys=False) + "\n"),
        ("CLINICAL_RULE_LEDGER.md", ledger_md()),
        ("CLINICAL_REGRESSION_SPEC.md", spec_md()),
    ]
    for name, body in out:
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
            fh.write(body)
        print(f"wrote governance/{name} ({len(body)} bytes)")
    c = counts()
    print("rules:", c["rules_total"], "tests:", c["tests_total"], "blocking:", c["blocking_tests"])
    print("by_status:", c["by_status"])


if __name__ == "__main__":
    main()
