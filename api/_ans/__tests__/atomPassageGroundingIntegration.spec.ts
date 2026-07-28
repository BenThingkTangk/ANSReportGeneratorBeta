/**
 * Integration: the ASSEMBLED /api/ask-atom system prompt with full-text
 * passages + report + vendor blocks all present.
 *
 * Locks the layering contract that keeps evidence classes separate:
 *   • retrieved passages appear, with citations, as explanatory context;
 *   • the deterministic report block and the vendor block still follow them and
 *     remain authoritative for every patient-specific fact;
 *   • no passage text can supply a patient value or re-grade a score — the
 *     deterministic values in the prompt are byte-identical with and without
 *     retrieval;
 *   • transcript passages carry the attribution + verification caveat.
 *
 * Deterministic — the model is never called.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPatientContext, SYSTEM_PROMPT } from "../../ask-atom.js";
import { selectPassages, buildPassagePromptSection, type PassageRow } from "../knowledgePassages.js";
import { validateCuratedChunks } from "../curatedChunks.js";
import { mergeVendorExtractions, type NamedExtraction } from "../../../shared/mergeVendorExtractions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const SRC = "b90cf06b-3141-4ba2-86cc-a165565faed5";

/** .ans-only deterministic report: cardiovagal assessed; spectral/BP absent. */
const REPORT: any = {
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

function mergedVendor() {
  const docs: NamedExtraction[] = [
    { fileName: "Pare-Alex-Thu-Jul-11-2024.pdf", extraction: fx("pare_letter_endpoint_response.json").extraction },
    { fileName: "Pare-Alex-Thu-Jul-11-2024-Report.pdf", extraction: fx("pare_report_endpoint_response.json").extraction },
  ];
  return mergeVendorExtractions(docs).merged;
}

/**
 * A transcript passage that deliberately mentions BOTH a threshold and metrics
 * this patient does NOT have (LFa/RFa/SB spectral) — the exact material that
 * must never leak into a patient value or a computed grade.
 */
const TRANSCRIPT_ROW: PassageRow = {
  id: "c-1",
  source_id: SRC,
  chunk_index: 0,
  section: "Wellness Score — Foundations — 00:08:27–00:11:54",
  content:
    "The wellness score from the P&S test is not a general health rating. When resting RFa falls below 0.1 bpm² we start calling that advanced autonomic dysfunction, and a sympathovagal balance above 2.5 suggests high morbidity risk.",
  source: {
    id: SRC,
    title: "Colombo P&S Clinical Consultation (Transcript)",
    authors: "Colombo",
    year: 2026,
    publication_type: "transcript",
    url: null,
    active_in_ai_analysis: true,
    review_status: "approved",
  },
};

const QUERY = "What does the wellness score actually measure?";

/** The full system prompt exactly as api/ask-atom.ts assembles it. */
function assemble(passages: ReturnType<typeof selectPassages>, vendor?: unknown): string {
  return [
    SYSTEM_PROMPT,
    "", // knowledge metadata section (irrelevant here)
    buildPassagePromptSection(passages),
    buildPatientContext(REPORT, "patient", vendor),
  ]
    .filter(Boolean)
    .join("\n\n");
}

describe("assembled prompt — passages + report + vendor coexist, separated", () => {
  const passages = selectPassages([TRANSCRIPT_ROW], QUERY);
  const vendor = mergedVendor();
  const prompt = assemble(passages, vendor);

  it("injects the relevant passage with its citation", () => {
    expect(passages.length).toBeGreaterThan(0);
    expect(prompt).toMatch(/RETRIEVED KNOWLEDGE PASSAGES/);
    expect(prompt).toMatch(/Colombo P&S Clinical Consultation \(Transcript\) \(2026\), Wellness Score/);
  });

  it("keeps the deterministic report block present and authoritative", () => {
    expect(prompt).toMatch(/DATA ASSESSABILITY & PROVENANCE \(AUTHORITATIVE/);
    expect(prompt).toMatch(/Domains assessed: cardiovagal/);
    expect(prompt).toMatch(/Domains NOT assessed[^\n]*adrenergic/);
  });

  it("keeps the vendor-reported block present and separate", () => {
    expect(prompt).toMatch(/ATTACHED VENDOR REPORT\(S\)/);
    expect(prompt).toMatch(/VENDOR-REPORTED EVIDENCE \(SEPARATE CLASS — NOT HumanOS measurements\)/);
    expect(prompt).toMatch(/SB = 2\.59/);
  });

  it("orders patient/vendor context AFTER the passages (last word on patient facts)", () => {
    // Anchor on the BLOCK HEADERS (line-start), not the SYSTEM_PROMPT rules that
    // merely mention these names.
    const p = prompt.indexOf("\nRETRIEVED KNOWLEDGE PASSAGES (EXPLANATORY CONTEXT ONLY");
    const r = prompt.indexOf("\nDATA ASSESSABILITY & PROVENANCE (AUTHORITATIVE");
    const v = prompt.indexOf("\nATTACHED VENDOR REPORT(S) — VENDOR-REPORTED EVIDENCE");
    expect(p).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(p);
    expect(v).toBeGreaterThan(p);
  });

  it("instructs that report/vendor win on conflict", () => {
    expect(prompt).toMatch(/report\/vendor blocks win/);
    expect(SYSTEM_PROMPT).toMatch(/PATIENT CONTEXT and ATTACHED VENDOR REPORT\(S\) blocks are authoritative/);
  });

  it("carries the transcript attribution + clinician-verification caveat", () => {
    expect(prompt).toMatch(/\[TRANSCRIPT\]/);
    expect(prompt).toMatch(/may require verification with the treating clinician/);
    expect(SYSTEM_PROMPT).toMatch(/attributed explanatory speech from a recorded consultation/i);
  });
});

describe("no passage can alter deterministic report values", () => {
  const vendor = mergedVendor();
  const withRetrieval = assemble(selectPassages([TRANSCRIPT_ROW], QUERY), vendor);
  const withoutRetrieval = assemble([], vendor);

  it("the patient-context block is byte-identical with and without retrieval", () => {
    // Slice from the real block header so we compare the rendered patient data,
    // not the SYSTEM_PROMPT rule that mentions "PATIENT CONTEXT".
    const HEADER = "\nPATIENT CONTEXT (patient view)";
    const cut = (s: string) => s.slice(s.indexOf(HEADER));
    expect(cut(withRetrieval)).toBe(cut(withoutRetrieval));
    expect(cut(withRetrieval).length).toBeGreaterThan(100);
  });

  it("retrieval adds ONLY the passages block", () => {
    const BLOCK_HEADER = "\nRETRIEVED KNOWLEDGE PASSAGES (EXPLANATORY CONTEXT ONLY";
    expect(withRetrieval).toContain(BLOCK_HEADER);
    expect(withoutRetrieval).not.toContain(BLOCK_HEADER);
    const stripped = withRetrieval
      .replace(buildPassagePromptSection(selectPassages([TRANSCRIPT_ROW], QUERY)), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    expect(stripped).toBe(withoutRetrieval.replace(/\n{3,}/g, "\n\n").trim());
  });

  it("the missing domains stay Not assessed even though the passage discusses RFa/SB", () => {
    // The passage names RFa and SB thresholds; the report block must still list
    // adrenergic/sudomotor as NOT assessed and assert no spectral value.
    expect(withRetrieval).toMatch(/Domains NOT assessed[^\n]*adrenergic[^\n]*sudomotor/);
    expect(withRetrieval).toMatch(/Deterministic abnormal findings[^\n]*\n- None from assessed domains\./);
  });

  it("forbids applying the passage's thresholds to this patient", () => {
    expect(withRetrieval).toMatch(/Do not apply a passage's numbers to this patient's data/);
    expect(withRetrieval).toMatch(/NEVER use a passage to supply, infer, estimate, or fill in a patient value/);
  });
});

describe("vendor/report context stays dominant for patient-specific facts", () => {
  it("vendor findings are named in the prompt even when passages are injected", () => {
    const prompt = assemble(selectPassages([TRANSCRIPT_ROW], QUERY), mergedVendor());
    expect(prompt).toMatch(/pre-?syncope/i);
    expect(prompt).toMatch(/Sympathetic response to stand/i);
    expect(prompt).toMatch(/HR change \(baseline→DB\)/i);
  });

  it("passages never carry a vendor/patient attribution", () => {
    const block = buildPassagePromptSection(selectPassages([TRANSCRIPT_ROW], QUERY));
    expect(block).toMatch(/NOT this patient's data/);
    expect(block).not.toMatch(/ATTACHED VENDOR REPORT/);
  });
});

/**
 * The real curated batch, ingested through the real validator and then ranked
 * through the real live-retrieval path. Skips when the operator file is absent.
 */
describe("end-to-end with the real curated batch", () => {
  const REAL = "/home/user/workspace/colombo_0409_rag_chunks.json";
  const present = existsSync(REAL);

  it.skipIf(!present)("ingested rows are retrievable and cite section + timecodes", () => {
    const validated = validateCuratedChunks(JSON.parse(readFileSync(REAL, "utf8")), {
      sourceId: SRC,
      hasSection: true,
      hasPage: false,
    });
    expect(validated.ok).toBe(true);

    const rows: PassageRow[] = validated.rows.map((r) => ({
      ...r,
      source: {
        id: SRC,
        title: "Colombo P&S 04-09-2026 Clinical Consultation (Transcript)",
        year: 2026,
        publication_type: "transcript",
        active_in_ai_analysis: true,
        review_status: "approved",
      },
    }));

    const sel = selectPassages(rows, QUERY);
    expect(sel.length).toBeGreaterThan(0);
    expect(sel[0].isTranscript).toBe(true);
    // Timecodes folded into the section locator survive into the citation.
    expect(sel[0].citation).toMatch(/\d{2}:\d{2}:\d{2}–\d{2}:\d{2}:\d{2}/);

    const block = buildPassagePromptSection(sel);
    expect(block).toMatch(/\[TRANSCRIPT\]/);
    expect(block).toMatch(/may require verification with the treating clinician/);
  });

  it.skipIf(!present)("an unrelated question retrieves nothing from the batch", () => {
    const validated = validateCuratedChunks(JSON.parse(readFileSync(REAL, "utf8")), {
      sourceId: SRC,
      hasSection: true,
      hasPage: false,
    });
    const rows: PassageRow[] = validated.rows.map((r) => ({
      ...r,
      source: {
        id: SRC, title: "Colombo Transcript", year: 2026, publication_type: "transcript",
        active_in_ai_analysis: true, review_status: "approved",
      },
    }));
    const sel = selectPassages(rows, "iontophoresis acetylcholine sudomotor axon");
    expect(buildPassagePromptSection(sel)).toBe("");
  });
});
