import { join } from "node:path";
import type { McpStdioServer } from "../schemas/mcp.ts";
import { Settings } from "../schemas/settings.ts";
import { type EngineDescriptor, ensureEngineInstalled } from "./code-intel-engine.ts";
import { debug, progressArrow, progressOk, warn } from "./colors.ts";
import { composeSettings } from "./compose-settings.ts";
import { writeFingerprint as writeHooksFingerprint } from "./hooks-fingerprint.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { applyLightProfile, type Profile, stripManagedSettings } from "./light-profile.ts";
import {
  CLAUDE_JSON_PATH,
  installMcpToClaudeJson,
  type McpServers,
  pruneSettingsMcpServers,
  removeManagedMcpServers,
} from "./mcp.ts";
import { ensureSystemPackage, getInstallHint } from "./packages.ts";
import { ensurePinnedTool, TLDR_CODE_TOOL } from "./pinned-tools.ts";
import { CLAUDE_DIR, hasCommand } from "./platform.ts";
import { type SettingsBaseline, writeSettingsBaseline } from "./settings-baseline.ts";
import { mergeSettings, printMergeAccounting } from "./settings-merge.ts";

// --- Settings + MCP install ---------------------------------------------

export async function installSettings(
  source: string,
  version: string,
  interactive: boolean,
  profile: Profile,
  engine: EngineDescriptor,
  // Prior sentinel's exact echo of what a previous install wrote for
  // engine-managed MCP servers (SentinelInfo.mcpWritten) — threaded through to
  // installMcpToClaudeJson so it can recognize its own stale output even after
  // the live ENGINES registry's serverInstructions text has since changed.
  // Undefined/null on a first install or a pre-fix sentinel.
  priorMcpWritten?: Record<string, unknown> | null,
  // The PREVIOUS install's settings baseline, read by the caller BEFORE
  // runFullInstall — removeClaudeFilesWithHashes deletes the managed
  // footprint (baseline included) ahead of this function, so a read here
  // would always come back null. Null/undefined on a first install, a light
  // prior profile, or a pre-v13.1.0 install with no baseline.
  priorSettingsBaseline?: SettingsBaseline | null,
): Promise<{ overridden: string[]; mcpWritten: McpServers | null }> {
  const userSettingsPath = join(CLAUDE_DIR, "settings.json");
  // Compose team settings from config/ fragments (always the full baseline).
  // composeSettings schema-validates the composed object and throws on a bad
  // fragment, so everything below can trust the in-memory object.
  const fullComposed = await composeSettings(source);

  if (profile === "light") {
    // Light = raw Claude Code. Build the target settings:
    //   - Start from the light baseline ($schema + statusLine only).
    //   - If an existing settings.json is present, strip cc-settings' managed
    //     footprint from it first (so a prior full install doesn't survive the
    //     switch), then overlay $schema + statusLine.
    const lightBaseline = applyLightProfile(fullComposed);
    const teamMcp = structuredClone(fullComposed.mcpServers ?? {}) as McpServers;
    await pruneSettingsMcpServers(userSettingsPath, teamMcp, priorMcpWritten);
    const existingRaw = await readJsonOrNull(userSettingsPath);
    let result: Record<string, unknown>;
    if (existingRaw === null || typeof existingRaw !== "object") {
      // Fresh install — write the light baseline directly.
      result = lightBaseline;
    } else {
      // Existing settings.json: strip cc-settings footprint, then overlay the
      // light baseline. applyLightProfile emits ONLY $schema + statusLine, and
      // only when present in the composed settings, so a plain spread is exact.
      const { mcpServers: _managedMcp, ...settingsWithoutMcp } = fullComposed;
      const cleaned = stripManagedSettings(
        existingRaw as Record<string, unknown>,
        settingsWithoutMcp,
      );
      result = { ...cleaned, ...lightBaseline };
    }
    await atomicWriteJson(userSettingsPath, result);

    // Light has no team MCP servers. Remove any cc-settings-managed servers
    // that may have been written to ~/.claude.json by a prior full install.
    await removeManagedMcpServers(fullComposed, CLAUDE_JSON_PATH, priorMcpWritten);

    // Fingerprint the (empty/light) hooks block for the integrity check —
    // straight from the in-memory object, no disk re-read.
    await fingerprintSettingsHooks(result);
    // Light ships no MCP servers: nothing can be overridden, and nothing is
    // ours to remember having written.
    return { overridden: [], mcpWritten: null };
  }

  // Full profile path. MCP servers are installed to ~/.claude.json ONLY.
  //
  // Claude Code does not read `mcpServers` from settings.json at user scope —
  // measured three ways against the real binary (a server present only in
  // settings.json never appears in `claude mcp list`; with ~/.claude.json
  // present but lacking the key, `claude mcp list` reports "No MCP servers
  // configured", so it isn't even a fallback), and corroborated by the official
  // docs' configuration-locations table, which lists MCP storage as
  // `~/.claude.json` / `.mcp.json` and never settings.json.
  //
  // cc-settings used to write the block to BOTH files, which bought nothing and
  // cost a second ownership algorithm, a preservation prompt guarding config
  // nothing reads, and the H9 bug class — a defect whose entire content was the
  // inert copy disagreeing with the real one. See nuclear-review-2026-07-29 F6.
  //
  // Clone before mutating so the composed fragment is not aliased.
  const teamMcp = structuredClone(fullComposed.mcpServers ?? {}) as McpServers;
  const tldrEntry = teamMcp.tldr as McpStdioServer | undefined;
  if (tldrEntry) {
    tldrEntry.command = engine.mcp.command;
    tldrEntry.args = engine.mcp.args;
    tldrEntry.serverInstructions = engine.serverInstructions;
  }
  // One-time migration: drop the inert block a prior install wrote into
  // settings.json. Scoped to entries cc-settings itself wrote (per the
  // mcp_written sentinel) or that still match what we ship — anything the user
  // added by hand stays, even though it is equally inert there.
  const prunedInertMcp = await pruneSettingsMcpServers(userSettingsPath, teamMcp, priorMcpWritten);
  // mcpServers is deliberately absent from what the merger sees, so it is
  // neither written nor re-added on top of the prune above.
  const { mcpServers: _composedMcp, ...settingsForMerge } = fullComposed;
  // The previous team's contribution lets the merge decide three-way: prune
  // env keys cc-settings retired, and move values still equal to what that
  // team supplied onto changed defaults, while user edits keep winning.
  // A legacy merged snapshot cannot establish ownership. Missing/corrupt
  // provenance degrades to registry-only prune and plain user-wins.
  const baselineSettings = priorSettingsBaseline?.team_settings;
  const accounting = await mergeSettings(
    userSettingsPath,
    settingsForMerge as Record<string, unknown>,
    userSettingsPath,
    { interactive, sourceDir: source, baselineSettings },
  );
  if (accounting) printMergeAccounting(accounting, { interactive });
  if (prunedInertMcp.length > 0) {
    progressArrow(
      `Removed ${prunedInertMcp.length} inert mcpServers entr${prunedInertMcp.length === 1 ? "y" : "ies"} from settings.json (Claude Code reads ~/.claude.json)`,
    );
  }
  const mcpOverridden = await installMcpToClaudeJson(teamMcp, CLAUDE_JSON_PATH, priorMcpWritten);

  // Record a SHA256 of the merged hooks block so verify-hooks.ts (the
  // SessionStart integrity check) can detect post-install tampering — the
  // Shai-Hulud worm attack pattern (May 2026). Re-running setup.sh refreshes
  // the fingerprint, which is the intended workflow when users intentionally
  // add custom hooks. See SECURITY.md. Read back the merged file the merger
  // just wrote; best-effort, so a read failure only skips the fingerprint.
  const mergedReadBack = await readJsonOrNull(userSettingsPath);
  if (mergedReadBack === null) {
    throw new Error("Merged Claude settings disappeared before ownership metadata was written");
  }
  await fingerprintSettingsHooks(mergedReadBack);
  // Keep the merged restoration snapshot separate from the team's contribution
  // used by the next merge. A failed ownership write must fail the install.
  await writeSettingsBaseline(
    CLAUDE_DIR,
    version,
    mergedReadBack as Record<string, unknown>,
    settingsForMerge,
  );
  // teamMcp is post-engine-rewrite, so the tldr entry recorded here is the
  // resolved engine's — same value the old tldr-only branch reconstructed.
  return { overridden: mcpOverridden, mcpWritten: teamMcp };
}

/**
 * Hash + persist the hooks block of a settings object for the SessionStart
 * integrity check. Always fingerprints the RAW settings object — verify-hooks
 * (verifyAgainstSettings) hashes the raw on-disk JSON too, so the two sides
 * must agree on what "raw" means. Settings.safeParse is used only to
 * debug-log validation issues; a zod-stripped object here (dropping keys the
 * local schema doesn't model) would fingerprint a value verify-hooks can
 * never reproduce, producing a permanent false "hooks tampered" alarm. The
 * A failed write aborts installation because the sentinel claims this file by
 * hash; stamping success without it would create incomplete ownership state.
 */
async function fingerprintSettingsHooks(settings: unknown): Promise<void> {
  const validated = Settings.safeParse(settings);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    debug(`settings.json failed schema validation after merge (fingerprinting raw): ${issues}`);
  }
  await writeHooksFingerprint(settings, CLAUDE_DIR);
}

// --- Dependencies --------------------------------------------------------

export async function installDependencies(
  profile: Profile,
  engine: EngineDescriptor,
): Promise<void> {
  // CC_SKIP_DEPS=1 — used by E2E tests to avoid touching system-wide install
  // locations (npm global, pipx, etc.) when running setup.sh against a tmp
  // HOME. Setting HOME to tmpdir doesn't isolate `npm i -g` writes.
  if (process.env.CC_SKIP_DEPS === "1") return;

  // Light is raw Claude Code + statusLine (pure Bun) + share-learning skill.
  // No hooks require jq, pipx, or a code-intel engine — skip all system deps.
  if (profile === "light") return;

  if (!hasCommand("jq")) {
    const ok = await ensureSystemPackage("jq");
    if (!ok) warn(`Install jq manually: ${getInstallHint("jq")}`);
  }

  // pipx is a prerequisite only for a python-method engine (the llm-tldr shape).
  // A native-ts or download engine needs no Python toolchain.
  if (engine.install.method === "python" && !hasCommand("pipx")) {
    await ensureSystemPackage("pipx").catch(() => false);
  }

  // Provision the resolved engine: python package, pinned binary, or nothing.
  // Fail-soft — a provisioning error (e.g. an offline pinned-binary fetch) must
  // not abort the install; the engine simply stays unprovisioned.
  try {
    await ensureEngineInstalled(engine, CLAUDE_DIR);
  } catch (e) {
    warn(`code-intel engine '${engine.id}' not provisioned: ${(e as Error).message}`);
  }
}

// --- Pinned CLI tools (opt-in, separate from the code-intel engine) -------

/**
 * Install opt-in pinned CLI tools requested via CC_PINNED_TOOLS (comma/space
 * separated tool ids, e.g. `CC_PINNED_TOOLS=tldr-code bash setup.sh`).
 * Deliberately NOT part of installDependencies / the engine registry above —
 * these are standalone binaries consumers shell out to directly, never
 * registered as an MCP engine. Absent the env var, nothing is downloaded.
 * Fail-soft throughout: a failed tool install must never abort the settings
 * install.
 */
export async function installPinnedTools(profile: Profile): Promise<void> {
  if (process.env.CC_SKIP_DEPS === "1") return;
  if (profile === "light") return;

  const requested = (process.env.CC_PINNED_TOOLS ?? "").split(/[\s,]+/).filter(Boolean);
  if (requested.length === 0) return;

  for (const id of requested) {
    if (id !== TLDR_CODE_TOOL.id) {
      warn(`Unknown pinned tool '${id}' requested via CC_PINNED_TOOLS — skipping`);
      continue;
    }
    try {
      const path = await ensurePinnedTool(TLDR_CODE_TOOL, CLAUDE_DIR);
      if (path) progressOk(`${id} installed at ${path}`);
    } catch (e) {
      warn(`pinned tool '${id}' not installed: ${(e as Error).message}`);
    }
  }
}
