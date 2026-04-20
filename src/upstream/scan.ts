#!/usr/bin/env bun
// Upstream-sync scanner. Phases:
//   dry-run (default): compares the current manifest against
//     (a) npm's @anthropic-ai/claude-code latest version
//     (b) the zod schema's enumerated keys (our local source of truth)
//     and prints a delta.
//   --open-pr: write an updated manifest + open a GitHub PR (requires `gh`
//     CLI + a token with PR-write scope; used by .github/workflows/upstream-sync.yml).
//
// Phase 2 adds the mutation path. It is deliberately low-blast-radius: the
// scanner only updates upstream/claude-code-manifest.json when the live
// npm version differs from the committed one. Schema edits stay human-
// reviewed — the PR body lists the delta and we let the reviewer wire the
// new keys into the zod schemas.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { HookEvent } from "../schemas/hooks.ts";
import { Settings } from "../schemas/settings.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const MANIFEST = resolve(ROOT, "upstream", "claude-code-manifest.json");

const Manifest = z
  .object({
    lastScan: z.string(),
    claudeCodeVersion: z.string(),
    knownSettingsKeys: z.array(z.string()),
    knownHookEvents: z.array(z.string()),
    knownHookTypes: z.array(z.string()),
    knownEnvVars: z.array(z.string()),
    knownBuiltinTools: z.array(z.string()),
  })
  .passthrough();

type Manifest = z.infer<typeof Manifest>;

async function loadManifest(): Promise<Manifest> {
  const raw = JSON.parse(await readFile(MANIFEST, "utf8"));
  return Manifest.parse(raw);
}

// Enumerate the top-level keys from the Settings schema. zod 4 exposes the
// object shape at runtime via `.shape` on ZodObject.
function settingsKeysFromSchema(): string[] {
  const shape = (Settings as unknown as { shape: Record<string, unknown> }).shape;
  return Object.keys(shape).sort();
}

function hookEventsFromSchema(): string[] {
  return [...HookEvent.options].sort();
}

async function fetchLatestClaudeCodeVersion(): Promise<string | null> {
  // Try `bun pm view` first (works offline in CI cache, no fetch dep).
  try {
    const proc = Bun.spawn(["bun", "pm", "view", "@anthropic-ai/claude-code", "version"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) === 0 && /^\d+\.\d+\.\d+/.test(out)) return out;
  } catch {
    // fall through to fetch
  }
  try {
    const res = await fetch("https://registry.npmjs.org/@anthropic-ai/claude-code/latest", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

function diffSets(label: string, manifest: string[], live: string[]): string[] {
  const ms = new Set(manifest);
  const ls = new Set(live);
  const missing = live.filter((k) => !ms.has(k));
  const extra = manifest.filter((k) => !ls.has(k));
  const out: string[] = [];
  if (missing.length) out.push(`  ${label}: in schema but NOT in manifest → ${missing.join(", ")}`);
  if (extra.length) out.push(`  ${label}: in manifest but NOT in schema → ${extra.join(", ")}`);
  return out;
}

async function saveManifest(manifest: Manifest): Promise<void> {
  // Preserve the existing on-disk key order as much as we can; stable keys
  // keep diffs small when nothing substantive changed.
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(MANIFEST, content);
}

async function runGh(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
}

async function runGit(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
}

async function openSyncPr(summary: string, body: string, newVersion: string): Promise<void> {
  const branch = `upstream-sync/${newVersion}-${Date.now()}`;
  await runGit(["config", "user.name", "upstream-sync-bot"]);
  await runGit(["config", "user.email", "upstream-sync-bot@users.noreply.github.com"]);
  await runGit(["checkout", "-b", branch]);
  await runGit(["add", "upstream/claude-code-manifest.json"]);
  const commitTitle = `chore(upstream-sync): bump manifest to ${newVersion}`;
  const commitRes = await runGit(["commit", "-m", commitTitle]);
  if (commitRes.exit !== 0) {
    console.error("git commit failed:", commitRes.stderr);
    return;
  }
  const pushRes = await runGit(["push", "-u", "origin", branch]);
  if (pushRes.exit !== 0) {
    console.error("git push failed:", pushRes.stderr);
    return;
  }
  const prRes = await runGh([
    "pr",
    "create",
    "--title",
    summary,
    "--body",
    body,
    "--label",
    "upstream-sync",
  ]);
  if (prRes.exit !== 0) {
    console.error("gh pr create failed:", prRes.stderr);
    return;
  }
  console.log(`opened PR for ${newVersion}: ${prRes.stdout.trim()}`);
}

async function main() {
  const args = process.argv.slice(2);
  const openPr = args.includes("--open-pr");

  const manifest = await loadManifest();
  const liveSettingsKeys = settingsKeysFromSchema();
  const liveHookEvents = hookEventsFromSchema();
  const liveVersion = await fetchLatestClaudeCodeVersion();

  console.log(`cc-settings upstream scan (${openPr ? "open-pr" : "dry-run"})`);
  console.log(`  manifest version: ${manifest.claudeCodeVersion} (scanned ${manifest.lastScan})`);
  console.log(`  live version:     ${liveVersion ?? "<unknown — network offline>"}`);

  const findings: string[] = [];
  const versionDrift =
    liveVersion !== null && liveVersion !== manifest.claudeCodeVersion ? liveVersion : null;
  if (versionDrift) {
    findings.push(`  version drift: manifest=${manifest.claudeCodeVersion} → live=${versionDrift}`);
  }
  findings.push(...diffSets("settings keys", manifest.knownSettingsKeys, liveSettingsKeys));
  findings.push(...diffSets("hook events", manifest.knownHookEvents, liveHookEvents));

  if (findings.length === 0) {
    console.log("\nno drift detected.");
    return;
  }

  console.log("\ndrift detected:");
  for (const line of findings) console.log(line);

  if (!openPr) {
    console.log("\nre-run with --open-pr to propose the manifest update as a PR.");
    return;
  }

  if (!versionDrift) {
    // Schema-only drift is interesting but we don't auto-edit schemas; surface
    // via CI logs and let a human wire the new keys.
    console.log("\nschema-only drift — no manifest update proposed. Review the findings above.");
    return;
  }

  // Mutate the manifest version + lastScan, keep key lists untouched (schema
  // additions are human work). If schema keys drift too, we note them in the
  // PR body.
  const updated: Manifest = {
    ...manifest,
    claudeCodeVersion: versionDrift,
    lastScan: new Date().toISOString(),
  };
  await saveManifest(updated);

  const summary = `chore(upstream-sync): bump claude-code manifest to ${versionDrift}`;
  const body = [
    "Automated upstream-sync PR.",
    "",
    `- manifest: \`${manifest.claudeCodeVersion}\` → \`${versionDrift}\``,
    "",
    "## Findings",
    "",
    "```",
    findings.join("\n"),
    "```",
    "",
    "If the findings list schema-key drift, wire the new keys into the appropriate",
    "zod schemas in `src/schemas/` and push onto this branch.",
    "",
    "Generated by `src/upstream/scan.ts --open-pr`.",
  ].join("\n");

  await openSyncPr(summary, body, versionDrift);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
