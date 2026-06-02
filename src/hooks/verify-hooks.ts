#!/usr/bin/env bun
// SessionStart hook: verify that ~/.claude/settings.json hasn't been
// tampered with since install. Compares a SHA256 of the current hooks block
// against the fingerprint written by setup.ts.
//
// Threat model: supply-chain malware (Shai-Hulud worm pattern, May 2026)
// injects hooks into ~/.claude/settings.json to gain persistent execution
// that survives `npm uninstall` and reboots. The fingerprint catches the
// injection at the next session start.
//
// Fail-open: any read/parse failure → silent success. We never block session
// start. The only printed output is a loud warning on confirmed mismatch.

import { auditSettingsFile, hasSuspicious } from "../lib/audit-hooks.ts";
import { verifyAgainstSettings } from "../lib/hooks-fingerprint.ts";

async function main(): Promise<void> {
  try {
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
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `⚠  cc-settings: hooks-block fingerprint mismatch${suspicious ? " — SUSPICIOUS HOOKS DETECTED" : ""}`,
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
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
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
  } catch {
    // Fail open. Never block a session because the integrity check itself
    // had a bad day.
  }
}

await main();
