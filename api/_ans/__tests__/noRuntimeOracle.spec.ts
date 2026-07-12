/**
 * Guard test: the de-identified golden oracle is an OFFLINE regression target
 * only. No production/runtime code (api/**, client/**, server/**) may import it
 * or reintroduce a fingerprint-keyed numericalSummaryOverride. This encodes the
 * user's hard constraint that unknown/non-reproducible vendor aggregates are
 * never silently substituted by identity/hash at runtime.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes("__tests__")) acc.push(p);
  }
  return acc;
}

const RUNTIME_DIRS = ["api", "client", "server", "shared"].map((d) => resolve(repoRoot, d));

describe("offline oracle never enters the runtime", () => {
  const files = RUNTIME_DIRS.flatMap((d) => {
    try {
      return walk(d);
    } catch {
      return [];
    }
  });

  // Strip line + block comments so we only flag REAL code (imports/calls),
  // never prose that documents the removed anti-pattern.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("no runtime source imports or reads the eval oracle", () => {
    const offenders = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /eval\/oracles\//.test(src) || /jill_shah_(expected|deidentified)/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("numericalSummaryOverride is fully removed from production code", () => {
    const offenders = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /numericalSummaryOverride|lookupNumericalSummaryOverride|applyPhaseOverride/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("no fingerprint/identity-keyed vendor substitution by name in production", () => {
    // Heuristic: a runtime lookup that branches on a patient name literal to
    // inject numeric values would reintroduce the anti-pattern.
    const offenders = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /firstName\s*===\s*["']Jill["']|lastName\s*===\s*["']Shah["']/i.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
