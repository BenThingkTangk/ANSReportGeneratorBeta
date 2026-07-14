/**
 * Safety tests:
 *  - S2-7 / S4-2: every indication code emitted by shared/indications.ts has an
 *    authored patient explainer, and the patient card never prints a raw code.
 *  - S1-1 (superseded): the tool emits no individualized supplement/medication
 *    dosing from an uploaded test alone — only non-prescriptive discussion topics.
 *
 * These are source-level invariants so they stay green regardless of which
 * specific patient/file is processed (generic guarantees, not fixtures).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

/** Pull every `code: "XXX"` literal from a source file. */
function extractCodes(src: string): string[] {
  const out = new Set<string>();
  const re = /code:\s*"([A-Z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

/** Pull every top-level EXPLAINERS key (CODE: {) from the explainer source. */
function extractExplainerKeys(src: string): string[] {
  const out = new Set<string>();
  const re = /^\s{2}([A-Z][A-Z_]+):\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

describe("patient explainer coverage (S2-7 / S4-2)", () => {
  const indicationCodes = extractCodes(read("shared/indications.ts"));
  const explainerKeys = extractExplainerKeys(
    read("client/src/components/patient/DiagnosisExplainer.tsx"),
  );

  it("finds a non-trivial set of indication codes to check", () => {
    expect(indicationCodes.length).toBeGreaterThan(10);
  });

  it("every emitted indication code has an authored patient explainer", () => {
    const missing = indicationCodes.filter(c => !explainerKeys.includes(c));
    expect(missing).toEqual([]);
  });

  it("previously-missing codes are now covered", () => {
    for (const c of [
      "SE_VALSALVA",
      "PE_STAND",
      "SE_STAND",
      "PE_VALSALVA",
      "CAN_HIGH_SB",
      "CAN_LOW_SB",
      "DAN",
      "NEUROGENIC_SYNCOPE",
      "CARDIOGENIC_SYNCOPE",
      "WHITE_COAT",
    ]) {
      expect(explainerKeys).toContain(c);
    }
  });

  it("the patient card does NOT render the raw indication code", () => {
    const src = read("client/src/components/patient/DiagnosisExplainer.tsx");
    // The old code showed `{sev.label} · {ind.code}` in the header. Ensure the
    // raw code is no longer interpolated into visible JSX text.
    expect(src).not.toMatch(/\{sev\.label\}\s*·\s*\{ind\.code\}/);
  });

  it("the FALLBACK never uses the raw code as the visible title", () => {
    const src = read("client/src/components/patient/DiagnosisExplainer.tsx");
    // Old fallback: `title: code.replace(/_/g, " ")`. Must be gone.
    expect(src).not.toMatch(/title:\s*_?code\.replace/);
  });
});

describe("Non-prescriptive treatment output (S1-1, superseded)", () => {
  // SUPERSEDED: the tool no longer emits individualized supplement/medication
  // dosing (previously ALA 600 mg TID, gated by baseline BP). An uploaded test
  // alone must not prescribe. The therapy generator now emits DISCUSSION TOPICS
  // with NO dose and an explicit licensed-clinician requirement.
  const src = read("api/upload.ts");

  it("does not emit an ALA dosage or a '600 mg' prescription", () => {
    expect(src).not.toMatch(/600\s*mg\s*three times daily/i);
    expect(src).not.toMatch(/intervention:\s*"Alpha-Lipoic Acid \(ALA\)"/);
  });

  it("therapy items in the generator carry no `dose:` field", () => {
    // Scope to the therapy-generation region (after the therapies array is
    // declared) so an unrelated `dose` string elsewhere can't mask a regression.
    const start = src.indexOf("const therapies: TherapyRecommendation[] = []");
    const end = src.indexOf("// Follow-up", start);
    const region = src.slice(start, end > start ? end : undefined);
    expect(region.length).toBeGreaterThan(0);
    expect(region).not.toMatch(/\n\s*dose:\s*"/);
  });

  it("therapy rationales require a licensed clinician", () => {
    expect(src).toMatch(/licensed clinician/i);
  });
});
