#!/usr/bin/env node
/**
 * Cold-start smoke test for every /api/* function on a Vercel deployment.
 *
 * Hits each endpoint with an OPTIONS preflight (cheap, idempotent, doesn't
 * require auth or a body). Any 5xx response means the function CRASHED at
 * module load — typically because of a bad import (the FUNCTION_INVOCATION_FAILED
 * class of bug). 401/403 (SSO/auth) and 405 (method not allowed) are fine — they
 * prove the handler loaded.
 *
 * Usage:
 *   node scripts/coldstart-smoke.mjs https://humanos-ans-diagnostic.vercel.app
 *   node scripts/coldstart-smoke.mjs https://...vercel.app --cookie "_vercel_sso_nonce=..."
 *
 * Exit code:
 *   0 if every endpoint loaded successfully (any non-5xx response)
 *   1 if any endpoint returned 5xx (cold-start crash)
 */

import { readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/coldstart-smoke.mjs <baseUrl> [--cookie '<cookie>']");
  process.exit(2);
}

const cookieIdx = process.argv.indexOf("--cookie");
const cookie = cookieIdx > 0 ? process.argv[cookieIdx + 1] : null;

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const API_DIR = join(REPO_ROOT, "api");

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      yield* walk(full);
    } else if (extname(e.name) === ".ts" && !e.name.startsWith("_")) {
      // Top-level files starting with _ are helpers (e.g. _supabase.ts). Skip
      // any path component starting with _.
      const rel = relative(API_DIR, full);
      if (rel.split("/").some(seg => seg.startsWith("_"))) continue;
      yield rel;
    }
  }
}

function relToRoute(rel) {
  // api/foo/bar.ts -> /api/foo/bar
  // api/foo/[id].ts -> /api/foo/test-id (substitute literal for dynamic seg)
  const noExt = rel.replace(/\.ts$/, "");
  return "/api/" + noExt.split("/").map(seg =>
    seg.startsWith("[") && seg.endsWith("]") ? "smoke-test-id" : seg
  ).join("/");
}

const headers = {
  "Origin": "https://smoke-test.invalid",
  "Access-Control-Request-Method": "POST",
};
if (cookie) headers["Cookie"] = cookie;

const results = [];
const routes = [];
for await (const rel of walk(API_DIR)) routes.push(relToRoute(rel));
routes.sort();

console.log(`Probing ${routes.length} endpoint(s) at ${baseUrl}\n`);

await Promise.all(routes.map(async route => {
  const url = baseUrl.replace(/\/$/, "") + route;
  try {
    const res = await fetch(url, { method: "OPTIONS", headers, redirect: "manual" });
    const isCrash = res.status >= 500 && res.status < 600;
    results.push({ route, status: res.status, crash: isCrash });
  } catch (err) {
    results.push({ route, status: 0, crash: true, err: String(err) });
  }
}));

results.sort((a, b) => a.route.localeCompare(b.route));

const crashes = results.filter(r => r.crash);
for (const r of results) {
  const marker = r.crash ? "✗" : "✓";
  const tag = r.crash ? `CRASH (${r.status})` : `${r.status}`;
  console.log(`  ${marker} ${r.route.padEnd(50)} ${tag}${r.err ? " " + r.err : ""}`);
}

console.log();
if (crashes.length === 0) {
  console.log(`✓ All ${results.length} endpoints loaded without 5xx`);
  process.exit(0);
} else {
  console.log(`✗ ${crashes.length}/${results.length} endpoints CRASHED at cold-start`);
  for (const c of crashes) {
    console.log(`    ${c.route} → ${c.status}${c.err ? " " + c.err : ""}`);
  }
  process.exit(1);
}
