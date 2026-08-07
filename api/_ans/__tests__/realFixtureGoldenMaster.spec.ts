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
 *   3. The embedded PhysioPS A–F summary is read directly with `ans_stored`
 *      provenance, while legacy/truncated files retain the explicitly labelled
 *      HumanOS waveform-estimation fallback.
 *   4. ANTI-ORACLE: no per-patient hardcode. Renaming the patient does not
 *      change any measured value; the removed `isJillShah` fabrication is gone;
 *      and no fabricated demographic defaults (weight=150 / BMI) leak in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseANSFile, generateColomboReport, clinicalSnapshot } from "../../upload.js";
import { withoutStoredSummary } from "./helpers/storedSummary.js";

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
    expect(report.spectralAvailable).toBe(true);
    expect(report.spectralSource).toBe("ans_stored");
    expect(report.bpAvailable).toBe(true);
    // Procedure is a bare binary marker in this .ans (no real value); it must
    // be MISSING, never the stray "n" the non-greedy pattern used to capture.
    expect(data.procedureType).not.toBe("n");
    expect([""].includes(data.procedureType) || data.procedureType == null).toBe(true);
    // Weight/BMI are NOT in the .ans → stay NULL, never 0 and never fabricated.
    // 0 lb / BMI 0 is a sentinel a clinician reads as a real value.
    expect(data.weight).toBeNull();
    expect(data.bmi).toBeNull();
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
    expect(report.spectralAvailable).toBe(true);
    expect(report.spectralSource).toBe("ans_stored");
    expect(report.bpAvailable).toBe(true);
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

  it("wellness score remains suppressed by independent ECG-quality gates after spectral-domain recovery", () => {
    // The embedded vendor summary now recovers the sympathovagal domain. That
    // must not bypass the separate ECG-quality gate or invent the HRV-reserve
    // component that still depends on usable waveform coverage.
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const report = reportFor(fixture(fn), fn).report;
      const bd = report.wellnessBreakdown;
      expect(bd.scorability.scorable).toBe(false);
      expect(bd.final).toBeNull();
      expect(bd.rawTotal).toBeNull();
      expect(report.wellnessScore).toBeNull();
      expect(report.wellnessTier).toBeNull();
      expect(bd.sympathovagalBalance.available).toBe(true);
      expect(bd.sympathovagalBalance.weight).toBeGreaterThan(0);
      expect(bd.sympathovagalBalance.score).not.toBeNull();
      // The recovered spectral domain keeps its configured weight. Any domain
      // still unavailable for this recording remains missing rather than being
      // redistributed across the available domains.
      const sum =
        bd.baselineAutonomic.weight + bd.sympathovagalBalance.weight +
        bd.reflexIntegrity.weight + bd.orthostaticResponse.weight + bd.hrvReserve.weight;
      expect(sum + bd.scorability.unavailableWeight).toBeCloseTo(1, 6);
      expect(bd.scorability.blockers.map((b) => b.code)).toContain("ECG_UNUSABLE");
      expect(bd.scorability.blockers.map((b) => b.code)).not.toContain("ESSENTIAL_DOMAIN_MISSING");
      // Reflex integrity (Ewing ratios) is still genuinely measured.
      expect(bd.reflexIntegrity.available).toBe(true);
    }
  });
});

describe("anti-oracle — no per-patient hardcode, no fabricated proprietary data", () => {
  it("stored spectral values are direct .ans data, never identity-keyed substitutions", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const { report } = reportFor(fixture(fn), fn);
      expect(report.spectralSource).toBe("ans_stored");
      for (const ph of report.phaseEvents) {
        for (const key of ["LFa", "RFa", "SB"] as const) {
          const prov = ph.provenance?.[key];
          // Embedded .ans provenance is distinct from paired-PDF provenance.
          expect(prov?.method).not.toBe("vendor_reported");
          expect(prov?.method).not.toBe("derived_from_vendor");
          if (ph[key] === null) continue;
          expect(prov?.method).toBe("ans_stored");
          expect(prov?.validation).toBe("not_applicable");
          expect(Number.isFinite(ph[key] as number)).toBe(true);
        }
      }
      expect(report.spectralAvailable).toBe(true);
      expect(report.autonomicBalance.available).toBe(true);
      expect(report.multiParameter?.lfaTrend.t.length ?? 0).toBeGreaterThan(0);
      expect(report.multiParameter?.rfaTrend.t.length ?? 0).toBeGreaterThan(0);
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
    // The curve-fit spectral calibration constant is gone AND must never return.
    // This is the real defect the earlier beta engine carried: a single scalar
    // fitted so ONE patient's estimates landed on ONE vendor PDF. The generic
    // waveform engine is allowed back (it lives in api/_ans/spectral.ts and
    // converts R-R to instantaneous bpm so band power is natively in bpm²); a
    // fitted magic constant is not.
    expect(src).not.toContain("const SCALE = 0.0018");
    expect(src).not.toMatch(/^\s*(?:const|let|var)\s+SCALE\s*=/m);
    // No spectral maths is DEFINED inline in the endpoint — it must be imported
    // from the reviewed, unit-tested engine module.
    expect(src).not.toMatch(/function\s+morletBandPower/);
    expect(src).toMatch(/from\s+"\.\/_ans\/spectral\.js"/);

    const engine = readFileSync(path.join(__dirname, "..", "spectral.ts"), "utf-8");
    // The engine itself carries no patient-specific fitting or name keys.
    expect(engine).not.toMatch(/jill|shah|alex|pare/i);
    expect(engine).not.toMatch(/^\s*(?:const|let|var)\s+SCALE\s*=/m);
  });

  it("no fabricated demographic defaults (weight=150 / height=1.73) leak in", () => {
    for (const fn of ["pare_deid.ans", "jill_deid.ans"]) {
      const { data } = reportFor(fixture(fn), fn);
      // The .ans files carry no weight -> must stay NULL (missing), never 0 and
      // never a fabricated default.
      expect(data.weight).toBeNull();
      expect(data.bmi).toBeNull();
    }
  });
});

describe("vendor-parity contract — embedded values outrank estimates", () => {
  it("reads proprietary spectral/BP directly from a modern .ans summary", () => {
    const { report } = reportFor(fixture("pare_deid.ans"), "pare_deid.ans");
    expect(report.spectralAvailable).toBe(true);
    expect(report.spectralSource).toBe("ans_stored");
    expect(report.bpAvailable).toBe(true);
    expect(report.phaseEvents[0].LFa).toBe(1.62);
    expect(report.phaseEvents[0].RFa).toBe(0.63);
    expect(report.phaseEvents[0].SB).toBe(2.59);
  });

  it("a paired vendor PDF unlocks ONLY the values it actually supplies", () => {
    const { data } = reportFor(fixture("jill_deid.ans"), "jill_deid.ans");
    // Simulate the paired-report path (x-vendor-metrics) supplying baseline
    // spectral + cuff BP. This is the ONLY legitimate source of these numbers.
    const vendor = { LFa: 1.5, RFa: 2.5, SB: 0.6, SBP: 92, DBP: 55 };
    const report = generateColomboReport(data, vendor);
    expect(report.spectralAvailable).toBe(true);
    expect(report.bpAvailable).toBe(true);
    // Baseline A preserves the exact values embedded in the .ans. A paired PDF
    // supplements missing fields but never overwrites stored measurements.
    expect(report.phaseEvents[0].LFa).toBe(0.91);
    expect(report.phaseEvents[0].RFa).toBe(5.13);
    expect(report.phaseEvents[0].SB).toBe(0.18);
    expect(report.autonomicBalance.available).toBe(true);
    expect(report.phaseEvents[0].provenance?.LFa.method).toBe("ans_stored");
    // B–F remain the exact values embedded in the .ans; the baseline-only PDF
    // override does not erase or relabel them.
    for (const i of [1, 2, 3, 4, 5]) {
      const prov = report.phaseEvents[i].provenance;
      expect(prov?.LFa.method).not.toBe("vendor_reported");
      expect(prov?.RFa.method).not.toBe("vendor_reported");
      if (report.phaseEvents[i].LFa !== null) {
        expect(prov?.LFa.method).toBe("ans_stored");
        expect(prov?.LFa.validation).toBe("not_applicable");
      }
    }
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
      const raw = readFileSync(fixture(fn));
      const data = parseANSFile(withoutStoredSummary(raw), fn);
      const report = generateColomboReport(data, baselineOnlyVendor);

      expect(report.spectralAvailable).toBe(true); // baseline A is vendor-reported
      // Baseline A carries the real vendor values.
      expect(report.phaseEvents[0].LFa).toBe(1.5);
      expect(report.phaseEvents[0].provenance?.LFa.method).toBe("vendor_reported");
      // Phases B–F were NOT supplied by the vendor. Any value there is a
      // HumanOS estimate and is tagged as such; the standing/Valsalva clinical
      // gates therefore stay shut (asserted by the narrative checks below).
      for (const i of [3, 5]) {
        expect(report.phaseEvents[i].provenance?.LFa.method).not.toBe("vendor_reported");
        if (report.phaseEvents[i].LFa !== null) {
          expect(report.phaseEvents[i].provenance?.LFa.validation).toBe("estimated");
        }
      }

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
