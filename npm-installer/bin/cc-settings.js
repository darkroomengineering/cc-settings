#!/usr/bin/env node
// cc-settings npm installer stub — `npx cc-settings` / `bunx cc-settings`.
//
// This package deliberately contains NO configuration. It downloads the
// official bootstrap script over HTTPS and runs it, so the trust root stays
// where it already is: the bootstrap's own origin-pinned clone of
// github.com/darkroomengineering/cc-settings main. A compromised npm token
// cannot swap the installed payload — only this ~100-line downloader, which
// is why the stub stays tiny and rarely republished.
//
// Flags are forwarded verbatim: `npx cc-settings --light --auto-update=on`.
// CC_SETTINGS_INSTALL_BASE overrides the download origin (tests only).

const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const BASE =
  process.env.CC_SETTINGS_INSTALL_BASE ||
  "https://raw.githubusercontent.com/darkroomengineering/cc-settings/main";

async function main() {
  const windows = process.platform === "win32";
  const scriptName = windows ? "setup.ps1" : "setup.sh";
  const url = `${BASE}/${scriptName}`;

  if (typeof fetch !== "function") {
    console.error("ERROR: this installer needs Node 18 or newer (global fetch).");
    process.exit(1);
  }

  let body;
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    body = await response.text();
  } catch (error) {
    console.error(`ERROR: could not download the cc-settings bootstrap: ${error.message}`);
    console.error(
      `Fallback: git clone https://github.com/darkroomengineering/cc-settings.git && ${windows ? ".\\cc-settings\\setup.ps1" : "bash cc-settings/setup.sh"}`,
    );
    process.exit(1);
  }

  // Write the bootstrap to a temp dir and run it as a lone script file. Both
  // bootstraps detect "no checkout next to me" and clone the official repo
  // with its origin pin before installing — the downloaded bytes never
  // install anything themselves.
  const dir = mkdtempSync(join(tmpdir(), "cc-settings-npx-"));
  const scriptPath = join(dir, scriptName);
  writeFileSync(scriptPath, body, { mode: 0o700 });

  const args = process.argv.slice(2);
  const command = windows
    ? ["powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]]
    : ["bash", [scriptPath, ...args]];

  let result;
  try {
    result = spawnSync(command[0], command[1], { stdio: "inherit" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (result.error) {
    const missing = result.error.code === "ENOENT";
    console.error(
      missing
        ? `ERROR: ${command[0]} is required to run the installer and was not found on PATH.`
        : `ERROR: installer failed to start: ${result.error.message}`,
    );
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
