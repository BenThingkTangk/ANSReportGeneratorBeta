// Faithful E2E host: serves the built client bundle AND mounts the REAL
// api/*.ts Vercel handlers (the production code path — parse.ts, upload.ts,
// ask-atom.ts, etc.), which the legacy server/routes.ts does not expose.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DIST = process.env.E2E_DIST || "/tmp/dist/public";
const PORT = parseInt(process.env.E2E_PORT || "8090", 10);

const app = express();

// Mount each Vercel function at /api/<name>. The handlers read the raw request
// stream themselves (multipart), so do NOT install body parsers before them.
const routes = {
  "/api/parse": "../api/parse.ts",
  "/api/upload": "../api/upload.ts",
  "/api/ask-atom": "../api/ask-atom.ts",
  "/api/explanations": "../api/explanations.ts",
  "/api/synopsis": "../api/synopsis.ts",
  "/api/health": "../api/health.ts",
};
for (const [route, mod] of Object.entries(routes)) {
  const handler = (await import(mod)).default;
  app.all(route, (req, res) => Promise.resolve(handler(req, res)).catch((e) => {
    console.error(`handler ${route} threw`, e);
    if (!res.headersSent) res.status(500).json({ error: String(e?.message || e) });
  }));
}

// Static client + SPA fallback.
app.use(express.static(DIST));
app.use("/{*path}", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`e2e host on ${PORT} (dist=${DIST})`));
