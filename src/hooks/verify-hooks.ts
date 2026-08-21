#!/usr/bin/env bun
// SessionStart hook: verify that the cc-settings install hasn't been tampered
// with since setup.sh last ran. Two independent checks:
//
//   1. Hooks-block fingerprint — SHA256 of the hooks section of
//      ~/.claude/settings.json vs the fingerprint written by setup.ts.
//      Catches injected hook ENTRIES (the Shai-Hulud worm pattern, May 2026).
//   2. Installed-runtime content manifest — SHA256 of managed source files and
//      every production dependency vs the manifest written by setup.ts.
//      A stdlib-only bootstrap runs this check before dependency-backed code.
//
// Fail closed for runtime integrity: a missing, unreadable, or mismatched
// manifest prevents dependency-backed checks from loading. We still never
// block session start; the hook prints a warning and returns successfully.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

interface TrustedModules {
  audit: typeof import("../lib/audit-hooks.ts");
  engine: typeof import("../lib/code-intel-engine.ts");
  fingerprint: typeof import("../lib/hooks-fingerprint.ts");
}

interface BootstrapResult {
  status: "ok" | "mismatch";
  changed: string[];
  unmanifested: string[];
}

const claudeDir = join(homedir(), ".claude");
const srcDir = join(claudeDir, "src");

function isSafeManifestPath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.split(/[/\\]/).includes("..");
}

async function hashRegularFile(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return null;
  }
}

async function walkDependencyFiles(dir: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      files.push(rel);
    } else if (entry.isDirectory()) {
      files.push(...(await walkDependencyFiles(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

/** Verify dependency bytes before importing any module that can load Zod. */
async function verifyRuntimeIntegrityBootstrap(): Promise<BootstrapResult> {
  const manifestPath = join(claudeDir, ".cc-settings-src-manifest");
  if (!existsSync(manifestPath)) {
    return { status: "mismatch", changed: ["integrity manifest (missing)"], unmanifested: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return { status: "mismatch", changed: ["integrity manifest"], unmanifested: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "mismatch", changed: ["integrity manifest"], unmanifested: [] };
  }
  const files = (parsed as Record<string, unknown>).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return { status: "mismatch", changed: ["integrity manifest"], unmanifested: [] };
  }
  const entries = Object.entries(files);
  if (
    entries.some(
      ([rel, hash]) =>
        !isSafeManifestPath(rel) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
    )
  ) {
    return { status: "mismatch", changed: ["integrity manifest"], unmanifested: [] };
  }

  const changed: string[] = [];
  for (const [rel, expected] of entries) {
    if ((await hashRegularFile(join(srcDir, rel))) !== expected) changed.push(rel);
  }
  const dependencyDir = join(srcDir, "node_modules");
  const onDiskDependencies = existsSync(dependencyDir)
    ? await walkDependencyFiles(dependencyDir, "node_modules")
    : [];
  const manifested = new Set(entries.map(([rel]) => rel));
  const unmanifested = onDiskDependencies.filter((rel) => !manifested.has(rel));
  return {
    status: changed.length === 0 && unmanifested.length === 0 ? "ok" : "mismatch",
    changed,
    unmanifested,
  };
}

function printRuntimeMismatch(result: BootstrapResult): void {
  console.log("");
  console.log(RULE);
  console.log("⚠  cc-settings: installed runtime differs from install manifest");
  console.log(RULE);
  console.log("   Managed scripts or production dependencies changed since setup.sh.");
  if (result.changed.length > 0) {
    console.log(`   modified or removed: ${fileList(result.changed)}`);
  }
  if (result.unmanifested.length > 0) {
    console.log(`   unexpected dependency file(s): ${fileList(result.unmanifested)}`);
  }
  console.log("");
  console.log("   Dependency-backed checks were not loaded. Claude Code may continue,");
  console.log("   but inspect the install before trusting later hooks.");
  console.log("");
  console.log("   Inspect with:  bun ~/.claude/src/scripts/audit-hooks.ts");
  console.log("   If legitimate: re-run setup.sh to reinstall and refresh the manifest.");
  console.log("   If unknown:    see SECURITY.md in cc-settings repo.");
  console.log(RULE);
  console.log("");
}

async function checkHooksFingerprint(modules: TrustedModules): Promise<void> {
  const verify = await modules.fingerprint.verifyAgainstSettings();
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
  const audit = await modules.audit.auditSettingsFile();
  const suspicious = modules.audit.hasSuspicious(audit);

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
  console.log("   Inspect with:  bun ~/.claude/src/scripts/audit-hooks.ts");
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

async function checkSrcManifest(modules: TrustedModules): Promise<void> {
  const result = await modules.fingerprint.verifySrcManifest();
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
  console.log("   Inspect with:  bun ~/.claude/src/scripts/audit-hooks.ts");
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
async function checkEnginePin(modules: TrustedModules): Promise<void> {
  const { engine } = await modules.engine.resolveEngine();
  if ((await modules.engine.verifyPinnedEngine(engine)) !== "mismatch") return;

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
  const bootstrap = await verifyRuntimeIntegrityBootstrap().catch(
    (): BootstrapResult => ({ status: "mismatch", changed: ["integrity check"], unmanifested: [] }),
  );
  if (bootstrap.status === "mismatch") {
    printRuntimeMismatch(bootstrap);
    return;
  }

  const [audit, engine, fingerprint] = await Promise.all([
    import("../lib/audit-hooks.ts"),
    import("../lib/code-intel-engine.ts"),
    import("../lib/hooks-fingerprint.ts"),
  ]);
  const modules: TrustedModules = { audit, engine, fingerprint };
  // Each check is independently fail-open: a crash in one must not silence
  // the others, and none may ever block session start.
  try {
    await checkHooksFingerprint(modules);
  } catch {
    // Fail open.
  }
  try {
    await checkSrcManifest(modules);
  } catch {
    // Fail open.
  }
  try {
    await checkEnginePin(modules);
  } catch {
    // Fail open.
  }
}

await main();
