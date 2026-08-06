import type { VercelRequest, VercelResponse } from "@vercel/node";
import { configReport } from "./_ans/dbConfig.js";

/**
 * /api/health — enriched deploy + runtime info.
 *
 * Vercel exposes a number of system env vars at runtime that let us pin
 * down EXACTLY which build, region, and commit is serving the request.
 * If anything looks stale in the field, hit this endpoint first.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS for cross-origin smoke testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.json({
    status: "ok",
    version: "1.0.0",
    deploy: {
      // Set by Vercel automatically
      commitSha:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA ??
        null,
      commitShortSha:
        (process.env.VERCEL_GIT_COMMIT_SHA ??
          process.env.GIT_COMMIT_SHA ??
          "")
          .slice(0, 7) || null,
      commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      env: process.env.VERCEL_ENV ?? "local",
      region: process.env.VERCEL_REGION ?? null,
      // Set at build time via vite define / inline (fallback to runtime now)
      buildTime: process.env.BUILD_TIME ?? null,
      deploymentUrl: process.env.VERCEL_URL ?? null,
    },
    // Configuration diagnostics. PRESENCE ONLY — no key, no key fragment, no
    // value is ever returned here. `database.projectRef` is the public project
    // ref parsed from SUPABASE_URL, so a stale/dead project ref is immediately
    // visible in the field instead of surfacing as an opaque 500.
    config: configReport(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      now: new Date().toISOString(),
    },
    // Echo so caller can verify they hit the function shell (cold-start ok)
    request: {
      method: req.method,
      requestId: (req.headers["x-vercel-id"] as string | undefined) ?? null,
    },
  });
}
