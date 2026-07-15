/**
 * Runtime-resolution regression for the DEPLOYED Vercel function layout.
 *
 * Iteration-3 shipped canvas/pdfjs (rasterization worked live) but OCR still
 * failed with "tesseract.js not installed": the includeFiles glob packaged
 * tesseract.js itself but NONE of its transitive runtime deps (node-fetch,
 * bmp-js, is-url, whatwg-url, tr46, webidl-conversions, is-electron,
 * wasm-feature-detect, regenerator-runtime). At runtime `require("tesseract.js")`
 * -> `require("node-fetch")` threw MODULE_NOT_FOUND, and makeOcrWorker's catch
 * reported the engine as unavailable.
 *
 * Why canvas/pdfjs worked but tesseract didn't: @napi-rs/canvas (native binary +
 * pure JS) and pdfjs-dist are self-contained, but tesseract.js pulls a real
 * transitive dependency tree that must ALSO be packaged.
 *
 * These tests reproduce the failure class WITHOUT node_modules-root leniency:
 *   1. Compute the REAL runtime closure of the OCR deps with @vercel/nft
 *      (the exact tracer @vercel/node uses) and assert every package in it is
 *      covered by the includeFiles glob in vercel.json. This catches dependency
 *      drift automatically — a new tesseract/pdfjs dep that isn't included fails
 *      the test before it can break a deploy.
 *   2. Materialize a minimal "deployed function" layout (a temp dir containing
 *      ONLY the files includeFiles would package, under node_modules/) and prove
 *      that `require("tesseract.js")` and its node worker script resolve there —
 *      i.e. from the function's own working directory, not the dev node_modules
 *      root.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { nodeFileTrace } from "@vercel/nft";
import { glob } from "@vercel/build-utils";

const ROOT = process.cwd();
const FN = "api/upload-vendor.ts";

/** The bare specifiers the OCR path imports at runtime (see ocr.ts / pdfText.ts). */
const OCR_ENTRY_SPECIFIERS = [
  "tesseract.js",
  "tesseract.js/src/worker-script/node/index.js",
  "pdfjs-dist/legacy/build/pdf.mjs",
  "@napi-rs/canvas",
  "pdf-parse",
];

function includeGlob(): string {
  const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const inc = cfg.functions?.[FN]?.includeFiles;
  expect(inc, `functions["${FN}"].includeFiles must be set`).toBeTruthy();
  return inc as string;
}

/** Top-level package name from a node_modules-relative path. */
function pkgOf(file: string): string | null {
  const m = file.match(/^node_modules\/((@[^/]+\/[^/]+)|([^/]+))/);
  return m ? m[1] : null;
}

/** Compute the real runtime package closure of the OCR entrypoints via nft. */
async function ocrRuntimePackages(): Promise<Set<string>> {
  // A CJS entry that requires each runtime specifier, so nft walks the real
  // dependency graph exactly as Node would at runtime in the function.
  const entryRel = "_ocr_runtime_probe.cjs";
  const entryAbs = join(ROOT, entryRel);
  const lines = OCR_ENTRY_SPECIFIERS.map((s) => `try{require(${JSON.stringify(s)})}catch(e){}`);
  writeFileSync(entryAbs, lines.join("\n"));
  try {
    const { fileList } = await nodeFileTrace([entryRel], { base: ROOT, ts: false });
    const pkgs = new Set<string>();
    for (const f of fileList) {
      const norm = f.split("\\").join("/");
      if (!norm.startsWith("node_modules/")) continue;
      const p = pkgOf(norm);
      if (p) pkgs.add(p);
    }
    return pkgs;
  } finally {
    try {
      rmSync(entryAbs, { force: true });
    } catch {
      /* ignore */
    }
  }
}

describe("Vercel OCR runtime resolution — full dependency closure is packaged", () => {
  let packagedFiles: string[] = [];
  let packagedPkgs: Set<string>;
  let closure: Set<string>;

  beforeAll(async () => {
    packagedFiles = Object.keys(await glob(includeGlob(), ROOT)).map((f) => f.split("\\").join("/"));
    packagedPkgs = new Set<string>();
    for (const f of packagedFiles) {
      const p = pkgOf(f);
      if (p) packagedPkgs.add(p);
    }
    closure = await ocrRuntimePackages();
  }, 120_000);

  it("nft finds a non-trivial OCR runtime closure (sanity)", () => {
    expect(closure.has("tesseract.js")).toBe(true);
    // tesseract's transitive deps must be present in the closure nft computed.
    expect(closure.has("node-fetch")).toBe(true);
  });

  it("every package in the OCR runtime closure is covered by includeFiles", () => {
    const missing = [...closure].filter((p) => !packagedPkgs.has(p));
    expect(
      missing,
      `includeFiles omits OCR runtime deps that will MODULE_NOT_FOUND at runtime: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("packages tesseract.js AND its known transitive runtime deps explicitly", () => {
    // Lock the specific deps whose absence caused the live "tesseract.js not
    // installed" failure, so a glob edit that drops them fails loudly.
    for (const dep of [
      "tesseract.js",
      "tesseract.js-core",
      "node-fetch",
      "bmp-js",
      "is-url",
      "whatwg-url",
      "tr46",
      "webidl-conversions",
      "is-electron",
      "wasm-feature-detect",
      "regenerator-runtime",
    ]) {
      expect(packagedPkgs.has(dep), `includeFiles must package ${dep}`).toBe(true);
    }
  });

  it("packages the tesseract-core wasm the worker loads at runtime", () => {
    const wasm = packagedFiles.filter((f) => f.includes("tesseract.js-core") && f.endsWith(".wasm"));
    expect(wasm.length, "tesseract-core .wasm must be packaged").toBeGreaterThan(0);
  });
});

describe("Vercel OCR runtime resolution — resolves from the deployed function layout", () => {
  let fnDir: string;
  let requireFromFn: NodeRequire;

  beforeAll(async () => {
    // Materialize a minimal "deployed function" directory that contains ONLY the
    // files includeFiles would package (under node_modules/), NOT the full dev
    // node_modules. This is the crux: prove resolution works from the function's
    // own tree, not the repo root.
    const packagedForCopy = Object.keys(await glob(includeGlob(), ROOT)).map((f) =>
      f.split("\\").join("/"),
    );
    fnDir = mkdtempSync(join(tmpdir(), "vercel-fn-"));
    for (const rel of packagedForCopy) {
      const src = join(ROOT, rel);
      if (!existsSync(src)) continue;
      const dest = join(fnDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
    // A minimal package.json so Node treats fnDir as the resolution root.
    writeFileSync(join(fnDir, "package.json"), JSON.stringify({ name: "fn", version: "1.0.0" }));
    // Anchor a require on a file INSIDE the function dir.
    requireFromFn = createRequire(join(fnDir, "index.cjs"));
  }, 180_000);

  it("resolves require('tesseract.js') from the function node_modules", () => {
    const resolved = requireFromFn.resolve("tesseract.js");
    expect(resolved.startsWith(fnDir), `expected ${resolved} under ${fnDir}`).toBe(true);
  });

  it("resolves the tesseract node worker script from the function node_modules", () => {
    const resolved = requireFromFn.resolve("tesseract.js/src/worker-script/node/index.js");
    expect(resolved.startsWith(fnDir)).toBe(true);
  });

  it("resolves tesseract's transitive deps (node-fetch, whatwg-url) from the function", () => {
    // These are what threw MODULE_NOT_FOUND live. Resolving them proves the
    // transitive closure is present in the function layout.
    expect(requireFromFn.resolve("node-fetch").startsWith(fnDir)).toBe(true);
    expect(requireFromFn.resolve("whatwg-url").startsWith(fnDir)).toBe(true);
  });

  it("actually loads tesseract.js and exposes createWorker from the function layout", () => {
    // The real failure was an import throw; loading the module here proves the
    // require graph is satisfiable from the packaged files alone.
    const tess = requireFromFn("tesseract.js");
    const createWorker = tess.createWorker ?? tess.default?.createWorker;
    expect(typeof createWorker).toBe("function");
  });
});
