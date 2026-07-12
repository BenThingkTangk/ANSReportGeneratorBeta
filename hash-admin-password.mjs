#!/usr/bin/env node
/**
 * hash-admin-password.mjs   (repo root — dev-only utility, not part of build/deploy)
 *
 * Generate a scrypt password hash for the admin perimeter gateway
 * (ADMIN_GATEWAY_PASSWORD_HASH). The plaintext password is NEVER written to
 * disk, echoed, or hardcoded — only the resulting hash is printed. Keep the
 * scrypt parameters and output format in sync with api/_adminGateway.ts
 * (hashPassword / verifyPassword):
 *
 *     scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * Lives at the repo root because scripts/ is read-only in this environment. It
 * is a local operator tool only — nothing imports it and it is never deployed.
 *
 * Usage:
 *   node hash-admin-password.mjs                 # interactive (hidden) prompt
 *   printf '%s' 'my-password' | node hash-admin-password.mjs   # piped / CI
 *   node hash-admin-password.mjs --stdin         # force reading from stdin
 *   node hash-admin-password.mjs --help
 *
 * Then paste the printed value into your environment (Vercel project settings or
 * .env.local):
 *   ADMIN_GATEWAY_PASSWORD_HASH=scrypt$16384$8$1$...$...
 */
import { scryptSync, randomBytes } from "node:crypto";
import readline from "node:readline";

// scrypt parameters — MUST match api/_adminGateway.ts hashPassword() defaults.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024; // 64 MB
const MIN_RECOMMENDED_LEN = 12;

function printHelp() {
  process.stdout.write(
    [
      "Generate a scrypt hash for ADMIN_GATEWAY_PASSWORD_HASH.",
      "",
      "Usage:",
      "  node hash-admin-password.mjs           interactive hidden prompt",
      "  printf '%s' 'pw' | node hash-admin-password.mjs   read from stdin",
      "  node hash-admin-password.mjs --stdin   force reading from stdin",
      "  node hash-admin-password.mjs --help",
      "",
      "The plaintext is never stored, echoed, or hardcoded — only the hash is printed.",
      "",
    ].join("\n")
  );
}

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Read a whole stream to a string (used for piped / non-TTY input). */
function readStream(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

/** Interactive prompt that does not echo the typed characters. */
function questionHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    let promptShown = false;
    // Override the internal writer: show the prompt once, mask everything typed.
    rl._writeToOutput = (str) => {
      if (!promptShown && str.includes(query)) {
        rl.output.write(query);
        promptShown = true;
      }
      // Swallow all subsequent output (typed chars, echoes).
    };
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function getPassword() {
  const args = process.argv.slice(2);
  const forceStdin = args.includes("--stdin");

  // Non-interactive input (piped) or explicit --stdin: read the raw stream.
  if (forceStdin || !process.stdin.isTTY) {
    const raw = await readStream(process.stdin);
    // Strip a single trailing newline (from echo/printf), keep any other chars.
    return raw.replace(/\r?\n$/, "");
  }

  // Interactive: prompt twice and confirm.
  const first = await questionHidden("Admin gateway password: ");
  const second = await questionHidden("Confirm password: ");
  if (first !== second) {
    process.stderr.write("Passwords do not match. Aborting.\n");
    process.exit(1);
  }
  return first;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const password = await getPassword();

  if (!password) {
    process.stderr.write("Empty password. Aborting.\n");
    process.exit(1);
  }
  if (password.length < MIN_RECOMMENDED_LEN) {
    process.stderr.write(
      `Warning: password is shorter than ${MIN_RECOMMENDED_LEN} characters. Consider a longer passphrase.\n`
    );
  }

  const hash = hashPassword(password);

  // Print ONLY the hash artefacts — never the plaintext.
  process.stdout.write("\nAdd this to your environment (never commit the plaintext):\n\n");
  process.stdout.write(`ADMIN_GATEWAY_PASSWORD_HASH=${hash}\n\n`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
