/**
 * ATOM patient/clinician mode-tone isolation + report grounding.
 *
 * Live QA: the patient chip "Explain the three normal Ewing ratios" produced a
 * clinician-like answer (generic thresholds, "argue against … neuropathy", "map
 * your patient's ratios") with Sonar [1]-[15] citations while private RAG is
 * empty. These deterministic tests lock the prompt-construction + citation-
 * stripping that prevent that (we do not call the network model).
 */
import { describe, it, expect } from "vitest";
import {
  stripCitationMarkers,
  buildPatientContext,
  SYSTEM_PROMPT,
} from "../../ask-atom.js";

const REPORT = {
  patientData: { firstName: "Alex", lastName: "Pare", age: 48, gender: "Male", bmi: 25.68, physician: "Colombo" },
  ratios: {
    eiRatio: { value: 1.22, normal: "> 1.094", classification: { label: "Normal", severity: "Normal" } },
    valsalvaRatio: { value: 1.49, normal: "> 1.200", classification: { label: "Normal", severity: "Normal" } },
    thirtyFifteenRatio: { value: 1.33, normal: "> 1.092", classification: { label: "Normal", severity: "Normal" } },
  },
  phaseEvents: [],
  spectralAvailable: false,
  bpAvailable: false,
};

describe("stripCitationMarkers", () => {
  it("removes inline bracket refs [1], [2,3], [1-15]", () => {
    expect(stripCitationMarkers("E/I is normal [1]. Valsalva too [2, 3] and more [1-15].")).toBe(
      "E/I is normal. Valsalva too and more.",
    );
  });
  it("removes a trailing Sources/References block", () => {
    const t = "Your ratios are normal.\n\nSources:\n[1] https://a.com\n[2] https://b.com";
    expect(stripCitationMarkers(t)).toBe("Your ratios are normal.");
  });
  it("leaves normal prose untouched", () => {
    expect(stripCitationMarkers("Your E/I ratio was 1.22, which is in the normal range.")).toBe(
      "Your E/I ratio was 1.22, which is in the normal range.",
    );
  });
});

describe("buildPatientContext — leads with THIS patient's measured ratios", () => {
  const ctx = buildPatientContext(REPORT, "patient");
  it("includes Alex's actual Ewing ratio values + normal ranges", () => {
    expect(ctx).toMatch(/Measured cardiovagal \(Ewing\) ratios for Alex/);
    expect(ctx).toContain("1.22");
    expect(ctx).toContain("1.49");
    expect(ctx).toContain("1.33");
    expect(ctx).toContain("> 1.094");
  });
  it("surfaces the first name for direct address", () => {
    expect(ctx).toMatch(/address the patient by this in patient view\): Alex/);
  });
});

describe("SYSTEM_PROMPT — patient/clinician tone isolation rules", () => {
  it("patient view: report-first, direct 'you', no clinician phrasing", () => {
    expect(SYSTEM_PROMPT).toMatch(/LEAD with THIS patient's actual measured values/);
    expect(SYSTEM_PROMPT).toMatch(/NEVER write "the patient", "your patient's"/);
  });
  it("patient view: no diagnose/exclude of neuropathy, no prognosis", () => {
    expect(SYSTEM_PROMPT).toMatch(/Do NOT diagnose OR exclude/i);
    expect(SYSTEM_PROMPT).toMatch(/argues against.*rules out.*cardiovascular autonomic neuropathy|CAN\/AAN/i);
    expect(SYSTEM_PROMPT).toMatch(/Do NOT give prognosis/i);
  });
  it("patient view: state BP/spectral limitations + no bracketed citations", () => {
    expect(SYSTEM_PROMPT).toMatch(/State limitations for THIS upload only/i);
    expect(SYSTEM_PROMPT).toMatch(/Never claim that \.ans files categorically lack LFa\/RFa\/SB or blood pressure/i);
    expect(SYSTEM_PROMPT).toMatch(/Do NOT include bracketed reference markers/i);
  });
  it("clinician view: distinguishes measured / external(URL) / private-corpus", () => {
    expect(SYSTEM_PROMPT).toMatch(/MEASURED \(report\)/);
    expect(SYSTEM_PROMPT).toMatch(/EXTERNAL \(web\).*resolvable URL/is);
    expect(SYSTEM_PROMPT).toMatch(/PRIVATE CORPUS.*no indexed full-text/is);
  });
});
