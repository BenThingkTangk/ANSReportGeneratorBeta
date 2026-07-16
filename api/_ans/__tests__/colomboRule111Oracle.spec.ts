/**
 * COLOMBO-RULE-1.11 oracle — "There is no parasympathetic withdrawal."
 *
 * Authoritative clinical instruction (Dr. Joseph Colombo, recorded April 28 2026
 * Zoom review, cue ~01:05:52–01:07:00), quoted verbatim as the oracle:
 *
 *   "There is no parasympathetic withdrawal. That is not ever an issue… We want
 *    the parasympathetics to go down, and there is no bottom to how far down they
 *    can go. It's always normal as long as it's going down. So there is no
 *    parasympathetic withdrawal."
 *
 * A fall in parasympathetic (RFa) activity during Valsalva or on standing is
 * therefore NORMAL physiology and must never be surfaced as a dysfunction in the
 * deterministic scorer, the clinician summary, or Ask ATOM.
 *
 * This oracle exercises the scoring engine directly (no patient data — synthetic
 * spectral values only) and asserts the rule holds for the exact scenario Colombo
 * described: a large standing RFa DROP. The prior engine flagged this as
 * "present" — this test locks the corrected behavior against regression.
 */
import { describe, it, expect } from "vitest";
import { detectPhenotypes } from "../scoring/phenotypes.js";
import type { PhenotypeContext } from "../scoring/phenotypes.js";
import type { AnsStudy, ProvField } from "../../../shared/ansStudy.js";

const RULE_ID = "COLOMBO-RULE-1.11";

function prov<T>(value: T | null, confidence = 0.9): ProvField<T> {
  if (value === null) {
    return { value: null, provenance: { source: "missing", confidence: 0, warnings: ["missing"] } };
  }
  return { value, provenance: { source: "ascii_section", confidence } };
}

/**
 * Full-shape context for the phenotype orchestrator with an explicit
 * resting→standing RFa DROP (restingRfa > standingRfa). Unrelated domains are
 * marked not-assessable so their detectors block cleanly, isolating the
 * SP-based rule under test. No patient data — synthetic values only.
 */
function contextWithRfaDrop(restRfa: number, standRfa: number): PhenotypeContext {
  const sp = {
    restingLfa: prov<number>(null),
    restingRfa: prov<number>(restRfa),
    restingSb: prov<number>(null),
    standingLfa: prov<number>(null),
    standingRfa: prov<number>(standRfa),
    standingSb: prov<number>(null),
  };
  const study = {
    sympatheticParasympathetic: sp,
    baseline: {
      heartRate: prov<number>(null),
      bp: { sbp: prov<number>(null), dbp: prov<number>(null), map: prov<number>(null) },
    },
    standOrTilt: {
      heartRate: prov<number>(null),
      bp: { sbp: prov<number>(null), dbp: prov<number>(null), map: prov<number>(null) },
    },
  } as unknown as AnsStudy;
  const notAssessableScore = {
    confidence: "Low" as const,
    assessable: false,
    severity: "not_assessed" as const,
    sourceFields: [],
  };
  return {
    study,
    thresholds: {
      adrenergic: {
        sbpDropModerate: 20,
        dbpDropModerate: 10,
        potsHrIncrease: 30,
      },
    },
    cardiovagal: { score: notAssessableScore },
    adrenergic: {
      score: notAssessableScore,
      orthostatic: { sbpDelta: null, dbpDelta: null, hrDelta: null },
    },
  } as unknown as PhenotypeContext;
}

describe(`${RULE_ID} oracle — no parasympathetic withdrawal dysfunction`, () => {
  it("a large standing RFa DROP is NEVER flagged present as a dysfunction", () => {
    // Colombo's exact scenario: parasympathetics go down on standing (big drop).
    const { flags } = detectPhenotypes(contextWithRfaDrop(10.0, 2.0));
    const pw = flags.find((f) => f.id === "parasympathetic_withdrawal");
    expect(pw).toBeDefined();
    expect(pw!.present).toBe(false);
  });

  it("the informational note cites the internal rule id and frames the drop as normal", () => {
    const { flags } = detectPhenotypes(contextWithRfaDrop(10.0, 2.0));
    const pw = flags.find((f) => f.id === "parasympathetic_withdrawal")!;
    expect(pw.rationale).toContain(RULE_ID);
    expect(pw.rationale).toMatch(/expected|normal/i);
    // The dysfunction phrase must not be asserted as a finding label.
    expect(pw.label.toLowerCase()).not.toContain("pattern consistent with parasympathetic withdrawal");
  });

  it("every criterion is unmet — the rule refuses to treat an RFa fall as a met criterion", () => {
    const { flags } = detectPhenotypes(contextWithRfaDrop(10.0, 2.0));
    const pw = flags.find((f) => f.id === "parasympathetic_withdrawal")!;
    expect(pw.criteria.every((c) => !c.met)).toBe(true);
    expect(pw.criteria.some((c) => c.description.includes(RULE_ID))).toBe(true);
  });

  it("even an extreme drop toward zero stays non-dysfunction (no bottom to how far down)", () => {
    const { flags } = detectPhenotypes(contextWithRfaDrop(12.0, 0.01));
    const pw = flags.find((f) => f.id === "parasympathetic_withdrawal")!;
    expect(pw.present).toBe(false);
  });

  it("the phenotype is excluded from present-filtered consumers (clinician summary / Ask ATOM)", () => {
    const { flags } = detectPhenotypes(contextWithRfaDrop(10.0, 2.0));
    // Consumers (api/ask-atom.ts, api/synopsis.ts, api/_buildExplanations.ts) all
    // filter on `present`. Simulate that filter and confirm withdrawal is absent.
    const presented = flags.filter((f) => f.present).map((f) => f.id);
    expect(presented).not.toContain("parasympathetic_withdrawal");
  });
});
