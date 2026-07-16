/**
 * COLOMBO-RULE-2.7 — Baroreceptor reflex dysfunction validator.
 *
 * Authoritative clinical instruction (Dr. Joseph Colombo, recorded April 28 2026
 * Zoom, cue ~01:09:50–01:10:01): "Valsalva blood pressure, if it does not go up
 * 10%, that's indicating the risk for baroreceptor reflex dysfunction compared to
 * resting baseline."
 *
 * SAFETY CONTRACT under test: the flag fires ONLY when both baseline and Valsalva
 * systolic BP are vendor-reported/OCR/measured at confidence ≥ 0.5. When BP is
 * missing, computed, estimated, or low-confidence, the detector must emit a
 * BlockedClaim → "not assessed". BP is NEVER inferred from ECG. No patient data —
 * synthetic BP values only.
 */
import { describe, it, expect } from "vitest";
import { detectPhenotypes } from "../scoring/phenotypes.js";
import type { PhenotypeContext } from "../scoring/phenotypes.js";
import type { AnsStudy, ProvField, ExtractionSource } from "../../../shared/ansStudy.js";

const RULE_ID = "COLOMBO-RULE-2.7";

// Authoritative, genuinely-in-file BP source in the current AnsStudy pipeline.
// (Vendor-report / PDF-OCR BP is wired in as an equivalent authoritative source;
// the detector's allow-list also accepts the forward-compat "vendor_reported" /
// "ocr" / "measured" names — see phenotypes.ts BARO_AUTHORITATIVE_SOURCES.)
const VENDOR: ExtractionSource = "ascii_section";
// A non-authoritative, rejected source (derived — must never satisfy the gate).
const DERIVED: ExtractionSource = "computed";

function prov<T>(value: T | null, source: ExtractionSource = VENDOR, confidence = 0.9): ProvField<T> {
  if (value === null) {
    return { value: null, provenance: { source: "missing", confidence: 0, warnings: ["missing"] } };
  }
  return { value, provenance: { source, confidence } };
}

function contextWithBp(
  baseSbp: ProvField<number>,
  valsalvaSbp: ProvField<number>,
): PhenotypeContext {
  const emptyBp = { sbp: prov<number>(null), dbp: prov<number>(null), map: prov<number>(null) };
  const study = {
    sympatheticParasympathetic: {
      restingLfa: prov<number>(null), restingRfa: prov<number>(null), restingSb: prov<number>(null),
      standingLfa: prov<number>(null), standingRfa: prov<number>(null), standingSb: prov<number>(null),
    },
    baseline: { heartRate: prov<number>(null), bp: { ...emptyBp, sbp: baseSbp } },
    deepBreathing: { heartRate: prov<number>(null), bp: { ...emptyBp } },
    valsalva: { heartRate: prov<number>(null), bp: { ...emptyBp, sbp: valsalvaSbp } },
    standOrTilt: { heartRate: prov<number>(null), bp: { ...emptyBp } },
  } as unknown as AnsStudy;
  const notAssessableScore = { confidence: "Low" as const, assessable: false, severity: "not_assessed" as const, sourceFields: [] };
  return {
    study,
    thresholds: { adrenergic: { sbpDropModerate: 20, dbpDropModerate: 10, potsHrIncrease: 30 } },
    cardiovagal: { score: notAssessableScore },
    adrenergic: { score: notAssessableScore, orthostatic: { sbpDelta: null, dbpDelta: null, hrDelta: null } },
  } as unknown as PhenotypeContext;
}

function baroFlag(ctx: PhenotypeContext) {
  return detectPhenotypes(ctx).flags.find((f) => f.id === "baroreflex_dysfunction");
}
function baroBlocked(ctx: PhenotypeContext) {
  return detectPhenotypes(ctx).blocked.find((b) => /baroreceptor reflex/i.test(b.claim));
}

describe(`${RULE_ID} — baroreflex validator (vendor/OCR-gated)`, () => {
  it("fires PRESENT when vendor BP rises < 10% on Valsalva", () => {
    // 120 → 125 = +4.2% < 10%
    const ctx = contextWithBp(prov(120, VENDOR), prov(125, VENDOR));
    const f = baroFlag(ctx)!;
    expect(f.present).toBe(true);
    expect(f.rationale).toMatch(/%/);
    expect(f.criteria[0].description).toContain(RULE_ID);
  });

  it("does NOT fire when vendor BP rises ≥ 10% (healthy baroreflex)", () => {
    // 120 → 140 = +16.7% ≥ 10%
    const ctx = contextWithBp(prov(120, VENDOR), prov(140, VENDOR));
    const f = baroFlag(ctx)!;
    expect(f.present).toBe(false);
  });

  it("accepts OCR-sourced BP as authoritative", () => {
    const ctx = contextWithBp(prov(118, VENDOR, 0.8), prov(120, VENDOR, 0.8));
    expect(baroFlag(ctx)!.present).toBe(true);
  });

  it("NOT ASSESSED when baseline BP is missing", () => {
    const ctx = contextWithBp(prov<number>(null), prov(125, VENDOR));
    expect(baroFlag(ctx)?.present).toBeUndefined(); // no flag emitted
    expect(baroBlocked(ctx)).toBeDefined();
    expect(baroBlocked(ctx)!.explanation).toMatch(/not assessed/i);
  });

  it("NOT ASSESSED when Valsalva BP is missing", () => {
    const ctx = contextWithBp(prov(120, VENDOR), prov<number>(null));
    expect(baroFlag(ctx)).toBeUndefined();
    expect(baroBlocked(ctx)).toBeDefined();
  });

  it("NOT ASSESSED when BP is COMPUTED/estimated (never trust non-authoritative BP)", () => {
    const ctx = contextWithBp(prov(120, DERIVED), prov(122, DERIVED));
    expect(baroFlag(ctx)).toBeUndefined();
    const b = baroBlocked(ctx)!;
    expect(b.missingFields.join(" ")).toMatch(/vendor\/OCR/i);
  });

  it("NOT ASSESSED when vendor BP confidence is below 0.5 (insufficient confidence)", () => {
    const ctx = contextWithBp(prov(120, VENDOR, 0.3), prov(125, VENDOR, 0.3));
    expect(baroFlag(ctx)).toBeUndefined();
    expect(baroBlocked(ctx)).toBeDefined();
  });

  it("explicitly states BP is never inferred from ECG in the not-assessed explanation", () => {
    const ctx = contextWithBp(prov<number>(null), prov<number>(null));
    expect(baroBlocked(ctx)!.explanation).toMatch(/never inferred from ECG/i);
  });
});
