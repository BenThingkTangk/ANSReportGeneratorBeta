#!/usr/bin/env node
/**
 * OCR native-dependency build guard.
 *
 * The /api/upload-vendor OCR path needs @napi-rs/canvas's native skia `.node`
 * binary at runtime. Because we import it through a bundler-opaque indirection
 * (so esbuild never inlines the `.node` file), @vercel/nft cannot trace it
 * either — so we force-include it via vercel.json `includeFiles`. But
 * `includeFiles` globs are resolved at BUILD time: if the platform binary is
 * absent when the function is packaged, it is SILENTLY skipped, and the live
 * endpoint regresses to "@napi-rs/canvas not installed" (the exact outage this
 * guards against).
 *
 * This script fails the build LOUDLY if, on a Linux x64 builder (Vercel's
 * runtime family), the native binary that includeFiles expects is missing. On
 * other platforms (e.g. a mac dev machine) it warns but does not fail, so local
 * builds still work.
 *
 * Wired into `prebuild:vercel` so it runs on every Vercel deploy.
 */
import { existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const NM = join(REPO_ROOT, "node_modules");

// The linux-x64 skia binaries includeFiles will package. Vercel's Node runtime
// is glibc linux-x64 → the -gnu variant; we accept either libc build.
const LINUX_X64_BINARIES = [
  "@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node",
  "@napi-rs/canvas-linux-x64-musl/skia.linux-x64-musl.node",
];

const MIN_BYTES = 1_000_000; // a real skia binary is tens of MB; guard against a stub.

function found(rel) {
  const p = join(NM, rel);
  if (!existsSync(p)) return null;
  const size = statSync(p).size;
  return size >= MIN_BYTES ? { rel, size } : null;
}

const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
const hits = LINUX_X64_BINARIES.map(found).filter(Boolean);

if (hits.length > 0) {
  for (const h of hits) {
    console.log(`✓ OCR native binary present: ${h.rel} (${(h.size / 1_048_576).toFixed(1)} MB)`);
  }
  process.exit(0);
}

// Also make sure the JS loader package itself is installed.
const loaderPresent = existsSync(join(NM, "@napi-rs/canvas/index.js"));

if (isLinuxX64) {
  console.error(
    "✗ OCR native dependency missing on a linux-x64 builder.\n" +
      `  Expected one of:\n` +
      LINUX_X64_BINARIES.map((b) => `    node_modules/${b}`).join("\n") +
      "\n  Without it, vercel.json includeFiles packages nothing and " +
      "/api/upload-vendor will report '@napi-rs/canvas not installed' at runtime.\n" +
      (loaderPresent
        ? "  The @napi-rs/canvas JS loader is present but the platform binary is not — " +
          "ensure optionalDependencies are installed (do NOT pass --omit=optional / --no-optional)."
        : "  @napi-rs/canvas is not installed at all — check dependencies/optionalDependencies."),
  );
  process.exit(1);
}

// Non-Linux-x64 (e.g. local mac/arm dev): warn only.
console.warn(
  `⚠ OCR native linux-x64 binary not found on this ${process.platform}/${process.arch} host. ` +
    "This is expected off-Vercel; the Vercel builder (linux-x64) must have it. Skipping hard check.",
);
process.exit(0);
