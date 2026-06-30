#!/usr/bin/env bun
// SessionStart hook: verify that the cc-settings install hasn't been tampered
// with since setup.sh last ran. Two independent checks:
//
//   1. Hooks-block fingerprint — SHA256 of the hooks section of
//      ~/.claude/settings.json vs the fingerprint written by setup.ts.
//      Catches injected hook ENTRIES (the Shai-Hulud worm pattern, May 2026).
//   2. Installed-src content manifest — SHA256 of every ~/.claude/src/**/*.ts
//      vs the manifest written by setup.ts. Catches dropped or patched script
//      CONTENT, which never touches settings.json and so never trips check 1.
//
// Fail-open: any read/parse failure → silent success. We never block session
// start. The only printed output is a loud warning on confirmed mismatch.

import { auditSettingsFile, hasSuspicious } from "../lib/audit-hooks.ts";
import { resolveEngine, verifyPinnedEngine } from "../lib/code-intel-engine.ts";
import { verifyAgainstSettings, verifySrcManifest } from "../lib/hooks-fingerprint.ts";

const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

async function checkHooksFingerprint(): Promise<void> {
  const verify = await verifyAgainstSettings();
  if (verify.status === "match" || verify.status === "missing-settings") return;

  // No fingerprint = fresh install or pre-fingerprint cc-settings version.
  // Print a one-line nudge, no alarm.
  if (verify.status === "missing-fingerprint") {
    console.log(
      "ℹ cc-settings: no hooks fingerprint yet — run setup.sh to enable supply-chain integrity check.",
    );
    return;
  }

  // Mismatch — the loud path. Also run the auditor inline so the user sees
  // suspicious findings on the same screen, no second command needed.
  const audit = await auditSettingsFile();
  const suspicious = hasSuspicious(audit);

  console.log("");
  console.log(RULE);
  console.log(
    `⚠  cc-settings: hooks-block fingerprint mismatch${suspicious ? " — SUSPICIOUS HOOKS DETECTED" : ""}`,
  );
  console.log(RULE);
  console.log(`   settings.json hooks have changed since install.`);
  if (verify.installedAt) console.log(`   last trusted install: ${verify.installedAt}`);
  if (suspicious) {
    console.log("");
    console.log("   One or more hooks match supply-chain malware signatures.");
    console.log("   This is the Shai-Hulud (May 2026) attack pattern: npm/PyPI");
    console.log("   packages writing SessionStart hooks into settings.json.");
  }
  console.log("");
  console.log("   Inspect with:  bun run audit:hooks");
  console.log("   If legitimate: re-run setup.sh to refresh the fingerprint.");
  console.log("   If unknown:    see SECURITY.md in cc-settings repo.");
  console.log(RULE);
  console.log("");
}

/** Bounded file list for the warning body. */
function fileList(files: string[]): string {
  const shown = files.slice(0, 8).join(", ");
  return files.length > 8 ? `${shown}, … +${files.length - 8} more` : shown;
}

async function checkSrcManifest(): Promise<void> {
  const result = await verifySrcManifest();
  // "missing" = pre-manifest install — the fingerprint check above already
  // nudges toward setup.sh on fresh installs, so stay silent here.
  if (result.status !== "mismatch") return;

  console.log("");
  console.log(RULE);
  console.log("⚠  cc-settings: installed src/ content differs from install manifest");
  console.log(RULE);
  console.log("   Scripts under ~/.claude/src have changed since the last setup.sh run.");
  if (result.changed.length > 0) {
    console.log(`   modified or removed: ${fileList(result.changed)}`);
  }
  if (result.unmanifested.length > 0) {
    console.log(`   unexpected new file(s): ${fileList(result.unmanifested)}`);
  }
  console.log("");
  console.log("   This can be supply-chain malware dropping or patching a payload");
  console.log("   in the directories the hook auditor trusts (Shai-Hulud pattern).");
  console.log("");
  console.log("   Inspect with:  bun run audit:hooks");
  console.log("   If legitimate (you edited the installed copies): re-run setup.sh");
  console.log("   to reinstall sources and refresh the manifest.");
  console.log("   If unknown:    see SECURITY.md in cc-settings repo.");
  console.log(RULE);
  console.log("");
}

// Third integrity layer: a downloaded ("rented") code-intel engine binary must
// still match the checksum it was pinned to at install. Mismatch = the binary's
// bytes changed since setup.sh — the same supply-chain swap the other two checks
// guard against, applied to the engine. "missing" (the default python/native
// engines pin nothing, or no binary installed) is silent.
async function checkEnginePin(): Promise<void> {
  const engine = await resolveEngine();
  if ((await verifyPinnedEngine(engine)) !== "mismatch") return;

  console.log("");
  console.log(RULE);
  console.log(`⚠  cc-settings: code-intel engine binary differs from its pin (${engine.id})`);
  console.log(RULE);
  console.log("   The pinned engine binary's bytes changed since the last setup.sh run.");
  console.log("");
  console.log("   This can be supply-chain malware swapping a trusted binary for a");
  console.log("   payload (Shai-Hulud pattern) — cc-settings only runs pinned,");
  console.log("   checksum-verified engine binaries.");
  console.log("");
  console.log("   If legitimate (you replaced it deliberately): re-run setup.sh to");
  console.log("   reinstall and re-pin the engine.");
  console.log("   If unknown:    see SECURITY.md in cc-settings repo.");
  console.log(RULE);
  console.log("");
}

async function main(): Promise<void> {
  // Each check is independently fail-open: a crash in one must not silence
  // the others, and none may ever block session start.
  try {
    await checkHooksFingerprint();
  } catch {
    // Fail open.
  }
  try {
    await checkSrcManifest();
  } catch {
    // Fail open.
  }
  try {
    await checkEnginePin();
  } catch {
    // Fail open.
  }
}

await main();
