/**
 * PR4 — Evidence-linked explanations tests.
 *
 * These tests exercise buildExplainedReport with a fake evidence resolver
 * so we don't touch Supabase. They confirm:
 *   1. Items are produced per assessable & non-assessable domain.
 *   2. Abnormal findings + present phenotypes become bullets.
 *   3. Blocked claims become bullets with mode='blocked', never citations.
 *   4. When the toggle is OFF, NO citations are attached even if mappings exist.
 *   5. When the toggle is ON and a mapping exists, mode='evidence-backed'.
 *   6. When toggle is ON but no mapping exists, mode='rule-based' and the
 *      bullet carries the RULE_BASED_LABEL.
 *   7. Patient text is non-alarming + doesn't include raw rule codes.
 */

import { describe, it, expect } from "vitest";
import { buildExplainedReport } from "../../_buildExplanations";
import type {
  DiagnosticSummary,
  DomainScore,
  AbnormalFinding,
  PhenotypeFlag,
} from "../../../shared/diagnosticSummary";
import type { EvidenceLink, RuleRef } from "../../../shared/evidenceTypes";
import { RULE_BASED_LABEL } from "../../../shared/evidenceTypes";

// ───────────────────────────────────────────────────────────
// Builders
// ───────────────────────────────────────────────────────────

function domain(
  d: "cardiovagal" | "adrenergic" | "sudomotor",
  opts: Partial<DomainScore> = {}
): DomainScore {
  return {
    domain: d,
    value: opts.value ?? 0,
    severity: opts.severity ?? "normal",
    rationale: opts.rationale ?? "default rationale",
    sourceFields: opts.sourceFields ?? [`${d}.x`],
    confidence: opts.confidence ?? "High",
    assessable: opts.assessable ?? true,
    notAssessedReason: opts.notAssessedReason,
  };
}

function summary(overrides: Partial<DiagnosticSummary> = {}): DiagnosticSummary {
  return {
    schemaVersion: "1.0",
    computedAt: new Date().toISOString(),
    scoringVersion: "ans-scoring/test",
    cardiovagalScore: domain("cardiovagal"),
    adrenergicScore: domain("adrenergic"),
    sudomotorScore: domain("sudomotor", {
      assessable: false,
      severity: "not_assessed",
      value: null,
      notAssessedReason: "no sudomotor data",
    }),
    totalAutonomicSeverityScore: 0,
    maxPossibleScore: 6,
    domainsAssessed: ["cardiovagal", "adrenergic"],
    missingDomains: ["sudomotor"],
    abnormalFindings: [],
    phenotypeFlags: [],
    reportConfidence: "High",
    reportConfidenceScore: 0.9,
    unsafeOrUnsupportedClaimsBlocked: [],
    explanationBullets: [],
    disclaimer: "test",
    ...overrides,
  };
}

function mockLink(sourceId: string, title: string): EvidenceLink {
  return {
    linkId: `link-${sourceId}`,
    sourceId,
    title,
    authors: "Author et al.",
    year: 2020,
    publicationType: "journal_article",
    url: "https://example.org/x",
    hasPrivateFile: false,
    evidenceQuote: null,
    pageRef: null,
  };
}

function emptyResolver(_refs: RuleRef[]): Promise<Map<string, EvidenceLink[]>> {
  return Promise.resolve(new Map());
}

// ───────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────

describe("buildExplainedReport — structure", () => {
  it("emits one item per domain (assessable or not)", async () => {
    const out = await buildExplainedReport(summary(), {
      evidenceEnabledOverride: false,
      evidenceResolver: emptyResolver,
    });
    const domainItems = out.items.filter((i) => i.rule.type === "domain");
    expect(domainItems.length).toBe(3);
    const sudo = domainItems.find((i) => i.rule.key === "sudomotor")!;
    expect(sudo.mode).toBe("blocked");
    expect(sudo.evidence).toEqual([]);
  });

  it("turns abnormal findings into rule-based items when evidence is OFF", async () => {
    const finding: AbnormalFinding = {
      code: "ORTHO_SBP_DROP_SEVERE",
      message: "SBP dropped 32 mmHg on standing",
      domain: "adrenergic",
      severity: "severe",
      sourceFields: ["phases.standing.bp.systolic"],
      confidence: "High",
    };
    const out = await buildExplainedReport(
      summary({ abnormalFindings: [finding] }),
      { evidenceEnabledOverride: false, evidenceResolver: emptyResolver }
    );
    const finds = out.items.filter((i) => i.rule.type === "finding");
    expect(finds.length).toBe(1);
    expect(finds[0].mode).toBe("rule-based");
    expect(finds[0].evidence).toEqual([]);
  });

  it("turns PRESENT phenotypes into items but skips absent ones", async () => {
    const present: PhenotypeFlag = {
      id: "orthostatic_hypotension",
      label: "Pattern consistent with orthostatic hypotension",
      present: true,
      criteria: [{ description: "SBP drop ≥20", met: true }],
      rationale: "SBP dropped ≥20 mmHg on standing",
      sourceFields: ["phases.standing.bp.systolic"],
      confidence: "High",
    };
    const absent: PhenotypeFlag = {
      ...present,
      id: "pots_like",
      label: "POTS-like pattern",
      present: false,
    };
    const out = await buildExplainedReport(
      summary({ phenotypeFlags: [present, absent] }),
      { evidenceEnabledOverride: false, evidenceResolver: emptyResolver }
    );
    const phenos = out.items.filter((i) => i.rule.type === "phenotype");
    expect(phenos.length).toBe(1);
    expect(phenos[0].rule.key).toBe("orthostatic_hypotension");
  });

  it("emits blocked items for unsafeOrUnsupportedClaimsBlocked", async () => {
    const out = await buildExplainedReport(
      summary({
        unsafeOrUnsupportedClaimsBlocked: [
          {
            claim: "possible_can_risk",
            missingFields: ["ratios.eiRatio"],
            explanation: "E/I ratio missing — cannot evaluate CAN risk",
          },
        ],
      }),
      { evidenceEnabledOverride: false, evidenceResolver: emptyResolver }
    );
    const blocked = out.items.find((i) => i.mode === "blocked" && i.rule.type === "phenotype");
    expect(blocked).toBeDefined();
    expect(blocked!.evidence).toEqual([]);
    expect(blocked!.missingFields).toContain("ratios.eiRatio");
  });
});

describe("buildExplainedReport — evidence gating", () => {
  it("when evidenceEnabled=false, NO citations even if resolver would return some", async () => {
    const out = await buildExplainedReport(summary(), {
      evidenceEnabledOverride: false,
      evidenceResolver: async (_refs) => {
        const m = new Map<string, EvidenceLink[]>();
        m.set("domain::cardiovagal", [mockLink("s1", "Cardiovagal Source")]);
        return m;
      },
    });
    expect(out.evidenceEnabled).toBe(false);
    for (const it of out.items) expect(it.evidence).toEqual([]);
  });

  it("when evidenceEnabled=true AND mapping exists, mode='evidence-backed'", async () => {
    const out = await buildExplainedReport(summary(), {
      evidenceEnabledOverride: true,
      evidenceResolver: async (refs) => {
        const m = new Map<string, EvidenceLink[]>();
        for (const r of refs) {
          if (r.key === "cardiovagal") {
            m.set(`${r.type}::${r.key}`, [mockLink("s1", "Vagal source")]);
          }
        }
        return m;
      },
    });
    const cv = out.items.find((i) => i.rule.key === "cardiovagal")!;
    expect(cv.mode).toBe("evidence-backed");
    expect(cv.evidence[0].title).toBe("Vagal source");
    // Other rule-based bullets still get RULE_BASED_LABEL appended.
    const adr = out.items.find((i) => i.rule.key === "adrenergic")!;
    expect(adr.mode).toBe("rule-based");
    expect(adr.text).toContain(RULE_BASED_LABEL);
  });

  it("blocked items never receive citations even when toggle is ON", async () => {
    const out = await buildExplainedReport(
      summary({
        unsafeOrUnsupportedClaimsBlocked: [
          {
            claim: "possible_can_risk",
            missingFields: ["ratios.eiRatio"],
            explanation: "missing",
          },
        ],
      }),
      {
        evidenceEnabledOverride: true,
        evidenceResolver: async (refs) => {
          const m = new Map<string, EvidenceLink[]>();
          for (const r of refs) {
            m.set(`${r.type}::${r.key}`, [mockLink("s1", "X")]);
          }
          return m;
        },
      }
    );
    const blocked = out.items.filter((i) => i.mode === "blocked");
    for (const b of blocked) expect(b.evidence).toEqual([]);
  });
});

describe("buildExplainedReport — patient language", () => {
  it("patient text does not include raw rule codes", async () => {
    const out = await buildExplainedReport(
      summary({
        abnormalFindings: [
          {
            code: "ORTHO_SBP_DROP_SEVERE",
            message: "SBP dropped 32",
            domain: "adrenergic",
            severity: "severe",
            sourceFields: ["phases.standing.bp.systolic"],
            confidence: "High",
          },
        ],
      }),
      { evidenceEnabledOverride: false, evidenceResolver: emptyResolver }
    );
    const f = out.items.find((i) => i.rule.type === "finding")!;
    expect(f.patientText).not.toContain("ORTHO_SBP_DROP_SEVERE");
    expect(f.patientText.length).toBeGreaterThan(20);
  });

  it("blocked patient text uses gentle phrasing", async () => {
    const out = await buildExplainedReport(
      summary({
        unsafeOrUnsupportedClaimsBlocked: [
          {
            claim: "possible_can_risk",
            missingFields: ["ratios.eiRatio"],
            explanation: "missing",
          },
        ],
      }),
      { evidenceEnabledOverride: false, evidenceResolver: emptyResolver }
    );
    const blocked = out.items.filter((i) => i.mode === "blocked");
    for (const b of blocked) {
      expect(b.patientText.toLowerCase()).not.toContain("error");
      expect(b.patientText.toLowerCase()).not.toContain("fail");
    }
  });
});
