# Admin Gateway — Secure Activation (username/password)

The admin console uses **two independent layers**:

1. **Perimeter gateway (username + password)** — an env-configured, scrypt-hashed
   credential that mints a signed, HttpOnly session cookie. This is the
   **primary** admin sign-in factor when configured.
2. **Supabase magic link** — the identity/RLS layer. It remains as an **optional
   secondary fallback**; it is never a replacement for the gateway when the
   gateway is configured.

If the gateway env vars are **absent**, the login page now shows an explicit
*"Username/password gateway not configured"* diagnostic (rather than silently
presenting magic-link as if the feature did not exist), with the exact variables
to set.

## Required Vercel environment variables

Set these on the Vercel **Project → Settings → Environment Variables** (scope:
Production, and Preview if you want it on preview deploys). All three are
**required** to activate the gateway — setting only some keeps it inactive.

| Variable | Purpose | Example / format |
|----------|---------|------------------|
| `ADMIN_GATEWAY_USERNAME` | The admin username | `admin` |
| `ADMIN_GATEWAY_PASSWORD_HASH` | scrypt hash of the password (never the plaintext) | `scrypt$16384$8$1$<saltB64>$<hashB64>` |
| `ADMIN_SESSION_SECRET` | HMAC key that signs the session cookie | `openssl rand -base64 48` |

Optional tuning (sensible defaults if unset):

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADMIN_SESSION_TTL_SEC` | `28800` (8h) | Session cookie lifetime |
| `ADMIN_GATEWAY_MAX_ATTEMPTS` | `5` | Failed attempts per window before lockout |
| `ADMIN_GATEWAY_WINDOW_SEC` | `900` (15m) | Sliding window for counting failures |
| `ADMIN_GATEWAY_LOCKOUT_SEC` | `900` (15m) | Lockout duration once tripped |

**All `ADMIN_GATEWAY_*` / `ADMIN_SESSION_*` variables are server-only.** Never
expose them as `VITE_`-prefixed variables — that would ship them to the browser.

## Generating the password hash

The plaintext password must never be committed or stored in env. Generate the
scrypt hash locally and paste only the hash:

```bash
# from the repo root
node hash-admin-password.mjs        # prompts for the password, prints the scrypt$… hash
```

Copy the printed `scrypt$…` value into `ADMIN_GATEWAY_PASSWORD_HASH`.

## Secure activation steps

1. Generate the hash (above).
2. In Vercel, add `ADMIN_GATEWAY_USERNAME`, `ADMIN_GATEWAY_PASSWORD_HASH`, and
   `ADMIN_SESSION_SECRET` (Production scope).
3. Redeploy so the new env is picked up by the serverless functions.
4. Visit `/#/admin/login`:
   - **Configured** → the page first requests the gateway username/password,
     then (optionally) the magic-link identity step.
   - **Not configured** → the page shows the yellow *"gateway not configured"*
     diagnostic and falls back to magic-link only.
5. Verify: `GET /api/admin/gateway` returns `{ "configured": true }`.

## Rotation

To rotate the password, regenerate the hash and update
`ADMIN_GATEWAY_PASSWORD_HASH`, then redeploy. To invalidate all existing
sessions, rotate `ADMIN_SESSION_SECRET` (every current cookie becomes invalid).

## Why defense-in-depth

The gateway sits **in front of** Supabase auth + Row-Level Security. Clearing the
gateway does not grant data access on its own — every admin API still enforces
the RLS-backed role via `requireRole()`. The gateway simply ensures the console
is not even reachable without the shared credential.
