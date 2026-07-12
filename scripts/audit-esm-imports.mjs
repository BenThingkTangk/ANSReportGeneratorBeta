#!/usr/bin/env node
/**
 * ESM Import Auditor
 *
 * Walks api/, shared/, server/ and flags every relative *runtime* import
 * that is missing an explicit `.js` extension. Type-only imports
 * (`import type ...` / `export type ...`) are ignored because the TS
 * compiler strips them before they hit the runtime.
 *
 * Vercel's Node 24 ESM runtime (and Node itself, under "type":"module")
 * requires explicit `.js` extensions on relative imports. Missing them
 * crashes the function at cold-start with FUNCTION_INVOCATION_FAILED,
 * with NO userland log surface — so we must catch this in CI.
 *
 * Usage:
 *   node scripts/audit-esm-imports.mjs           # exit 1 if any violations
 *   node scripts/audit-esm-imports.mjs --fix     # rewrite files in place
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SCAN_DIRS = ["api", "shared", "server"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build_output", ".vercel", "__tests__", "tests"]);
const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const FIX = process.argv.includes("--fix");

/**
 * Matches:
 *   import ... from "./foo"
 *   import ... from "../bar/baz"
 *   export ... from "./foo"
 *   export * from "../bar"
 *
 * Does NOT match `import type` / `export type` (those are stripped).
 * Captures: full statement prefix, quote, specifier
 */
// Match any import/export ... from "./x" or "../x" statement, including
// multi-line bracketed forms. We later filter out type-only statements by
// checking whether the matched statement begins with `import type` /
// `export type`.
const IMPORT_RE =
  /(^|\n)(\s*(?:import|export)(?:\s+type)?[^;'"`]*?from\s*)(['"])(\.{1,2}\/[^'"`]+)\3/g;

const TYPE_ONLY_STMT_RE = /^\s*(?:import|export)\s+type\b/;
// Also catch `import { type Foo, type Bar } from ...` where the WHOLE
// import is type-only (every named binding is prefixed with `type`).
function isAllTypeNamed(stmt) {
  const m = stmt.match(/\{([^}]*)\}/);
  if (!m) return false;
  const parts = m[1].split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(p => /^type\s+/.test(p));
}

const violations = [];

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (TS_EXTS.has(extname(e.name))) yield full;
  }
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Given a specifier like "./foo" or "../bar/baz", figure out what the
 * correct `.js` form should be (handles index files and directories).
 */
async function resolveJsForm(fromFile, spec) {
  const fromDir = dirname(fromFile);
  const base = resolve(fromDir, spec);

  // Already has known runtime extension? (.js/.mjs/.cjs/.json) — skip
  const ext = extname(spec);
  if ([".js", ".mjs", ".cjs", ".json"].includes(ext)) return null;

  // Try sibling .ts/.tsx → suggest .js
  for (const tsExt of [".ts", ".tsx"]) {
    if (await fileExists(base + tsExt)) return spec + ".js";
  }
  // Try directory index → suggest /index.js
  for (const tsExt of [".ts", ".tsx"]) {
    if (await fileExists(join(base, "index" + tsExt))) return spec.replace(/\/?$/, "/index.js");
  }
  // Can't resolve — flag but don't auto-fix
  return { unresolved: true };
}

async function auditFile(file) {
  const src = await readFile(file, "utf8");
  let newSrc = src;
  let changed = false;

  // Reset regex state per file
  IMPORT_RE.lastIndex = 0;

  const fileViolations = [];
  const replacements = [];

  for (const match of src.matchAll(IMPORT_RE)) {
    const [full, leadNl, prefix, quote, spec] = match;
    // Reconstruct the full statement text starting from import/export
    // through the closing quote so we can apply type-only checks.
    const stmt = (leadNl ? "" : "") + prefix + quote + spec + quote;
    if (TYPE_ONLY_STMT_RE.test(stmt)) continue;
    if (isAllTypeNamed(stmt)) continue;

    const ext = extname(spec);
    if ([".js", ".mjs", ".cjs", ".json"].includes(ext)) continue;

    const fixed = await resolveJsForm(file, spec);
    if (!fixed) continue;

    if (typeof fixed === "object" && fixed.unresolved) {
      fileViolations.push({ spec, line: stmt.split("\n")[0].trim(), fix: null });
    } else {
      fileViolations.push({ spec, line: stmt.split("\n")[0].trim(), fix: fixed });
      const fixedFull = full.replace(`${quote}${spec}${quote}`, `${quote}${fixed}${quote}`);
      replacements.push({ from: full, to: fixedFull });
    }
  }

  if (fileViolations.length) {
    violations.push({ file: relative(REPO_ROOT, file), items: fileViolations });
    if (FIX) {
      for (const r of replacements) newSrc = newSrc.replace(r.from, r.to);
      if (newSrc !== src) {
        await writeFile(file, newSrc, "utf8");
        changed = true;
      }
    }
  }
  return changed;
}

let fixedCount = 0;
for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(REPO_ROOT, dir))) {
    const changed = await auditFile(file);
    if (changed) fixedCount++;
  }
}

if (violations.length === 0) {
  console.log("✓ ESM import audit: all relative runtime imports use explicit .js extensions");
  process.exit(0);
}

console.log(`\nESM import audit — ${violations.reduce((n, v) => n + v.items.length, 0)} violation(s) across ${violations.length} file(s):\n`);
for (const v of violations) {
  console.log(`  ${v.file}`);
  for (const item of v.items) {
    const arrow = item.fix ? `→ ${item.fix}` : "(could not auto-resolve)";
    console.log(`    "${item.spec}" ${arrow}`);
  }
}

if (FIX) {
  console.log(`\n✓ Rewrote ${fixedCount} file(s).`);
  process.exit(0);
} else {
  console.log(`\nRun \`node scripts/audit-esm-imports.mjs --fix\` to auto-fix.`);
  process.exit(1);
}
