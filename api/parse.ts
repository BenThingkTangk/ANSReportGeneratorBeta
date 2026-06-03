import type { VercelRequest, VercelResponse } from "@vercel/node";

// DIAGNOSTIC MINIMAL SHELL — no parser imports.
// Goal: determine whether /api/parse's 500 is caused by parser/scoring imports
// or by the function shell itself (vercel.json, runtime, bundler).

function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    ok: true,
    diagnostic: "minimal-shell-v1",
    node: process.version,
    method: req.method,
    contentType: req.headers["content-type"] ?? null,
  });
}
