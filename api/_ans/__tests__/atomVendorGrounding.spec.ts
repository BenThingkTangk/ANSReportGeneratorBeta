/**
 * ATOM grounding for ATTACHED VENDOR REPORT(S) — the exact paired-PDF case.
 *
 * Production QA (merge commit dc9ca56): with the Alex Pare .ans plus BOTH paired
 * PDFs attached, the patient/clinician reports correctly showed the vendor
 * findings and SB 2.59, but the patient ATOM question "What did the attached
 * vendor reports find?" answered that only cardiovagal was assessed and omitted
 * the vendor categorical findings (possible pre-syncope, abnormal baseline→DB HR
 * change, high standing sympathetic response).
 *
 * Root cause: /api/ask-atom's grounding context (buildPatientContext) contained
 * NO vendor section at all — the client never forwarded the merged vendor
 * extraction, so the model only ever saw the deterministic engine's
 * "Domains assessed: cardiovagal".
 *
 * These deterministic tests lock the prompt construction (no network model
 * call): the merged extraction from the two REAL captured endpoint responses
 * must produce a vendor-reported block that names every categorical finding and
 * the printed SB=2.59, labels provenance, keeps the class separate from the raw
 * .ans measurements, and never overclaims.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPatientContext,
  buildVendorReportedSection,
  SYSTEM_PROMPT,
} from "../../ask-atom.js";
import {
  mergeVendorExtractions,
  type NamedExtraction,
} from "../../../shared/mergeVendorExtractions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", n), "utf8"));

const LETTER_FILE = "Pare-Alex-Thu-Jul-11-2024.pdf";
const REPORT_FILE = "Pare-Alex-Thu-Jul-11-2024-Report.pdf";

/** Merge the two real captured endpoint responses exactly as the client does. */
function mergedVendor() {
  const docs: NamedExtraction[] = [
    { fileName: LETTER_FILE, extraction: fx("pare_letter_endpoint_response.json").extraction },
    { fileName: REPORT_FILE, extraction: fx("pare_report_endpoint_response.json").extraction },
  ];
  return mergeVendorExtractions(docs).merged;
}

/** The .ans-only deterministic report: cardiovagal assessed, spectral/BP absent. */
const ANS_REPORT: any = {
  patientData: { firstName: "John", lastName: "Faux", age: 48, gender: "Male", bmi: 25.68, physician: "Colombo" },
  ratios: {
    eiRatio: { value: 1.22, normal: "> 1.094", classification: { label: "Normal", severity: "Normal" } },
    valsalvaRatio: { value: 1.49, normal: "> 1.200", classification: { label: "Normal", severity: "Normal" } },
    thirtyFifteenRatio: { value: 1.33, normal: "> 1.092", classification: { label: "Normal", severity: "Normal" } },
  },
  phaseEvents: [],
  spectralAvailable: false,
  bpAvailable: false,
  diagnosticSummary: {
    reportConfidence: "Medium",
    reportConfidenceScore: 0.6,
    totalAutonomicSeverityScore: 0,
    maxPossibleScore: 9,
    domainsAssessed: ["cardiovagal"],
    missingDomains: ["adrenergic", "sudomotor"],
    abnormalFindings: [],
    phenotypeFlags: [],
    cardiovagalScore: { domain: "cardiovagal", assessable: true, severity: "normal", value: 0, confidence: "High" },
    adrenergicScore: { domain: "adrenergic", assessable: false, severity: "not_assessed", value: null, confidence: "Low" },
    sudomotorScore: { domain: "sudomotor", assessable: false, severity: "not_assessed", value: null, confidence: "Low" },
    unsafeOrUnsupportedClaimsBlocked: [],
  },
};

describe("merged paired-PDF vendor evidence (fixture sanity)", () => {
  const vendor = mergedVendor();
  it("carries the printed SB=2.59 and all 9 categorical findings", () => {
    expect(vendor.narrative!.printedNumbers.find((n: any) => n.key === "SB")?.value).toBeCloseTo(2.59, 2);
    expect(vendor.narrative!.findings.length).toBeGreaterThanOrEqual(9);
  });
});

describe("buildVendorReportedSection — attached vendor evidence block", () => {
  const vendor = mergedVendor();
  const section = buildVendorReportedSection(vendor);

  it("is emitted when vendor documents are attached", () => {
    expect(section).toBeTruthy();
    expect(section).toMatch(/ATTACHED VENDOR REPORT\(S\)/);
  });

  it("names the three findings the deployed answer omitted", () => {
    // Possible pre-syncope risk, abnormal baseline→DB HR change, high standing
    // sympathetic response — verbatim vendor labels.
    expect(section).toMatch(/pre-?syncope/i);
    expect(section).toMatch(/HR/); // "Abnormal changes in HR (from baseline to DB)"
    expect(section).toMatch(/deep breathing|DB/i);
    expect(section).toMatch(/sympathetic response to stand|standing/i);
  });

  it("lists every merged categorical finding, each with a source filename", () => {
    for (const f of vendor.narrative!.findings) {
      expect(section).toContain(f.label);
      expect(section).toContain(`[source: ${f.sourceFile}]`);
    }
  });

  it("quotes the vendor-printed SB=2.59 verbatim and names both source documents", () => {
    expect(section).toMatch(/SB = 2\.59 \(printed verbatim in the vendor document\)/);
    expect(section).toContain(LETTER_FILE);
    expect(section).toContain(REPORT_FILE);
  });

  it("labels the evidence class as vendor-reported, NOT HumanOS measurements", () => {
    expect(section).toMatch(/VENDOR-REPORTED EVIDENCE \(SEPARATE CLASS — NOT HumanOS measurements\)/);
    expect(section).toMatch(/attribute every item here to the attached vendor report/i);
  });

  it("forbids overclaiming: no conversion to scores, no unprinted values, requires clinician review", () => {
    expect(section).toMatch(/do NOT convert a vendor category into a HumanOS severity, score, phenotype/i);
    expect(section).toMatch(/do NOT infer any value the vendor did not print/i);
    expect(section).toMatch(/cannot independently reproduce or verify/i);
    expect(section).toMatch(/reviewed with the clinician/i);
  });

  it("surfaces unresolved cross-document conflicts rather than silently resolving them", () => {
    expect(section).toMatch(/Unresolved conflicts between attached vendor documents/);
  });

  it("returns an empty string when NO vendor document is attached (unchanged .ans-only path)", () => {
    expect(buildVendorReportedSection(undefined)).toBe("");
    expect(buildVendorReportedSection({})).toBe("");
    expect(buildVendorReportedSection({ narrative: { findings: [], printedNumbers: [] } })).toBe("");
  });
});

describe("buildPatientContext — vendor block reaches the grounded prompt", () => {
  const vendor = mergedVendor();

  for (const role of ["patient", "clinician"] as const) {
    it(`[${role}] includes the vendor findings alongside the deterministic domains`, () => {
      const ctx = buildPatientContext(ANS_REPORT, role, vendor);
      // The deterministic .ans view is still present and honest…
      expect(ctx).toMatch(/Domains assessed: cardiovagal/);
      expect(ctx).toMatch(/Domains NOT assessed[^\n]*adrenergic/);
      // …AND the attached vendor evidence is now grounded in the same prompt.
      expect(ctx).toMatch(/ATTACHED VENDOR REPORT\(S\)/);
      expect(ctx).toMatch(/pre-?syncope/i);
      expect(ctx).toMatch(/SB = 2\.59/);
      expect(ctx).toContain(LETTER_FILE);
    });
  }

  it("omits the vendor block entirely for an .ans-only upload", () => {
    const ctx = buildPatientContext(ANS_REPORT, "patient");
    expect(ctx).not.toMatch(/ATTACHED VENDOR REPORT/);
    // The .ans-only grounding is otherwise unchanged.
    expect(ctx).toMatch(/Domains assessed: cardiovagal/);
  });

  it("keeps the vendor findings OUT of the deterministic assessability scores", () => {
    const ctx = buildPatientContext(ANS_REPORT, "clinician", vendor);
    const assessStart = ctx.indexOf("DATA ASSESSABILITY & PROVENANCE");
    const vendorStart = ctx.indexOf("ATTACHED VENDOR REPORT(S)");
    expect(assessStart).toBeGreaterThan(-1);
    expect(vendorStart).toBeGreaterThan(assessStart);
    // The deterministic block itself must not have absorbed vendor categories.
    const assessBlock = ctx.slice(assessStart, vendorStart);
    expect(assessBlock).toMatch(/Deterministic abnormal findings[^\n]*\n- None from assessed domains\./);
    expect(assessBlock).not.toMatch(/pre-?syncope/i);
  });
});

describe("SYSTEM_PROMPT — rule that forbids the deployed wrong answer", () => {
  it("requires answering vendor questions from the vendor block, not the domain list", () => {
    expect(SYSTEM_PROMPT).toMatch(/ATTACHED VENDOR REPORT\(S\)/);
    expect(SYSTEM_PROMPT).toMatch(/Never answer such a question with only the deterministic domain list/i);
    expect(SYSTEM_PROMPT).toMatch(/only cardiovagal was assessed/i);
  });
  it("still requires the two evidence classes stay separate and unverified", () => {
    expect(SYSTEM_PROMPT).toMatch(/Keep the two classes separate/i);
    expect(SYSTEM_PROMPT).toMatch(/never claim HumanOS verified them/i);
  });
});
