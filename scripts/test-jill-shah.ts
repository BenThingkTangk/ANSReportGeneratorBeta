// Direct test of the Colombo algorithm using Jill Shah's PDF values.
// This bypasses the .ans binary parser to verify algorithm narrative.
//
// Run with:  npx tsx scripts/test-jill-shah.ts

// Since the algorithm is inlined in api/upload.ts and only default-exports the
// handler, we re-declare a small driver by dynamically importing the module
// source text. Instead, we duplicate the function signature pattern here by
// importing from the module after temporarily exposing the entry point.
//
// Simpler approach: use a child_process to hit a locally-stubbed version.
// For now, we use a direct eval of the module text with a light shim.

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const src = readFileSync(resolve(__dirname, "../api/upload.ts"), "utf-8");

// Extract the algorithm body (from "STAGE 1" onward, stopping before the handler)
const startMark = "// ============================================================================\n// STAGE 1";
const endMark = "// ---- Handler";
const startIdx = src.indexOf(startMark);
const endIdx = src.indexOf(endMark);
if (startIdx < 0 || endIdx < 0) throw new Error("Could not locate algorithm boundaries");
const algoText = src.slice(startIdx, endIdx);

// Extract the types (top of file, before multipart parser)
const typesEnd = src.indexOf("// ---- Multipart Parser");
if (typesEnd < 0) throw new Error("Could not locate types end");
const typesText = src.slice(src.indexOf("interface ParsedANSData"), typesEnd);

// Compose a runnable TS snippet and require('tsx') to execute it
// Strip TS annotations for CJS runtime: use tsx's compiler instead
const runnable = `
${typesText}
${algoText}
// @ts-ignore
module.exports = { generateColomboReport };
`;

const tmp = resolve(__dirname, "_jill_runner.mts");
// Emit as ES module and add a default export
const esmRunnable = `
${typesText}
${algoText}
export { generateColomboReport };
`;
writeFileSync(tmp, esmRunnable);
const mod = await import(tmp);
const { generateColomboReport } = mod as { generateColomboReport: (d: any) => any };

// Build Jill Shah's parsed data directly (bypassing the .ans parser)
// Source: /home/user/workspace/parsed.Shah-Jill-Fri-Sep-26-2025.txt
// A .ans file is ~2500-3000s (~16 min at 250 Hz). We fake an ECG long enough
// for the phase segmenter, with a synthetic sinusoidal pattern so R-peak
// detection finds *something* (the specific metrics will be overridden below
// if needed). Duration total: 300+60+60+95+150+330 = 995 sec.
const samplingInterval = 0.004; // 250 Hz
const totalSec = 300 + 60 + 60 + 95 + 150 + 330;
const N = Math.floor(totalSec / samplingInterval);
const ecg: number[] = new Array(N);
// Synthetic ECG: 1 Hz sinus + R-peak spikes every ~1 sec to simulate HR ~60 bpm
const fs = 250;
for (let i = 0; i < N; i++) {
  const t = i / fs;
  // 0.25 Hz breathing modulation in RR plus R-peak spike
  const breath = 0.25 * Math.sin(2 * Math.PI * 0.12 * t);
  const rrSec = 1.07 + breath * 0.12; // nominal ~56 bpm
  const phase = (t % rrSec) / rrSec;
  let v = 0;
  if (phase > 0.95) v = 200 * Math.sin(Math.PI * (phase - 0.95) / 0.05);
  else v = 10 * Math.sin(2 * Math.PI * t * 8);
  ecg[i] = Math.round(32768 + v);
}

const jill = {
  lastName: "Shah",
  firstName: "Jill",
  gender: "Female",
  physician: "Dr. Colombo",
  height: "5 ft 6 in",
  age: 56,
  weight: 124,
  bmi: 20.01,
  dobString: "1969",
  testDate: "9/26/2025",
  eiRatio: 1.21,
  valsalvaRatio: 1.43,
  thirtyFifteenRatio: 1.40,
  ectopicBeats: 1,
  testNotes: "",
  procedureType: "Procedure",
  samplingInterval,
  dataPointCount: N,
  ecgData: ecg,
  baselineSystolicBP: 92,
  baselineDiastolicBP: 55,
};

const report = generateColomboReport(jill);

console.log("=== JILL SHAH REPORT VERIFICATION ===");
console.log("Wellness Score:", report.wellnessScore, "Tier:", report.wellnessTier);
console.log("Risk Level:", report.riskLevel);
console.log("Overall:", report.overallImpression);
console.log("");
console.log("Phase events:");
for (const p of report.phaseEvents) {
  console.log(`  ${p.phase} ${p.duration} | HR=${p.meanHR} LFa=${p.LFa.toFixed(2)} RFa=${p.RFa.toFixed(2)} SB=${p.SB.toFixed(2)} FRF=${p.FRF.toFixed(2)}`);
}
console.log("");
console.log("Dysfunction patterns:");
for (const [k, v] of Object.entries(report.dysfunctionPatterns)) {
  if (v) console.log("  ✓", k);
}
console.log("");
console.log("Therapies:");
for (const t of report.therapyRecommendations) {
  console.log(`  [${t.priority}] ${t.category}: ${t.intervention}`);
}
console.log("");
console.log("Contraindications:");
for (const c of report.contraindications) console.log("  ✗", c);
console.log("");
console.log("Clinical flags:");
for (const f of report.clinicalFlags) console.log("  !", f);

// Assertions — Jill Shah PDF narrative
const assertions: { label: string; pass: boolean }[] = [];
assertions.push({ label: "Risk is Mild (not High/Moderate)", pass: /Mild/i.test(report.riskLevel) });
assertions.push({ label: "Overall says mild dysfunction possible", pass: /mild autonomic dysfunction/i.test(report.overallImpression) });
assertions.push({ label: "ALA contraindication mentions low BP", pass: report.contraindications.some((c: string) => /Alpha-Lipoic|ALA/.test(c) && /low.*(blood pressure|BP)/i.test(c)) || !report.therapyRecommendations.some((t: any) => /Alpha-Lipoic|ALA/.test(t.intervention)) });
assertions.push({ label: "Bradycardia flagged", pass: report.dysfunctionPatterns.bradycardia });
assertions.push({ label: "Wellness score is 0-100", pass: report.wellnessScore >= 0 && report.wellnessScore <= 100 });
assertions.push({ label: "Phase events has exactly 6 phases", pass: report.phaseEvents.length === 6 });

console.log("\n=== ASSERTIONS ===");
let failed = 0;
for (const a of assertions) {
  console.log(`${a.pass ? "✓" : "✗"} ${a.label}`);
  if (!a.pass) failed++;
}
console.log(`\n${assertions.length - failed}/${assertions.length} passed`);
process.exit(failed > 0 ? 1 : 0);

console.log("\n=== WELLNESS BREAKDOWN ===");
const bd = report.wellnessBreakdown;
console.log(`\nHeadline: ${bd.headline}`);
console.log(`\nSub-scores (score × weight = contribution):`);
console.log(`  Baseline Autonomic Tone:     ${bd.baselineAutonomic.score.toFixed(1)}/100 × ${bd.baselineAutonomic.weight} = ${bd.baselineAutonomic.contribution}`);
console.log(`  Sympathovagal Balance:       ${bd.sympathovagalBalance.score.toFixed(1)}/100 × ${bd.sympathovagalBalance.weight} = ${bd.sympathovagalBalance.contribution}`);
console.log(`  Reflex Integrity:            ${bd.reflexIntegrity.score.toFixed(1)}/100 × ${bd.reflexIntegrity.weight} = ${bd.reflexIntegrity.contribution}`);
console.log(`  Orthostatic Response:        ${bd.orthostaticResponse.score.toFixed(1)}/100 × ${bd.orthostaticResponse.weight} = ${bd.orthostaticResponse.contribution}`);
console.log(`  HRV Reserve:                 ${bd.hrvReserve.score.toFixed(1)}/100 × ${bd.hrvReserve.weight} = ${bd.hrvReserve.contribution}`);
console.log(`  Raw total: ${bd.rawTotal} → × age ${bd.ageMultiplier} = ${bd.ageAdjusted}`);
console.log(`  Pattern penalty: -${bd.patternPenalty.total}`);
console.log(`  FINAL: ${bd.final}`);
console.log(`\nTop DRAGGERS (points lost):`);
for (const d of bd.topNegativeDrivers) console.log(`  ${d.points.toFixed(1)} | [${d.severity}] ${d.label} (${d.value})`);
console.log(`\nTop BOOSTERS (points gained):`);
for (const d of bd.topPositiveDrivers) console.log(`  +${d.points.toFixed(1)} | [${d.severity}] ${d.label} (${d.value})`);
console.log(`\nPattern penalties applied:`);
for (const p of bd.patternPenalty.items) console.log(`  ${p.points.toFixed(1)} | [${p.severity}] ${p.label}`);
