#!/usr/bin/env bun
// Upstream-sync scanner. Dry-run only in Phase 1 — compares the current
// manifest against:
//   (a) npm's @anthropic-ai/claude-code latest version
//   (b) the zod schema's enumerated keys (our local source of truth)
// and prints a delta. Phase 2 adds the `--open-pr` mode that opens a PR with
// schema edits + manifest bumps.
//
// This file lands in Phase 1 so the GH Action workflow isn't a total no-op;
// the mutation path (creating PRs) follows when we've proven the dry-run is
// stable and accurate.

import { readFile } from "node:fs/promises";
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

async function main() {
  const manifest = await loadManifest();
  const liveSettingsKeys = settingsKeysFromSchema();
  const liveHookEvents = hookEventsFromSchema();
  const liveVersion = await fetchLatestClaudeCodeVersion();

  console.log("cc-settings upstream scan (dry-run)");
  console.log(`  manifest version: ${manifest.claudeCodeVersion} (scanned ${manifest.lastScan})`);
  console.log(`  live version:     ${liveVersion ?? "<unknown — network offline>"}`);

  const findings: string[] = [];
  if (liveVersion && liveVersion !== manifest.claudeCodeVersion) {
    findings.push(`  version drift: manifest=${manifest.claudeCodeVersion} → live=${liveVersion}`);
  }
  findings.push(...diffSets("settings keys", manifest.knownSettingsKeys, liveSettingsKeys));
  findings.push(...diffSets("hook events", manifest.knownHookEvents, liveHookEvents));

  if (findings.length === 0) {
    console.log("\nno drift detected.");
    return;
  }

  console.log("\ndrift detected:");
  for (const line of findings) console.log(line);
  console.log(
    "\nPhase 1 scope: report only. Phase 2 wires --open-pr to propose schema + manifest updates.",
  );
  // Don't fail CI on drift yet — the bot's job is to open a PR, not to gate main.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
