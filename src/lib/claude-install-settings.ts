import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
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
import { isInteractive, promptSecret } from "./prompts.ts";
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

// --- Function-hook compaction plugins -------------------------------------

const PLUGIN_INSTALL_TIMEOUT_MS = 90_000;
// Keep in sync with config/10-core.json's extraKnownMarketplaces entry.
export const UPSTREAM_PINNED_SHA = "e3f262a7f4d42bd8dd32ced30d26176f7cb545b0";

// Exported so the --dry-run reporter (install-display.ts) prints exactly what
// installPlugins would run, instead of a second hand-maintained copy.
export const PLUGIN_INSTALL_COMMANDS: readonly (readonly string[])[] = [
  ["plugin", "marketplace", "add", "darkroomengineering/cc-settings"],
  ["plugin", "marketplace", "add", "tamaratran/fast-jev-compaction"],
  // `add` is a no-op for a marketplace already registered; `update` refreshes
  // the clone so a plugin added in this release is visible to `install`.
  ["plugin", "marketplace", "update", "cc-settings"],
  [
    "plugin",
    "install",
    "fast-jev-compaction@fast-jev-compaction",
    "--config",
    "compactAtPercent=100",
  ],
  ["plugin", "install", "compaction-trigger@cc-settings"],
  ["plugin", "install", "context-report@cc-settings"],
  ["plugin", "install", "drift-fuse@cc-settings"],
];

/** The plugin step talks to the real Claude plugin store and the network, so
 *  it runs only for a real install. Every test sandbox points HOME at a
 *  directory under the OS temp dir (mkdtemp(tmpdir())), so a HOME inside
 *  tmpdir is skipped without each spawn site having to know. (Bun's
 *  userInfo().homedir follows $HOME too, so the account's passwd home is not
 *  a usable reference.) `CC_SETTINGS_SKIP_PLUGIN_INSTALL=1` skips explicitly;
 *  `CC_SETTINGS_FORCE_PLUGIN_INSTALL=1` overrides the check for a test that
 *  exercises the step on purpose. */
export function pluginInstallAllowed(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
  temp: string = tmpdir(),
): boolean {
  if (env.CC_SETTINGS_SKIP_PLUGIN_INSTALL === "1") return false;
  if (env.CC_SETTINGS_FORCE_PLUGIN_INSTALL === "1") return true;
  const h = canonical(home);
  const t = canonical(temp);
  return h !== t && !h.startsWith(t + sep);
}

/** Absolute, symlink-resolved (macOS /var → /private/var), no trailing slash.
 *  A path that does not exist yet resolves through its longest existing
 *  ancestor, so "/tmp/new-sandbox" and "/private/tmp" still compare. */
function canonical(path: string): string {
  const abs = resolve(path);
  let existing = abs;
  let rest = "";
  while (existing.length > 0) {
    try {
      const real = realpathSync(existing);
      return join(real, rest).replace(/[\\/]+$/, "");
    } catch {
      const parent = dirname(existing);
      if (parent === existing) break;
      rest = join(basename(existing), rest);
      existing = parent;
    }
  }
  return abs.replace(/[\\/]+$/, "");
}

export const FAST_JEV_PLUGIN_ID = "fast-jev-compaction@fast-jev-compaction";
export const LATER_KEY_COMMAND = `claude plugin install ${FAST_JEV_PLUGIN_ID} --config apiKey=<key>`;

/** Replace every occurrence of a secret in text with a redaction marker, so
 *  warnings and dry-run lines can never leak it. */
export function redactKey(text: string, key: string | null | undefined): string {
  if (!key) return text;
  return text.split(key).join("<redacted>");
}

type KeySource = "flag" | "prompt" | "env" | "settings";

/** Find a TypeSafe key: the flag, the environment, the installed settings'
 *  env block, else an interactive prompt (TTY only). Returns null when none. */
async function resolveTypesafeKey(
  flagKey: string | null | undefined,
  dryRun: boolean,
): Promise<{ key: string; source: KeySource } | null> {
  if (flagKey) return { key: flagKey, source: "flag" };
  const fromEnv = process.env.TYPESAFE_API_KEY;
  if (fromEnv) return { key: fromEnv, source: "env" };
  const installed = await readJsonOrNull(join(CLAUDE_DIR, "settings.json"));
  const env = (installed as { env?: Record<string, unknown> } | null)?.env;
  const fromSettings = env?.TYPESAFE_API_KEY;
  if (typeof fromSettings === "string" && fromSettings)
    return { key: fromSettings, source: "settings" };
  if (dryRun || !isInteractive()) return null;
  const typed = await promptSecret(
    "TypeSafe API key for verbatim Jev compaction (Enter to skip; keys at https://typesafe.ai): ",
  );
  return typed ? { key: typed, source: "prompt" } : null;
}

/** Write TYPESAFE_API_KEY into ~/.claude/settings.json's env block. The env
 *  merge is user-wins and cc-settings never ships this key, so later installs
 *  keep it; the hooks fingerprint covers only the hooks block. Fail-open. */
export async function persistTypesafeKeyToSettingsEnv(
  key: string,
  settingsPath: string = join(CLAUDE_DIR, "settings.json"),
): Promise<boolean> {
  try {
    const current = (await readJsonOrNull(settingsPath)) as Record<string, unknown> | null;
    if (!current || typeof current !== "object") return false;
    const env = (current.env ?? {}) as Record<string, unknown>;
    if (env.TYPESAFE_API_KEY === key) return true;
    await atomicWriteJson(settingsPath, { ...current, env: { ...env, TYPESAFE_API_KEY: key } });
    return true;
  } catch (e) {
    warn(
      `Could not write TYPESAFE_API_KEY to settings env: ${redactKey((e as Error).message, key)}`,
    );
    return false;
  }
}

type ClaudeCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

async function runClaudeCommand(args: readonly string[]): Promise<ClaudeCommandResult> {
  const child = Bun.spawn(["claude", ...args], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, PLUGIN_INSTALL_TIMEOUT_MS);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// A marketplace/plugin already registered from a prior install exits non-zero
// with an "already exists"/"already installed" message — that's success, not
// a failure to warn about.
function claudeCommandSucceeded(result: ClaudeCommandResult): boolean {
  if (result.timedOut) return false;
  if (result.exitCode === 0) return true;
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes("already exists") || combined.includes("already installed");
}

/**
 * Registers the two marketplaces and installs the two compaction plugins
 * (upstream fast-jev-compaction, pinned by commit SHA — see
 * config/10-core.json's extraKnownMarketplaces — and cc-settings' own
 * compaction-trigger) via the `claude` CLI, mirroring what settings.json's
 * enabledPlugins/pluginConfigs already declare.
 *
 * Fail-open throughout: any `claude plugin ...` command failing must never
 * fail the cc-settings install, only warn. Skipped entirely for the light
 * profile, when `claude` is not on PATH, or when
 * CC_SETTINGS_SKIP_PLUGIN_INSTALL=1 (set unconditionally by the install E2E
 * test harness so tests never touch the real plugin store or the network).
 *
 * `dryRun` prints the commands and runs nothing, matching --dry-run's
 * contract; in practice setup.ts's --dry-run branch returns before this is
 * ever called (see install-display.ts's cmdDryRun, which prints the same
 * PLUGIN_INSTALL_COMMANDS list for that path) — this guard just means a
 * future direct caller with dryRun:true still gets the documented behavior.
 */
export async function installPlugins(
  profile: Profile,
  dryRun: boolean,
  opts: { typesafeKey?: string | null } = {},
): Promise<void> {
  if (profile === "light") return;
  if (!pluginInstallAllowed()) {
    debug("plugin step skipped: HOME is not the account home (test sandbox) or skip flag set");
    return;
  }
  if (!hasCommand("claude")) return;

  const resolved = await resolveTypesafeKey(opts.typesafeKey, dryRun);
  // A key that already lives in the environment or the settings env block is
  // read by the plugin directly; only a freshly supplied one (flag or prompt)
  // is stored through the plugin's sensitive option AND written to the
  // settings env block, so the session banner, hooks, and scripts can read
  // it too (the plugin store is opaque to everything but the plugin).
  const storeKey = resolved && (resolved.source === "flag" || resolved.source === "prompt");
  if (storeKey && !dryRun) await persistTypesafeKeyToSettingsEnv(resolved.key);
  const commands = PLUGIN_INSTALL_COMMANDS.map((args) =>
    storeKey && args.includes(FAST_JEV_PLUGIN_ID)
      ? [...args, "--config", `apiKey=${resolved.key}`]
      : args,
  );
  const shown = (args: readonly string[]) => redactKey(`claude ${args.join(" ")}`, resolved?.key);

  if (dryRun) {
    for (const args of commands) progressArrow(`Would run: ${shown(args)}`);
    return;
  }

  const installed: string[] = [];
  for (const args of commands) {
    const plugin = args[0] === "plugin" && args[1] === "install" ? args[2] : null;
    try {
      const result = await runClaudeCommand(args);
      if (!claudeCommandSucceeded(result)) {
        const detail = (result.timedOut ? "timed out" : result.stderr || result.stdout)
          .trim()
          .slice(0, 300);
        warn(`${shown(args)} failed: ${redactKey(detail, resolved?.key)}`);
      } else if (plugin) {
        installed.push(
          plugin === FAST_JEV_PLUGIN_ID
            ? `fast-jev-compaction (pinned ${UPSTREAM_PINNED_SHA.slice(0, 7)})`
            : (plugin.split("@")[0] ?? plugin),
        );
      }
    } catch (e) {
      warn(`${shown(args)} failed: ${redactKey((e as Error).message, resolved?.key)}`);
    }
  }
  if (installed.length > 0) progressOk(`Plugins: ${installed.join(", ")}`);
  if (resolved) {
    progressOk(
      `Compaction: verbatim (Jev), key from ${resolved.source}${storeKey ? "; TYPESAFE_API_KEY written to settings env" : ""}`,
    );
  } else {
    progressArrow(`Compaction stays native. Later: ${LATER_KEY_COMMAND}`);
  }
}
