#!/usr/bin/env bun
// Upstream-sync scanner (dry-run detector). Compares the current manifest against
//   (a) npm's @anthropic-ai/claude-code latest version
//   (b) the zod schemas' enumerated values (our local source of truth)
// and prints the delta. Run it (`bun run upstream:scan`) to find out whether
// Claude Code has shipped a new release.
//
// The scanner never writes. The actual sync — changelog triage
// (ADOPT/DEDUPE/SKIP), schema + doc edits, and the manifest + CHANGELOG bumps —
// is the human-reviewed `/cc sync` skill, run on demand. (There was once a daily
// GH Action that auto-bumped the manifest version, but it could only ever change
// a version number — it never read the changelog — so it was retired in favor of
// the manual skill.)
//
// Every manifest list that has a local schema source of truth is diffed below.
// Two lists (knownEnvVars, knownBuiltinTools) have no local schema to diff
// against — see the "reference-only" log line and the manifest's `notes` for
// why — and are updated by hand via `/cc sync` instead.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { AgentIsolation, AgentMemory } from "../schemas/agent.ts";
import {
  AgentHook,
  CommandHook,
  HookEvent,
  HttpHook,
  McpToolHook,
  PromptHook,
} from "../schemas/hooks.ts";
import { McpHttpServer, McpSseServer, McpStdioServer } from "../schemas/mcp.ts";
import { PermissionMode } from "../schemas/permissions.ts";
import { Settings } from "../schemas/settings.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const MANIFEST = resolve(ROOT, "upstream", "claude-code-manifest.json");

const Manifest = z.looseObject({
  lastScan: z.string(),
  claudeCodeVersion: z.string(),
  knownSettingsKeys: z.array(z.string()),
  knownHookEvents: z.array(z.string()),
  knownHookTypes: z.array(z.string()),
  knownEnvVars: z.array(z.string()),
  knownBuiltinTools: z.array(z.string()),
  knownPermissionModes: z.array(z.string()),
  knownMcpTransports: z.array(z.string()),
  knownAgentIsolation: z.array(z.string()),
  knownAgentMemory: z.array(z.string()),
});

type Manifest = z.infer<typeof Manifest>;

async function loadManifest(): Promise<Manifest> {
  const raw = JSON.parse(await readFile(MANIFEST, "utf8"));
  return Manifest.parse(raw);
}

// Enumerate the top-level keys from the Settings schema. zod 4 exposes the
// object shape at runtime via `.shape` on ZodObject — no cast needed.
function settingsKeysFromSchema(): string[] {
  return Object.keys(Settings.shape).sort();
}

function hookEventsFromSchema(): string[] {
  return [...HookEvent.options].sort();
}

// Hook is a discriminated union on `type`; each member is a plain ZodObject
// with a required `type: z.literal(...)` field. `.value` is zod 4's public
// (if `@legacy`-flagged) single-value accessor on ZodLiteral.
function hookTypesFromSchema(): string[] {
  return [
    CommandHook.shape.type.value,
    HttpHook.shape.type.value,
    PromptHook.shape.type.value,
    AgentHook.shape.type.value,
    McpToolHook.shape.type.value,
  ].sort();
}

function permissionModesFromSchema(): string[] {
  return [...PermissionMode.options].sort();
}

// McpStdioServer's `type` is optional (bare stdio entries omit it), so its
// shape is `ZodOptional<ZodLiteral<"stdio">>` — unwrap before reading `.value`.
// McpHttpServer/McpSseServer's `type` is required.
function mcpTransportsFromSchema(): string[] {
  return [
    McpStdioServer.shape.type.unwrap().value,
    McpHttpServer.shape.type.value,
    McpSseServer.shape.type.value,
  ].sort();
}

function agentIsolationFromSchema(): string[] {
  return [...AgentIsolation.options].sort();
}

function agentMemoryFromSchema(): string[] {
  return [...AgentMemory.options].sort();
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
    const parsed = z.object({ version: z.string() }).safeParse(await res.json());
    return parsed.success ? parsed.data.version : null;
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
  const liveHookTypes = hookTypesFromSchema();
  const livePermissionModes = permissionModesFromSchema();
  const liveMcpTransports = mcpTransportsFromSchema();
  const liveAgentIsolation = agentIsolationFromSchema();
  const liveAgentMemory = agentMemoryFromSchema();
  const liveVersion = await fetchLatestClaudeCodeVersion();

  console.log("cc-settings upstream scan");
  console.log(`  manifest version: ${manifest.claudeCodeVersion} (scanned ${manifest.lastScan})`);
  console.log(`  live version:     ${liveVersion ?? "<unknown — network offline>"}`);
  console.log(
    "  reference-only (not diffed — no local schema source of truth; see manifest notes): knownEnvVars, knownBuiltinTools",
  );

  const findings: string[] = [];
  const versionDrift =
    liveVersion !== null && liveVersion !== manifest.claudeCodeVersion ? liveVersion : null;
  if (versionDrift) {
    findings.push(`  version drift: manifest=${manifest.claudeCodeVersion} → live=${versionDrift}`);
  }
  findings.push(...diffSets("settings keys", manifest.knownSettingsKeys, liveSettingsKeys));
  findings.push(...diffSets("hook events", manifest.knownHookEvents, liveHookEvents));
  findings.push(...diffSets("hook types", manifest.knownHookTypes, liveHookTypes));
  findings.push(
    ...diffSets("permission modes", manifest.knownPermissionModes, livePermissionModes),
  );
  findings.push(...diffSets("mcp transports", manifest.knownMcpTransports, liveMcpTransports));
  findings.push(...diffSets("agent isolation", manifest.knownAgentIsolation, liveAgentIsolation));
  findings.push(...diffSets("agent memory", manifest.knownAgentMemory, liveAgentMemory));

  if (findings.length === 0) {
    console.log("\nno drift detected.");
    return;
  }

  console.log("\ndrift detected:");
  for (const line of findings) console.log(line);
  console.log("\nrun `/cc sync` to triage the changelog and land the bump.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
