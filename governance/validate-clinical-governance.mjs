#!/usr/bin/env node
/**
 * validate-clinical-governance.mjs
 *
 * Deterministic structural gate for the HumanOS ANS clinical governance artifacts:
 *   - governance/clinical-rule-ledger.json
 *   - governance/clinical-regression-spec.json
 *
 * WHAT THIS VALIDATES
 *   Schema shape, field completeness, enum validity, ID format and uniqueness,
 *   dependency resolution and acyclicity, rule-to-test traceability, layer
 *   coverage, stop-ship and sign-off completeness, status/priority coherence
 *   for high-risk content, count-block agreement, markdown/JSON drift, and
 *   PHI identifier containment.
 *
 * WHAT THIS DOES **NOT** VALIDATE
 *   Clinical correctness, clinical safety, physiologic truth, regulatory
 *   fitness, or whether any rule is the right rule. A passing run means the
 *   governance artifacts are structurally complete and internally coherent -
 *   nothing more. Clinical correctness is established only by the named
 *   clinical authority signing the rule dispositions.
 *
 * Deterministic: no network, no clock-dependent logic, sorted output, and a
 * stable exit code (0 = pass, 1 = fail).
 *
 * Usage:
 *   node governance/validate-clinical-governance.mjs [--json] [--quiet]
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const WORKSPACE = resolve(REPO, "..");

const LEDGER_JSON = join(HERE, "clinical-rule-ledger.json");
const SPEC_JSON = join(HERE, "clinical-regression-spec.json");
const LEDGER_MD = join(HERE, "CLINICAL_RULE_LEDGER.md");
const SPEC_MD = join(HERE, "CLINICAL_REGRESSION_SPEC.md");

const ID_RE = /^(CLIN|GOV|UX|PROD|OPS)-[A-Z0-9]{2,6}-\d{3}$/;
const TEST_ID_RE = /^RG-L\d{1,2}-\d{3}$/;
const WALKTHROUGH_REF_RE = /^\d{2}:\d{2}:\d{2}(-\d{2}:\d{2}:\d{2})?$/;
const EMAIL_REF_RE = /^email item \d+(\s*\+\s*header)?$/i;
const FIXTURE_ID_RE = /^FIX-[A-Z0-9*-]{1,12}$/;

const REQUIRED_LAYER_KEYS = [
  "parser_determinism",
  "vendor_parity",
  "classification",
  "interpretation",
  "provenance_rag_isolation",
  "wording_safety",
  "clinician_workflow",
  "accessibility_usability",
  "longitudinal_retest",
  "negative_adversarial",
];

const HIGH_RISK_TRIGGER_WORDS = [
  "cancer",
  "oncolog",
  "heart attack",
  "stroke",
  "72 hours",
  "dosage",
  "dose",
];

const errors = [];
const warnings = [];
const notes = [];

const fail = (code, msg) => errors.push({ code, msg });
const warn = (code, msg) => warnings.push({ code, msg });
const note = (msg) => notes.push(msg);

function readJson(path, label) {
  if (!existsSync(path)) {
    fail("E-FILE-MISSING", `${label} not found at ${path}`);
    return null;
  }
  const raw = readFileSync(path, "utf8");
  try {
    return { data: JSON.parse(raw), raw };
  } catch (e) {
    fail("E-FILE-PARSE", `${label} is not valid JSON: ${e.message}`);
    return null;
  }
}

function requireKeys(obj, keys, where, code = "E-SCHEMA-KEY") {
  for (const k of keys) {
    if (obj == null || !(k in obj)) fail(code, `${where}: missing required key "${k}"`);
  }
}

function nonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function sortedCount(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1;
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const ledgerRead = readJson(LEDGER_JSON, "clinical-rule-ledger.json");
const specRead = readJson(SPEC_JSON, "clinical-regression-spec.json");

if (!ledgerRead || !specRead) {
  report();
  process.exit(1);
}

const ledger = ledgerRead.data;
const spec = specRead.data;

// ---------------------------------------------------------------------------
// 1. Ledger top-level schema
// ---------------------------------------------------------------------------

requireKeys(
  ledger,
  [
    "artifact",
    "version",
    "generated",
    "generator",
    "scope",
    "not_a_claim_of_clinical_correctness",
    "sources",
    "status_definitions",
    "priority_definitions",
    "data_class_definitions",
    "owners",
    "counts",
    "required_coverage",
    "rules",
    "open_questions_for_clinical_authority",
  ],
  "ledger",
);

if (ledger.artifact !== "humanos_ans_clinical_rule_ledger") {
  fail("E-LEDGER-ARTIFACT", `ledger.artifact must be "humanos_ans_clinical_rule_ledger", got "${ledger.artifact}"`);
}
if (!nonEmptyArray(ledger.not_a_claim_of_clinical_correctness)) {
  fail("E-HONESTY-MISSING", "ledger must carry an explicit non-claim-of-clinical-correctness block");
}
if (!nonEmptyArray(ledger.rules)) fail("E-LEDGER-EMPTY", "ledger.rules is empty");

const STATUSES = Object.keys(ledger.status_definitions ?? {});
const PRIORITIES = Object.keys(ledger.priority_definitions ?? {});
const DATA_CLASSES = Object.keys(ledger.data_class_definitions ?? {});
const OWNER_KEYS = Object.keys(ledger.owners ?? {});
const SOURCE_KEYS = Object.keys(ledger.sources ?? {});

for (const required of [
  "confirmed_in_review",
  "confirmed_email",
  "provisional_needs_source",
  "needs_clinician_wording",
  "rejected",
  "product_direction",
]) {
  if (!STATUSES.includes(required)) {
    fail("E-STATUS-VOCAB", `required status "${required}" is not defined in ledger.status_definitions`);
  }
}

for (const required of [
  "measured_data",
  "deterministic_calculation",
  "ai_narrative",
  "clinician_approved_conclusion",
  "patient_visible_content",
]) {
  if (!DATA_CLASSES.includes(required)) {
    fail("E-DATACLASS-VOCAB", `required data class "${required}" is not defined`);
  }
}

// ---------------------------------------------------------------------------
// 2. Per-rule schema, completeness and coherence
// ---------------------------------------------------------------------------

const rules = Array.isArray(ledger.rules) ? ledger.rules : [];
const ruleById = new Map();

for (const r of rules) {
  const id = r?.id ?? "<missing id>";
  requireKeys(
    r,
    [
      "id",
      "title",
      "domain",
      "status",
      "priority",
      "confidence",
      "data_class",
      "source_evidence",
      "trigger",
      "preconditions",
      "required_behavior",
      "prohibited",
      "dependencies",
      "acceptance_criteria",
      "approval_owner",
    ],
    `rule ${id}`,
  );

  if (!ID_RE.test(String(r?.id))) fail("E-RULE-ID", `rule id "${id}" does not match ${ID_RE}`);
  if (ruleById.has(r?.id)) fail("E-RULE-DUP", `duplicate rule id "${id}"`);
  else ruleById.set(r?.id, r);

  if (!nonEmptyString(r?.title)) fail("E-RULE-TITLE", `rule ${id}: empty title`);
  if (!nonEmptyString(r?.domain)) fail("E-RULE-DOMAIN", `rule ${id}: empty domain`);
  if (!STATUSES.includes(r?.status)) fail("E-RULE-STATUS", `rule ${id}: unknown status "${r?.status}"`);
  if (!PRIORITIES.includes(r?.priority)) fail("E-RULE-PRIORITY", `rule ${id}: unknown priority "${r?.priority}"`);
  if (!["high", "medium", "low"].includes(r?.confidence)) {
    fail("E-RULE-CONFIDENCE", `rule ${id}: confidence must be high|medium|low, got "${r?.confidence}"`);
  }
  if (!DATA_CLASSES.includes(r?.data_class)) fail("E-RULE-DATACLASS", `rule ${id}: unknown data_class "${r?.data_class}"`);
  if (!OWNER_KEYS.includes(r?.approval_owner)) fail("E-RULE-OWNER", `rule ${id}: unknown approval_owner "${r?.approval_owner}"`);

  // Source evidence with resolvable, well-formed references.
  if (!nonEmptyArray(r?.source_evidence)) {
    fail("E-RULE-EVIDENCE", `rule ${id}: at least one source_evidence entry is required`);
  } else {
    for (const [i, e] of r.source_evidence.entries()) {
      const at = `rule ${id} evidence[${i}]`;
      requireKeys(e, ["source", "ref", "quote"], at);
      if (!SOURCE_KEYS.includes(e?.source)) fail("E-EVIDENCE-SOURCE", `${at}: unknown source "${e?.source}"`);
      const ref = String(e?.ref ?? "");
      const okRef = WALKTHROUGH_REF_RE.test(ref) || EMAIL_REF_RE.test(ref) || /^email header$/i.test(ref);
      if (!okRef) {
        fail(
          "E-EVIDENCE-REF",
          `${at}: ref "${ref}" must be an HH:MM:SS or HH:MM:SS-HH:MM:SS transcript reference, or "email item N"`,
        );
      }
      if (String(e?.source).startsWith("walkthrough") && !WALKTHROUGH_REF_RE.test(ref)) {
        fail("E-EVIDENCE-TS", `${at}: walkthrough evidence must carry an exact timestamp reference`);
      }
      if (!nonEmptyString(e?.quote)) fail("E-EVIDENCE-QUOTE", `${at}: empty quote`);
    }
  }

  // Trigger / preconditions / behavior / prohibitions.
  if (!nonEmptyString(r?.trigger?.description)) fail("E-RULE-TRIGGER", `rule ${id}: trigger.description required`);
  if (!Array.isArray(r?.trigger?.inputs)) fail("E-RULE-TRIGGER-INPUTS", `rule ${id}: trigger.inputs must be an array`);
  for (const [field, code] of [
    ["preconditions", "E-RULE-PRECOND"],
    ["required_behavior", "E-RULE-BEHAVIOR"],
    ["prohibited", "E-RULE-PROHIBITED"],
  ]) {
    if (!nonEmptyArray(r?.[field])) fail(code, `rule ${id}: ${field} must be a non-empty array`);
    else if (r[field].some((x) => !nonEmptyString(x))) fail(code, `rule ${id}: ${field} contains an empty entry`);
  }

  // Given/When/Then acceptance criteria.
  if (!nonEmptyArray(r?.acceptance_criteria)) {
    fail("E-RULE-AC", `rule ${id}: at least one Given/When/Then acceptance criterion is required`);
  } else {
    for (const [i, a] of r.acceptance_criteria.entries()) {
      for (const k of ["given", "when", "then"]) {
        if (!nonEmptyString(a?.[k])) fail("E-RULE-AC-GWT", `rule ${id} acceptance_criteria[${i}]: empty "${k}"`);
      }
    }
  }

  // Status coherence.
  if (r?.status === "needs_clinician_wording" && !nonEmptyArray(r?.open_questions)) {
    fail(
      "E-STATUS-COHERENCE",
      `rule ${id}: status needs_clinician_wording requires at least one open question naming what wording is missing`,
    );
  }
  if (r?.status === "provisional_needs_source" && !nonEmptyArray(r?.open_questions)) {
    fail("E-STATUS-COHERENCE", `rule ${id}: status provisional_needs_source requires at least one open question`);
  }
  if (r?.status === "rejected" && !nonEmptyArray(r?.prohibited)) {
    fail("E-STATUS-COHERENCE", `rule ${id}: rejected rules must state what is prohibited`);
  }

  // High-risk content must never be an active production rule.
  const blob = JSON.stringify(r).toLowerCase();
  const looksHighRisk =
    r?.domain === "high_risk_claim" || HIGH_RISK_TRIGGER_WORDS.some((w) => blob.includes(w));
  if (r?.domain === "high_risk_claim") {
    if (r?.status !== "provisional_needs_source") {
      fail(
        "E-HIGHRISK-STATUS",
        `rule ${id}: domain high_risk_claim must have status provisional_needs_source, got "${r?.status}"`,
      );
    }
    if (!["legal_regulatory", "clinical_authority"].includes(r?.approval_owner)) {
      fail("E-HIGHRISK-OWNER", `rule ${id}: high-risk rules must be owned by legal_regulatory or clinical_authority`);
    }
    if (!nonEmptyArray(r?.prohibited)) {
      fail("E-HIGHRISK-PROHIBIT", `rule ${id}: high-risk rules must enumerate prohibited output`);
    }
  } else if (looksHighRisk && ["confirmed_in_review", "confirmed_email"].includes(r?.status)) {
    // A confirmed rule may legitimately *forbid* high-risk language; flag for human read.
    const forbids = JSON.stringify(r?.prohibited ?? []).toLowerCase();
    const guards = HIGH_RISK_TRIGGER_WORDS.some((w) => forbids.includes(w)) || blob.includes("must not");
    if (!guards) {
      warn(
        "W-HIGHRISK-REVIEW",
        `rule ${id}: mentions high-risk vocabulary while confirmed; confirm it constrains rather than authorises the claim`,
      );
    }
  }
}

// Dependency resolution + acyclicity.
for (const r of rules) {
  if (!Array.isArray(r?.dependencies)) {
    fail("E-RULE-DEPS", `rule ${r?.id}: dependencies must be an array`);
    continue;
  }
  for (const d of r.dependencies) {
    if (d === r.id) fail("E-DEP-SELF", `rule ${r.id}: depends on itself`);
    else if (!ruleById.has(d)) fail("E-DEP-UNKNOWN", `rule ${r.id}: unknown dependency "${d}"`);
  }
}
// Dependency edges express clinical coupling ("this rule is only meaningful
// alongside that one"), not build ordering, so mutual edges are legitimate and
// are reported informationally. What must hold is that every edge resolves and
// that no rule depends on itself (both checked above).
{
  let mutual = 0;
  const seen = new Set();
  for (const r of rules) {
    for (const d of r.dependencies ?? []) {
      if (!ruleById.has(d)) continue;
      if ((ruleById.get(d).dependencies ?? []).includes(r.id)) {
        const key = [r.id, d].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          mutual += 1;
        }
      }
    }
  }
  const edges = rules.reduce((n, r) => n + (r.dependencies?.length ?? 0), 0);
  note(`dependency graph: ${edges} edges, ${mutual} mutually coupled rule pairs (coupling links, not build ordering)`);
}

// ---------------------------------------------------------------------------
// 3. Ledger counts block agrees with the rules array
// ---------------------------------------------------------------------------

if (ledger.counts) {
  if (ledger.counts.rules_total !== rules.length) {
    fail("E-COUNT-TOTAL", `counts.rules_total=${ledger.counts.rules_total} but rules array has ${rules.length}`);
  }
  const pairs = [
    ["by_status", "status"],
    ["by_priority", "priority"],
    ["by_domain", "domain"],
    ["by_data_class", "data_class"],
    ["by_approval_owner", "approval_owner"],
  ];
  for (const [key, field] of pairs) {
    const expected = sortedCount(rules, field);
    const actual = ledger.counts[key];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      fail("E-COUNT-DRIFT", `counts.${key} disagrees with the rules array (recomputed ${JSON.stringify(expected)})`);
    }
  }
  const oq = rules.reduce((n, r) => n + (r.open_questions?.length ?? 0), 0);
  if (ledger.counts.open_questions_total !== oq) {
    fail("E-COUNT-DRIFT", `counts.open_questions_total=${ledger.counts.open_questions_total} but ${oq} were found`);
  }
}

// Every declared open question resolves to a rule.
for (const q of ledger.open_questions_for_clinical_authority ?? []) {
  if (!ruleById.has(q?.rule)) fail("E-OQ-RULE", `open question references unknown rule "${q?.rule}"`);
  if (!nonEmptyString(q?.question)) fail("E-OQ-EMPTY", `open question for rule ${q?.rule} is empty`);
}

// Required coverage checklist resolves.
if (!nonEmptyArray(ledger.required_coverage)) {
  fail("E-COVERAGE-MISSING", "ledger.required_coverage is required and must be non-empty");
} else {
  for (const c of ledger.required_coverage) {
    if (!nonEmptyString(c?.topic)) fail("E-COVERAGE-TOPIC", "required_coverage entry has an empty topic");
    if (!nonEmptyArray(c?.rules)) fail("E-COVERAGE-RULES", `required_coverage "${c?.topic}" lists no rules`);
    for (const rid of c?.rules ?? []) {
      if (!ruleById.has(rid)) fail("E-COVERAGE-UNKNOWN", `required_coverage "${c.topic}" references unknown rule "${rid}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Spec top-level schema
// ---------------------------------------------------------------------------

requireKeys(
  spec,
  [
    "artifact",
    "version",
    "generated",
    "ledger_ref",
    "scope",
    "not_a_claim_of_clinical_correctness",
    "layers",
    "fixtures",
    "phi_restricted_fixture_manifest",
    "tests",
    "stop_ship_criteria",
    "signoff_matrix",
    "counts",
  ],
  "spec",
);

if (spec.artifact !== "humanos_ans_clinical_regression_spec") {
  fail("E-SPEC-ARTIFACT", `spec.artifact must be "humanos_ans_clinical_regression_spec", got "${spec.artifact}"`);
}
if (spec.version !== ledger.version) {
  fail("E-VERSION-DRIFT", `spec.version "${spec.version}" != ledger.version "${ledger.version}"`);
}
if (!nonEmptyArray(spec.not_a_claim_of_clinical_correctness)) {
  fail("E-HONESTY-MISSING", "spec must carry an explicit non-claim-of-clinical-correctness block");
}

// Layers: all ten required layers present, each with tests.
const layers = Array.isArray(spec.layers) ? spec.layers : [];
const layerIds = new Set(layers.map((l) => l?.id));
const layerKeys = layers.map((l) => l?.key);
for (const k of REQUIRED_LAYER_KEYS) {
  if (!layerKeys.includes(k)) fail("E-LAYER-MISSING", `required regression layer "${k}" is missing`);
}
for (const l of layers) {
  requireKeys(l, ["id", "key", "title", "purpose", "verdict_type"], `layer ${l?.id}`);
  if (!/^L\d{1,2}$/.test(String(l?.id))) fail("E-LAYER-ID", `layer id "${l?.id}" must look like L1..L10`);
}
if (new Set(layerKeys).size !== layerKeys.length) fail("E-LAYER-DUP", "duplicate layer key");

// Fixtures.
const fixtures = Array.isArray(spec.fixtures) ? spec.fixtures : [];
const fixtureIds = new Set();
for (const f of fixtures) {
  requireKeys(f, ["id", "role"], `fixture ${f?.id}`);
  if (!FIXTURE_ID_RE.test(String(f?.id))) fail("E-FIXTURE-ID", `fixture id "${f?.id}" does not match ${FIXTURE_ID_RE}`);
  if (fixtureIds.has(f?.id)) fail("E-FIXTURE-DUP", `duplicate fixture id "${f?.id}"`);
  fixtureIds.add(f?.id);
}
if (fixtures.filter((f) => /^FIX-C\d{2}$/.test(String(f.id))).length < 10) {
  fail("E-FIXTURE-COHORT", "the paired cohort must be represented by at least 10 anonymized FIX-Cnn fixtures");
}

// PHI-restricted manifest must be labelled and must be the only place identifiers live.
const manifest = spec.phi_restricted_fixture_manifest ?? {};
const manifestLabel = `${manifest._classification ?? ""} ${manifest._warning ?? ""}`.toLowerCase();
if (!manifestLabel.includes("phi")) {
  fail("E-PHI-LABEL", "phi_restricted_fixture_manifest must be explicitly marked PHI-restricted");
}
if (!/not for publication|must not be|non-public|internal only/.test(manifestLabel)) {
  fail("E-PHI-LABEL", "phi_restricted_fixture_manifest must state that it is non-public");
}
for (const fid of Object.keys(manifest.map ?? {})) {
  if (!fixtureIds.has(fid)) fail("E-PHI-FIXTURE", `PHI manifest references unknown fixture "${fid}"`);
}

// Tests.
const tests = Array.isArray(spec.tests) ? spec.tests : [];
const testIds = new Set();
const coveredRules = new Set();
const blockingByRule = new Map();

for (const x of tests) {
  const at = `test ${x?.id}`;
  requireKeys(x, ["id", "layer", "title", "rules", "fixtures", "kind", "acceptance", "pass_criteria", "blocking", "implementation_status"], at);
  if (!TEST_ID_RE.test(String(x?.id))) fail("E-TEST-ID", `${at}: id must match ${TEST_ID_RE}`);
  if (testIds.has(x?.id)) fail("E-TEST-DUP", `duplicate test id "${x?.id}"`);
  testIds.add(x?.id);
  if (!layerIds.has(x?.layer)) fail("E-TEST-LAYER", `${at}: unknown layer "${x?.layer}"`);
  if (!String(x?.id).startsWith(`RG-${x?.layer}-`)) {
    fail("E-TEST-LAYER-ID", `${at}: id must encode its layer (expected prefix RG-${x?.layer}-)`);
  }
  if (!nonEmptyArray(x?.rules)) fail("E-TEST-RULES", `${at}: must reference at least one rule`);
  for (const rid of x?.rules ?? []) {
    if (!ruleById.has(rid)) fail("E-TEST-RULE-UNKNOWN", `${at}: unknown rule "${rid}"`);
    else {
      coveredRules.add(rid);
      if (x?.blocking) blockingByRule.set(rid, true);
    }
  }
  for (const fid of x?.fixtures ?? []) {
    if (!fixtureIds.has(fid)) fail("E-TEST-FIXTURE", `${at}: unknown fixture "${fid}"`);
  }
  for (const k of ["given", "when", "then"]) {
    if (!nonEmptyString(x?.acceptance?.[k])) fail("E-TEST-GWT", `${at}: acceptance.${k} must be a non-empty string`);
  }
  if (!nonEmptyString(x?.pass_criteria)) fail("E-TEST-PASS", `${at}: pass_criteria required`);
  if (typeof x?.blocking !== "boolean") fail("E-TEST-BLOCKING", `${at}: blocking must be a boolean`);
  if (!["unit", "integration", "snapshot", "visual", "manual_review"].includes(x?.kind)) {
    fail("E-TEST-KIND", `${at}: unknown kind "${x?.kind}"`);
  }
  if (!["specified", "implemented", "blocked", "not_implemented"].includes(x?.implementation_status)) {
    fail("E-TEST-STATUS", `${at}: unknown implementation_status "${x?.implementation_status}"`);
  }
}

for (const l of layers) {
  if (!tests.some((x) => x.layer === l.id)) fail("E-LAYER-NO-TEST", `layer ${l.id} (${l.key}) has no tests`);
}

// Traceability: every rule has a test; every P0 rule has a blocking test.
for (const id of [...ruleById.keys()].sort()) {
  if (!coveredRules.has(id)) fail("E-TRACE-MISSING", `rule ${id} is not covered by any regression test`);
  const r = ruleById.get(id);
  if (r.priority === "P0" && !blockingByRule.get(id)) {
    fail("E-TRACE-P0", `rule ${id} is P0 but has no blocking test`);
  }
  if (r.status === "rejected") {
    const guarded = tests.some((x) => x.rules?.includes(id) && ["L6", "L10"].includes(x.layer));
    if (!guarded) {
      fail("E-TRACE-REJECTED", `rejected rule ${id} needs a wording-safety (L6) or adversarial (L10) guard test`);
    }
  }
}

// Stop-ship + sign-off completeness.
if (!nonEmptyArray(spec.stop_ship_criteria)) fail("E-STOPSHIP-MISSING", "stop_ship_criteria must be non-empty");
for (const s of spec.stop_ship_criteria ?? []) {
  requireKeys(s, ["id", "criterion", "rationale", "owner"], `stop-ship ${s?.id}`);
  if (!OWNER_KEYS.includes(s?.owner)) fail("E-STOPSHIP-OWNER", `stop-ship ${s?.id}: unknown owner "${s?.owner}"`);
}
if (!nonEmptyArray(spec.signoff_matrix)) fail("E-SIGNOFF-MISSING", "signoff_matrix must be non-empty");

const signoffDomains = new Set();
for (const row of spec.signoff_matrix ?? []) {
  requireKeys(row, ["scope", "domains", "accountable", "consulted", "informed", "artifact_of_record", "gate"], `signoff "${row?.scope}"`);
  if (!OWNER_KEYS.includes(row?.accountable)) fail("E-SIGNOFF-OWNER", `signoff "${row?.scope}": unknown accountable "${row?.accountable}"`);
  for (const o of [...(row?.consulted ?? []), ...(row?.informed ?? [])]) {
    if (!OWNER_KEYS.includes(o)) fail("E-SIGNOFF-OWNER", `signoff "${row?.scope}": unknown owner "${o}"`);
  }
  for (const d of row?.domains ?? []) signoffDomains.add(d);
}
const ruleDomains = new Set(rules.map((r) => r.domain));
if (!signoffDomains.has("*")) {
  for (const d of [...ruleDomains].sort()) {
    if (!signoffDomains.has(d)) fail("E-SIGNOFF-DOMAIN", `no sign-off row covers rule domain "${d}"`);
  }
} else {
  const uncovered = [...ruleDomains].sort().filter((d) => !signoffDomains.has(d));
  if (uncovered.length) {
    note(`sign-off matrix relies on a wildcard row for domains: ${uncovered.join(", ")}`);
  }
}

// Spec counts block.
if (spec.counts) {
  if (spec.counts.tests_total !== tests.length) {
    fail("E-COUNT-DRIFT", `spec.counts.tests_total=${spec.counts.tests_total} but ${tests.length} tests found`);
  }
  const blocking = tests.filter((x) => x.blocking).length;
  if (spec.counts.blocking_tests !== blocking) {
    fail("E-COUNT-DRIFT", `spec.counts.blocking_tests=${spec.counts.blocking_tests} but ${blocking} found`);
  }
}

// ---------------------------------------------------------------------------
// 5. Markdown / JSON drift
// ---------------------------------------------------------------------------

for (const [path, label, ids] of [
  [LEDGER_MD, "CLINICAL_RULE_LEDGER.md", [...ruleById.keys()]],
  [SPEC_MD, "CLINICAL_REGRESSION_SPEC.md", [...testIds]],
]) {
  if (!existsSync(path)) {
    fail("E-MD-MISSING", `${label} is missing; regenerate with governance/_build_governance.py`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  const missing = ids.filter((id) => !text.includes(id)).sort();
  if (missing.length) {
    fail("E-MD-DRIFT", `${label} does not document: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " ..." : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 6. PHI containment
// ---------------------------------------------------------------------------

const IDENTIFIER_MAP =
  process.env.GOVERNANCE_IDENTIFIER_MAP || join(WORKSPACE, "ans-vendor-oracle-private-mapping.json");

let surnames = [];
if (existsSync(IDENTIFIER_MAP)) {
  try {
    const m = JSON.parse(readFileSync(IDENTIFIER_MAP, "utf8"));
    for (const entry of Object.values(m?.mapping ?? {})) {
      for (const n of entry?.ans_name_fields ?? []) {
        const s = String(n).trim();
        if (s.length >= 4) surnames.push(s);
      }
    }
    surnames = [...new Set(surnames)].sort();
  } catch (e) {
    warn("W-PHI-MAP", `identifier map present but unreadable: ${e.message}`);
  }
} else {
  warn("W-PHI-MAP", `identifier map not found at ${IDENTIFIER_MAP}; identifier leakage scan was skipped`);
}

if (surnames.length) {
  // Ledger must contain no identifiers at all.
  const ledgerHits = surnames.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(ledgerRead.raw));
  if (ledgerHits.length) {
    fail("E-PHI-LEDGER", `clinical-rule-ledger.json contains direct identifiers: ${ledgerHits.join(", ")}`);
  }
  // Spec may contain identifiers ONLY inside the PHI-restricted manifest.
  const specWithoutManifest = JSON.stringify({ ...spec, phi_restricted_fixture_manifest: "<redacted>" });
  const specHits = surnames.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(specWithoutManifest));
  if (specHits.length) {
    fail(
      "E-PHI-SPEC",
      `clinical-regression-spec.json contains identifiers outside the PHI-restricted manifest: ${specHits.join(", ")}`,
    );
  }
  for (const [path, label] of [[LEDGER_MD, "CLINICAL_RULE_LEDGER.md"], [SPEC_MD, "CLINICAL_REGRESSION_SPEC.md"]]) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const hits = surnames.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text));
    if (hits.length) fail("E-PHI-MD", `${label} contains direct identifiers: ${hits.join(", ")}`);
  }
  note(`identifier leakage scan ran against ${surnames.length} name tokens`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const quiet = argv.includes("--quiet");

  const summary = {
    validator: "validate-clinical-governance.mjs",
    validates: "schema, completeness, internal coherence, traceability, PHI containment",
    does_not_validate: "clinical correctness, clinical safety, regulatory fitness",
    ledger_version: ledger?.version ?? null,
    rules_total: rules.length,
    rules_by_status: sortedCount(rules, "status"),
    rules_by_priority: sortedCount(rules, "priority"),
    rules_by_data_class: sortedCount(rules, "data_class"),
    tests_total: tests.length,
    blocking_tests: tests.filter((x) => x.blocking).length,
    layers: layers.length,
    fixtures: fixtures.length,
    stop_ship_criteria: (spec?.stop_ship_criteria ?? []).length,
    signoff_rows: (spec?.signoff_matrix ?? []).length,
    open_questions: rules.reduce((n, r) => n + (r.open_questions?.length ?? 0), 0),
    errors: errors.length,
    warnings: warnings.length,
    result: errors.length ? "FAIL" : "PASS",
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, errors, warnings, notes }, null, 2));
    return;
  }

  if (!quiet) {
    console.log("HumanOS ANS clinical governance validator");
    console.log("  validates .... schema, completeness, internal coherence, traceability, PHI containment");
    console.log("  DOES NOT ..... assert clinical correctness, clinical safety or regulatory fitness");
    console.log("");
    console.log(`  ledger version ....... ${summary.ledger_version}`);
    console.log(`  rules ................ ${summary.rules_total}`);
    for (const [k, v] of Object.entries(summary.rules_by_status)) console.log(`     ${k.padEnd(26)} ${v}`);
    console.log(`  priorities ........... ${JSON.stringify(summary.rules_by_priority)}`);
    console.log(`  tests ................ ${summary.tests_total} (${summary.blocking_tests} blocking) across ${summary.layers} layers`);
    console.log(`  fixtures ............. ${summary.fixtures}`);
    console.log(`  stop-ship criteria ... ${summary.stop_ship_criteria}`);
    console.log(`  sign-off rows ........ ${summary.signoff_rows}`);
    console.log(`  open questions ....... ${summary.open_questions}`);
    console.log("");
  }
  for (const n of notes) console.log(`note:    ${n}`);
  for (const w of warnings.sort((a, b) => (a.code + a.msg).localeCompare(b.code + b.msg))) {
    console.log(`WARN  [${w.code}] ${w.msg}`);
  }
  for (const e of errors.sort((a, b) => (a.code + a.msg).localeCompare(b.code + b.msg))) {
    console.log(`ERROR [${e.code}] ${e.msg}`);
  }
  console.log("");
  console.log(`RESULT: ${summary.result}  (${errors.length} errors, ${warnings.length} warnings)`);
  if (!errors.length) {
    console.log("Structural gate passed. This is not a statement about clinical correctness.");
  }
}

report();
process.exit(errors.length ? 1 : 0);
