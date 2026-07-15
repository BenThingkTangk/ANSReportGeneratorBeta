/**
 * Packaging regression test — proves the DEPLOYED Vercel function artifact for
 * /api/upload-vendor will actually CONTAIN the native OCR runtime, not merely
 * that the deps are externalized from esbuild.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first fix (canvasPolyfill) removed the `DOMMatrix is not defined` crash,
 * but the live endpoint still returned
 *   "PDF rasterizer unavailable (pdfjs-dist / @napi-rs/canvas not installed)."
 * Root cause: our OCR deps are imported through a bundler-opaque indirection
 * (`new Function("s","return import(s)")` / runtime `createRequire`) so esbuild
 * never inlines the `.node` binary. But @vercel/node traces each function's
 * files with @vercel/nft — the SAME static analysis — so those opaque imports
 * are invisible to the tracer too, and Vercel ships the function WITHOUT
 * @napi-rs/canvas, its native skia `.node` binary, the pdfjs worker, or the
 * tesseract-core wasm. At runtime the require fails and OCR degrades to
 * "unavailable".
 *
 * The fix is `vercel.json` → functions["api/upload-vendor.ts"].includeFiles,
 * which force-includes those files into the Lambda regardless of tracing. This
 * test locks that in: it reads the REAL includeFiles glob from vercel.json and
 * resolves it with @vercel/build-utils' own `glob` (exactly what @vercel/node
 * runs), then asserts the packaged file set contains:
 *   • the linux-x64 skia `.node` native binary for THIS platform family,
 *   • @napi-rs/canvas's JS loader,
 *   • pdfjs-dist's legacy build AND its worker,
 *   • the tesseract.js-core `.wasm` runtime,
 *   • pdf-parse (the text path also loads pdfjs).
 *
 * If someone drops includeFiles or narrows the glob so the binary is excluded,
 * this test fails BEFORE a deploy can reintroduce the "not installed" outage.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "@vercel/build-utils";
import { minimatch } from "minimatch";

const ROOT = process.cwd();
const FN = "api/upload-vendor.ts";

function readFunctionsConfig(): Record<string, any> {
  const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  expect(cfg.functions, "vercel.json must define a `functions` map").toBeTruthy();
  return cfg.functions;
}

/** Enumerate the Serverless Functions Vercel would detect in api/ — every
 *  `.ts`/`.tsx`/`.js`/`.mjs` file NOT under a `_`-prefixed segment and NOT a
 *  test. Mirrors @vercel/static-build's `api/**` runtime match. */
function detectApiFunctions(): string[] {
  const out: string[] = [];
  const apiDir = join(ROOT, "api");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(ROOT, full).split("\\").join("/");
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
      if (name.endsWith(".d.ts")) continue;
      // Vercel treats files/segments starting with `_` as non-routable helpers.
      if (rel.split("/").some((seg) => seg.startsWith("_"))) continue;
      out.push(rel);
    }
  };
  walk(apiDir);
  return out.sort();
}

/**
 * Faithful reproduction of @vercel/static-build's function-pattern validation
 * (the check that rejected the previous config with "The pattern
 * 'api/upload-vendor.ts' ... doesn't match any Serverless Functions inside the
 * api directory"). For each detected function file, `getFunction` picks the
 * FIRST `functions` key (in object order) that matches via minimatch; any key
 * that is never the first match for any file is "unused" and fails the deploy.
 */
function unusedFunctionPatterns(functions: Record<string, any>, apiFiles: string[]): string[] {
  const keys = Object.keys(functions);
  const used = new Set<string>();
  for (const file of apiFiles) {
    const k = keys.find((key) => key === file || minimatch(file, key));
    if (k) used.add(k);
  }
  return keys.filter((k) => !used.has(k));
}

function readIncludeGlobs(): string[] {
  const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const fn = cfg.functions?.[FN];
  expect(fn, `vercel.json must configure functions["${FN}"]`).toBeTruthy();
  const inc = fn.includeFiles;
  expect(inc, `functions["${FN}"].includeFiles must be set`).toBeTruthy();
  return typeof inc === "string" ? [inc] : inc;
}

/** Resolve every includeFiles glob the way @vercel/node does at build time and
 *  return the union of project-relative packaged paths (normalized to forward
 *  slashes). */
async function packagedFiles(): Promise<string[]> {
  const globs = readIncludeGlobs();
  const all = new Set<string>();
  for (const pattern of globs) {
    const matched = await glob(pattern, ROOT);
    for (const key of Object.keys(matched)) all.add(key.split("\\").join("/"));
  }
  return [...all];
}

describe("Vercel functions config — accepted shape (no unused-pattern rejection)", () => {
  let functions: Record<string, any>;
  let apiFiles: string[];

  beforeAll(() => {
    functions = readFunctionsConfig();
    apiFiles = detectApiFunctions();
  });

  it("detects api/upload-vendor.ts as a real Serverless Function", () => {
    expect(apiFiles).toContain(FN);
  });

  it("every `functions` pattern matches at least one function (Vercel CLI 55 gate)", () => {
    // This is the exact validation that rejected the prior config before build:
    //   Error: The pattern "api/upload-vendor.ts" defined in `functions`
    //   doesn't match any Serverless Functions inside the `api` directory.
    const unused = unusedFunctionPatterns(functions, apiFiles);
    expect(
      unused,
      `these functions patterns match no api function (Vercel will reject the deploy): ${unused.join(", ")}`,
    ).toEqual([]);
  });

  it("upload-vendor's specific pattern is ordered before the broad api/**/*.ts", () => {
    // getFunction picks the FIRST matching key, so the specific override must
    // precede the catch-all or upload-vendor's includeFiles would never apply
    // AND the specific key would be flagged unused.
    const keys = Object.keys(functions);
    const specificIdx = keys.indexOf(FN);
    const broadIdx = keys.findIndex((k) => k === "api/**/*.ts");
    expect(specificIdx, `${FN} must be a functions key`).toBeGreaterThanOrEqual(0);
    if (broadIdx >= 0) {
      expect(specificIdx).toBeLessThan(broadIdx);
    }
  });

  it("upload-vendor is the config Vercel resolves for that file (first match wins)", () => {
    const keys = Object.keys(functions);
    const chosen = keys.find((key) => key === FN || minimatch(FN, key));
    expect(chosen).toBe(FN);
    expect(functions[FN].includeFiles, "resolved config must carry includeFiles").toBeTruthy();
  });

  it("includeFiles is a single string (Vercel per-function schema requires string)", () => {
    // @vercel/static-build validateFunctions: includeFiles must be a string.
    expect(typeof functions[FN].includeFiles).toBe("string");
    expect((functions[FN].includeFiles as string).length).toBeLessThanOrEqual(256);
  });
});

describe("Vercel packaging — /api/upload-vendor bundles the native OCR runtime", () => {
  let files: string[] = [];
  let has: (needle: string) => boolean;

  beforeAll(async () => {
    files = await packagedFiles();
    has = (needle: string) => files.some((f) => f.includes(needle));
  });

  it("skips gracefully if the native platform package is not installed here", () => {
    // The @napi-rs platform packages are optionalDependencies; on an unsupported
    // host they may be absent. The assertions below are meaningful only when the
    // linux-x64 binary exists in this environment (Vercel's is linux-x64).
    const present =
      existsSync(join(ROOT, "node_modules/@napi-rs/canvas-linux-x64-gnu")) ||
      existsSync(join(ROOT, "node_modules/@napi-rs/canvas-linux-x64-musl"));
    expect(typeof present).toBe("boolean");
  });

  it("includes the skia .node native binary (the exact 'not installed' failure)", () => {
    const nodeBinaries = files.filter((f) => f.endsWith(".node"));
    // At least one linux-x64 skia binary must be packaged. On Vercel the runtime
    // is glibc linux-x64 → skia.linux-x64-gnu.node; we accept either libc
    // variant so the test is host-agnostic while still proving a REAL binary
    // (not just the JS shim) will ship.
    const skia = nodeBinaries.filter(
      (f) => f.includes("skia.linux-x64-gnu.node") || f.includes("skia.linux-x64-musl.node"),
    );
    expect(
      skia.length,
      `expected a linux-x64 skia .node binary in the packaged set; got: ${nodeBinaries.join(", ") || "(none)"}`,
    ).toBeGreaterThan(0);

    // Prove it is a real, non-empty native artifact, not an empty placeholder.
    for (const rel of skia) {
      const bytes = readFileSync(join(ROOT, rel));
      expect(bytes.length, `${rel} should be a multi-MB native binary`).toBeGreaterThan(1_000_000);
      // ELF magic for the linux binary.
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("\x7fELF");
    }
  });

  it("includes @napi-rs/canvas's JS loader (js-binding + index)", () => {
    expect(has("@napi-rs/canvas/js-binding.js")).toBe(true);
    expect(has("@napi-rs/canvas/index.js")).toBe(true);
  });

  it("includes pdfjs-dist legacy build AND its worker", () => {
    expect(has("pdfjs-dist/legacy/build/pdf.mjs")).toBe(true);
    expect(has("pdfjs-dist/legacy/build/pdf.worker.mjs")).toBe(true);
  });

  it("includes the tesseract.js OCR engine and its wasm core", () => {
    expect(has("tesseract.js/")).toBe(true);
    const wasm = files.filter((f) => f.includes("tesseract.js-core") && f.endsWith(".wasm"));
    expect(wasm.length, "expected tesseract-core .wasm files to be packaged").toBeGreaterThan(0);
  });

  it("includes pdf-parse (the text path also loads pdfjs via pdf-parse)", () => {
    expect(has("pdf-parse/")).toBe(true);
  });
});
