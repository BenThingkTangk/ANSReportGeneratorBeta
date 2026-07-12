# PWA, Installability & Packaging

The HumanOS ANS client is an installable Progressive Web App with a PHI-safe
offline shell.

## What's included
- **`client/public/manifest.webmanifest`** — `display: standalone`, app name,
  theme/background colors, and 192/512 icons (incl. a maskable icon). Linked
  from `client/index.html`.
- **`client/public/sw.js`** — a service worker that caches **only** the static
  app shell (HTML/JS/CSS/icons). It **never** intercepts `/api/*` or
  cross-origin requests, so patient data (reports, uploads, Ask ATOM answers,
  TTS audio) is never written to Cache Storage.
- **`client/src/lib/registerSW.ts`** — registers the worker after load, only in
  the built app (skipped in the Vite dev server).
- **Viewport** — `viewport-fit=cover` so `env(safe-area-inset-*)` resolves on
  notched devices; the report/chat already honor safe-area insets.

## Offline behavior (by design)
- Offline, the app **boots** to the upload screen from the cached shell.
- Any action needing the network (parse, report, chat, voice) fails through the
  app's existing error states rather than serving stale clinical data. This is
  intentional for a PHI app: **no** patient-derived response is ever cached.

## Installing
- **Desktop Chrome/Edge:** open the app → install icon in the address bar →
  "Install".
- **iOS Safari:** Share → "Add to Home Screen".
- **Android Chrome:** ⋮ menu → "Install app" / "Add to Home screen".

Once installed it launches standalone (no browser chrome), using the manifest
name, icon, and theme color.

## Verifying installability
1. Build: `npm run build` (emits `dist/public/` including `manifest.webmanifest`
   and `sw.js` at the web root).
2. Serve the built client and open DevTools → Application:
   - **Manifest**: name, icons, `display: standalone` present.
   - **Service Workers**: `sw.js` activated.
3. Lighthouse → PWA category should report installable.

## Packaging notes
This is a standard static client + Vercel serverless API. To package:
- **Web/PWA:** deploy `dist/public` behind the API (already the production
  shape). The manifest + SW make it installable with no extra tooling.
- **Store wrappers (optional):** wrap the deployed URL with
  [PWABuilder](https://www.pwabuilder.com/) (TWA for Android, packaged app for
  Windows) or Capacitor. The manifest here satisfies their icon/name/display
  requirements. No secrets ship in the client — ElevenLabs/Perplexity keys stay
  server-side.
