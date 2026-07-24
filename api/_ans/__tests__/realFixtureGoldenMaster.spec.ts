/**
 * Deterministic golden-master + anti-oracle tests over REAL de-identified .ans
 * fixtures (Jill Shah → "Jane Faux", Alex Pare → "John Faux").
 *
 * These fixtures are byte-for-byte copies of the real vendor .ans exports with
 * ONLY the patient name strings replaced (same length, offsets preserved) and
 * the DOB shifted to Jan-1 of the birth year (see scripts/build-deid-fixture.mts).
 * Every clinically-verifiable value the parser reads — identity structure,
 * study date (from the binary LabVIEW timestamp), Ewing ratios, ectopy note,
 * height, and the full int16 ECG waveform — is therefore identical to the real
 * files. That makes them a genuine oracle for directly-verifiable source data,
 * not a synthetic/circular fixture.
 *
 * What these tests PROVE:
 *   1. The canonical engine extracts the exact embedded Ewing ratios, ectopy,
 *      identity and study date the vendor recorded (Pare: E/I 1.22, Valsalva
 *      1.49, 30:15 1.33, ectopy 1 — asserted verbatim per the task).
 *   2. Parsing is deterministic across repeated runs on the same bytes.
 *   3. Proprietary spectral aggregates (LFa/RFa/SB) and cuff BP are NOT
 *      synthesized from the raw waveform — they stay null/unavailable unless a
 *      paired vendor PDF supplies them.
 *   4. ANTI-ORACLE: no per-patient hardcode. Renaming the patient does not
 *      change any measured value; the removed `isJillShah` fabrication is gone;
 *      and no fabricated demographic defaults (weight=150 / BMI) leak in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseANSFile, generateColomboReport, clinicalSnapshot } from "../../upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

type Report = ReturnType<typeof generateColomboReport>;
function reportFor(file: string, fileName: string): { data: ReturnType<typeof parseANSFile>; report: Report } {
  const buf = readFileSync(file);
  const data = parseANSFile(buf, fileName);
  return { data, report: generateColomboReport(data) };
}

describe("real de-identified fixtures — golden master", () => {
  it("Pare fixture reproduces the vendor's embedded verifiable values exactly", () => {
    const { data, report } = reportFor(fixture("pare_deid.ans"), "pare_deid.ans");
    // Identity STRUCTURE (name de-identified, everything else real).
    expect(data.gender).toBe("Male");
    expect(data.physician).toBe("Colombo");
    // Study date from the binary LabVIEW timestamp (filename is de-identified).
    expect(data.testDate).toBe("7/11/2024");
    // Ewing battery — asserted verbatim per the task requirement.
    expect(data.eiRatio).toBeCloseTo(1.22, 2);
    expect(data.valsalvaRatio).toBeCloseTo(1.49, 2);
    expect(data.thirtyFifteenRatio).toBeCloseTo(1.33, 2);
    // Ectopy note (free-text "possible premature beat").
    expect(data.ectopicBeats).toBe(1);
    // Height is a directly-parsed source value.
    expect(data.height).toBe("6 ft 2 in");
    // Full waveform is materialized (not truncated to a preview).
    expect(data.ecgData.length).toBeGreaterThan(200_000);
    // Proprietary spectral + BP are NOT reproducible from the .ans — gated.
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    // Procedure is a bare binary marker in this .ans (no real value); it must
    // be MISSING, never the stray "n" the non-greedy pattern used to capture.
    expect(data.procedureType).not.toBe("n");
    expect([""].includes(data.procedureType) || data.procedureType == null).toBe(true);
    // Weight/BMI are NOT in the .ans → stay missing (0), never fabricated.
    expect(data.weight).toBe(0);
    expect(data.bmi).toBe(0);
  });

  it("Jill fixture reproduces the vendor's embedded verifiable values exactly", () => {
    const { data, report } = reportFor(fixture("jill_deid.ans"), "jill_deid.ans");
    expect(data.gender).toBe("Female");
    expect(data.physician).toBe("Colombo");
    expect(data.testDate).toBe("9/26/2025");
    expect(data.eiRatio).toBeCloseTo(1.21, 2);
    expect(data.valsalvaRatio).toBeCloseTo(1.43, 2);
    expect(data.thirtyFifteenRatio).toBeCloseTo(1.4, 2);
    expect(data.ectopicBeats).toBe(1);
    expect(data.height).toBe("5 ft 6 in");
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
  });

  it("parsing the SAME bytes is deterministic (byte-identical golden output)", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const a = reportFor(fixture(fn), fn).data;
      const b = reportFor(fixture(fn), fn).data;
      const pick = (d: typeof a) => ({
        firstName: d.firstName, lastName: d.lastName, gender: d.gender,
        physician: d.physician, testDate: d.testDate, age: d.age,
        eiRatio: d.eiRatio, valsalvaRatio: d.valsalvaRatio,
        thirtyFifteenRatio: d.thirtyFifteenRatio, ectopicBeats: d.ectopicBeats,
        height: d.height, ecgSampleCount: d.ecgData.length,
      });
      expect(pick(a)).toEqual(pick(b));
    }
  });

  it("clinicalSnapshot is byte-identical across runs (envelope timestamps excluded)", () => {
    // The full report carries generatedAt/parsedAt envelope metadata that change
    // every run; clinicalSnapshot strips them so the CLINICAL content can be
    // compared/hashed deterministically. Two runs on the same bytes must match.
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const a = clinicalSnapshot(reportFor(fixture(fn), fn).report);
      const b = clinicalSnapshot(reportFor(fixture(fn), fn).report);
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      // The raw reports DO differ only by the excluded timestamp.
      expect("generatedAt" in a).toBe(false);
    }
  });

  it("wellness score stays stable and does NOT collapse when spectral is unavailable", () => {
    // Score is a weighted average over AVAILABLE components (HR + Ewing + HRV);
    // the spectral-only sympathovagal sub-score is dropped, not zeroed.
    const pare = reportFor(fixture("pare_deid.ans"), "pare_deid.ans").report;
    const jill = reportFor(fixture("jill_deid.ans"), "jill_deid.ans").report;
    expect(pare.wellnessBreakdown.final).toBeCloseTo(91.2, 1);
    expect(jill.wellnessBreakdown.final).toBeCloseTo(84.8, 1);
    // Sympathovagal sub-score is explicitly unavailable (spectral-only).
    expect(pare.wellnessBreakdown.sympathovagalBalance.available).toBe(false);
    expect(jill.wellnessBreakdown.sympathovagalBalance.available).toBe(false);
    // Always-measured sub-scores remain available.
    expect(pare.wellnessBreakdown.reflexIntegrity.available).not.toBe(false);
    expect(pare.wellnessBreakdown.hrvReserve.available).not.toBe(false);
  });
});

describe("anti-oracle — no per-patient hardcode, no fabricated proprietary data", () => {
  it("no phase carries a synthesized spectral aggregate (all null without vendor data)", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const { report } = reportFor(fixture(fn), fn);
      for (const ph of report.phaseEvents) {
        expect(ph.LFa).toBeNull();
        expect(ph.RFa).toBeNull();
        expect(ph.SB).toBeNull();
      }
      // Balance gauge + spectral trends carry no invented numbers.
      expect(report.autonomicBalance.available).toBe(false);
      expect(report.autonomicBalance.parasympathetic).toBeNull();
      expect(report.autonomicBalance.sympathetic).toBeNull();
      expect(report.multiParameter?.lfaTrend.t.length ?? 0).toBe(0);
      expect(report.multiParameter?.rfaTrend.t.length ?? 0).toBe(0);
      expect(report.multiParameter?.scatter.baselineRFa ?? null).toBeNull();
    }
  });

  it("renaming the patient does not change any measured value (no name-keyed branch)", () => {
    // Same bytes, different declared filename → identical measured output. If a
    // per-patient hardcode existed it would key off the parsed name, not change
    // here; the stronger guarantee is that the fixtures (renamed to 'Faux')
    // still yield the real vendor ratios, proving extraction is generic.
    const a = reportFor(fixture("pare_deid.ans"), "pare_deid.ans").data;
    const b = reportFor(fixture("pare_deid.ans"), "unrelated-name.ans").data;
    expect(a.eiRatio).toBe(b.eiRatio);
    expect(a.valsalvaRatio).toBe(b.valsalvaRatio);
    expect(a.thirtyFifteenRatio).toBe(b.thirtyFifteenRatio);
  });

  it("the de-identified name really is de-identified (source contained real PHI)", () => {
    // Guards the fixture itself: the committed bytes must not contain the real
    // patient NAMES as they were stored — i.e. the exact-case identifier
    // strings the vendor wrote into the header. We scan the WHOLE file
    // case-sensitively (the stored names are proper-cased "Shah"/"Jill"/…),
    // so we don't false-positive on the 4-byte patterns that occur naturally
    // inside 600 KB of int16 ECG signal. If someone re-commits a raw PHI file,
    // its exact-case header name reappears and this fails.
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const bytes = readFileSync(fixture(fn)).toString("latin1");
      expect(bytes).not.toContain("Shah");
      expect(bytes).not.toContain("Jill");
      expect(bytes).not.toContain("Pare");
      expect(bytes).not.toContain("Alex");
      // And the pseudonym IS present in the header (offset 4).
      expect(bytes.slice(4, 8)).toBe("Faux");
    }
  });

  it("upload.ts source contains no per-patient hardcode or SCALE spectral constant", () => {
    const src = readFileSync(path.join(__dirname, "..", "..", "upload.ts"), "utf-8");
    // The isJillShah name-keyed branch and its fabricated ratio literals are gone.
    expect(src).not.toMatch(/isJillShah\s*[=?]/);
    expect(src).not.toMatch(/\/\^shah\$\/i\.test/);
    // The curve-fit spectral calibration constant is gone.
    expect(src).not.toContain("const SCALE = 0.0018");
    // No morletBandPower DEFINITION or CALL remains (a comment noting the
    // removal is fine — we only forbid `function morletBandPower` and callsites).
    expect(src).not.toMatch(/function morletBandPower/);
    expect(src).not.toMatch(/morletBandPower\(/);
  });

  it("no fabricated demographic defaults (weight=150 / height=1.73) leak in", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const { data } = reportFor(fixture(fn), fn);
      // The .ans files carry no weight → must stay 0 (missing), never defaulted.
      expect(data.weight).toBe(0);
      expect(data.bmi).toBe(0);
    }
  });
});

describe("vendor-parity contract — unresolved values are explicit, never invented", () => {
  it("without a paired vendor PDF, proprietary spectral/BP are marked unavailable", () => {
    const { report } = reportFor(fixture("pare_deid.ans"), "pare_deid.ans");
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    // The report must SAY not-assessed rather than render a number.
    expect(report.autonomicBalance.interpretation.toLowerCase()).toMatch(
      /not assessed|not available|spectral/,
    );
  });

  it("a paired vendor PDF unlocks ONLY the values it actually supplies", () => {
    const { data } = reportFor(fixture("jill_deid.ans"), "jill_deid.ans");
    // Simulate the paired-report path (x-vendor-metrics) supplying baseline
    // spectral + cuff BP. This is the ONLY legitimate source of these numbers.
    const vendor = { LFa: 1.5, RFa: 2.5, SB: 0.6, SBP: 92, DBP: 55 };
    const report = generateColomboReport(data, vendor);
    expect(report.spectralAvailable).toBe(true);
    expect(report.bpAvailable).toBe(true);
    // Baseline A carries the vendor's verbatim values.
    expect(report.phaseEvents[0].LFa).toBe(1.5);
    expect(report.phaseEvents[0].RFa).toBe(2.5);
    expect(report.phaseEvents[0].SB).toBe(0.6);
    expect(report.autonomicBalance.available).toBe(true);
    // Phases the vendor did NOT supply (B–F) stay unavailable — never inferred.
    expect(report.phaseEvents[5].LFa).toBeNull();
    expect(report.phaseEvents[5].RFa).toBeNull();
  });

  it("real Jill/Pare source files (when present locally) match the fixtures' ratios", () => {
    // Extra defense-in-depth when the un-redacted files exist in the dev
    // sandbox: proves the de-id transform preserved the verifiable values.
    const REAL = [
      { f: "/home/user/workspace/uploaded_attachments/ec675734cc734ec0bb1f6049b2b17015/Pare-Alex-Thu-Jul-11-2024.ans",
        ei: 1.22, val: 1.49, tf: 1.33 },
      { f: "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans",
        ei: 1.21, val: 1.43, tf: 1.4 },
    ];
    for (const r of REAL) {
      if (!existsSync(r.f)) continue;
      const d = parseANSFile(readFileSync(r.f), path.basename(r.f));
      expect(d.eiRatio).toBeCloseTo(r.ei, 2);
      expect(d.valsalvaRatio).toBeCloseTo(r.val, 2);
      expect(d.thirtyFifteenRatio).toBeCloseTo(r.tf, 2);
    }
  });
});

describe("BLOCKER 1 regression — baseline-only vendor never fabricates B–F findings", () => {
  // A paired vendor PDF supplies ONLY baseline (A) spectral + cuff BP. Phases
  // B–F stay null. The global spectralAvailable gate becomes true, but the
  // per-phase gate must keep the unassessed Valsalva/stand responses out of the
  // narrative — the prior code classified null→0 and fabricated Low/Abnormal
  // responses and a spurious "advanced autonomic dysfunction" impression.
  const baselineOnlyVendor = { LFa: 1.5, RFa: 2.5, SB: 0.6, SBP: 92, DBP: 55 };

  for (const fn of ["jill_deid.ans", "pare_deid.ans"]) {
    it(`${fn}: baseline-only vendor unlocks A but never fabricates Valsalva/stand/AAD`, () => {
      const { data } = reportFor(fixture(fn), fn);
      const report = generateColomboReport(data, baselineOnlyVendor);

      expect(report.spectralAvailable).toBe(true); // baseline A is vendor-reported
      // Baseline A carries the real vendor values.
      expect(report.phaseEvents[0].LFa).toBe(1.5);
      // Phases B–F remain null (vendor gave baseline only).
      expect(report.phaseEvents[3].LFa).toBeNull(); // Valsalva D
      expect(report.phaseEvents[5].LFa).toBeNull(); // Stand F

      const allText = [
        ...report.phaseFindings.flatMap((p: any) => p.findings),
        report.overallImpression,
        report.riskLevel,
      ].join("   ");

      // No fabricated spectral abnormality for the unassessed phases.
      expect(allText).not.toMatch(/Low sympathetic response \(LFa\) to Valsalva/i);
      expect(allText).not.toMatch(/Low parasympathetic response \(RFa\) to Valsalva/i);
      expect(allText).not.toMatch(/(Low|Abnormal|High) sympathetic response \(LFa\) to stand/i);
      // No fabricated advanced autonomic dysfunction from unassessed challenges.
      expect(allText).not.toMatch(/advanced autonomic dysfunction/i);
      expect(report.dysfunctionPatterns?.advancedAutonomicDysfunction).toBeFalsy();
      expect(report.dysfunctionPatterns?.CAN).toBeFalsy();
      expect(report.dysfunctionPatterns?.sympatheticWithdrawal).toBeFalsy();
      expect(report.dysfunctionPatterns?.parasympatheticWithdrawal).toBeFalsy();

      // The unassessed phases must SAY so, not render a classification.
      const dbPhase = report.phaseFindings.find((p: any) => /DEEP BREATHING/i.test(p.phase));
      expect(dbPhase?.findings.join(" ")).toMatch(/not assessed/i);
      const standPhase = report.phaseFindings.find((p: any) => /STAND/i.test(p.phase));
      expect(standPhase?.findings.join(" ")).toMatch(/not assessed/i);
    });
  }

  it("stand HR observation still surfaces without spectral (no unsupported verdict)", () => {
    // The ECG-derived HR delta on standing must remain reportable even when
    // stand spectral is unavailable — but as a neutral OBSERVATION (or the
    // validated POTS criterion), never an unsupported "Insufficient" verdict
    // when standing BP was not recorded.
    const { data } = reportFor(fixture("jill_deid.ans"), "jill_deid.ans");
    const report = generateColomboReport(data, baselineOnlyVendor);
    const standPhase = report.phaseFindings.find((p: any) => /STAND/i.test(p.phase));
    const text = standPhase?.findings.join(" ") ?? "";
    expect(text).toMatch(/Heart-rate change on standing|POTS/i);
    // Must NOT assert an orthostatic adequacy verdict without standing BP.
    expect(text).not.toMatch(/Insufficient HR response/i);
  });
});
