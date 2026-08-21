#!/usr/bin/env bun
// cc-settings installer.
//
// Invoked by the bootstrap at repo root:
//   macOS/Linux: setup.sh (installs Bun if missing, execs `bun src/setup.ts`)
//   Windows:     setup.ps1 (same flow via PowerShell)
//
// Direct invocation from a cloned repo works too: `bun src/setup.ts`.
//
// Flags:
//   --source=<dir>     Explicit source directory (defaults to ../ from this file).
//   --target=auto|claude|codex|both
//                      Select install surfaces (default: auto).
//   --rollback[=TS]    Restore newest backup (or a timestamp match) from ~/.claude/backups.
//   --uninstall        Remove cc-settings-managed files from the selected target.
//   --dry-run          Print planned actions without touching disk.
//   --light            Claude: statusLine + share-learning only. Codex: managed
//                      AGENTS.md + runtime source only; no plugin, native agents,
//                      or command rule.
//   --help, -h         Usage.

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { currentClaudeManagedSourceFiles } from "./lib/claude-managed-file-manifests.ts";
import {
  CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  validateClaudeManagedFileOwnership,
} from "./lib/claude-managed-files.ts";
import { checkCliTools, printPreflightReport } from "./lib/cli-preflight.ts";
import {
  type EngineDescriptor,
  ensureEngineInstalled,
  resolveEngine,
} from "./lib/code-intel-engine.ts";
import {
  codexInstallPaths,
  dryRunCodex,
  gatherCodexStatus,
  installCodex,
  isCodexCliSkippedForTests,
  listCodexSharedBackupIds,
  readCodexInstalledVersion,
  restoreCodexCompensation,
  rollbackCodex,
  uninstallCodex,
  validateCodexInstallBoundaries,
  validateProductRootDisjointness,
} from "./lib/codex-install.ts";
import {
  debug,
  error,
  info,
  palette,
  progressArrow,
  progressOk,
  showBanner,
  success,
  warn,
} from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import { formatFrontmatterIssues, validateFrontmatters } from "./lib/frontmatter-validate.ts";
import {
  writeFingerprint as writeHooksFingerprint,
  writeSrcManifest,
} from "./lib/hooks-fingerprint.ts";
import {
  ClaudePrewriteOwnershipChangedError,
  listClaudeSharedBackupIds,
  type PreparedClaudeRollback,
  prepareClaudeCompensation,
  prepareClaudeRollback,
  printHelp,
} from "./lib/install-cmds.ts";
import { cmdDryRun, printStatus, showSummary } from "./lib/install-display.ts";
import {
  CLAUDE_RUNTIME_MARKER,
  createBackup,
  createDirectories,
  installConfigFiles,
  installTsSources,
  preflightInstallSource,
} from "./lib/install-fs.ts";
import { acquireInstallLock, InstallLockError } from "./lib/install-lock.ts";
import { atomicWriteJson, JsonParseError, readJsonOrNull } from "./lib/json-io.ts";
import { applyLightProfile, type Profile, stripManagedSettings } from "./lib/light-profile.ts";
import {
  CLAUDE_JSON_PATH,
  installMcpToClaudeJson,
  type McpServers,
  pruneSettingsMcpServers,
  removeManagedMcpServers,
} from "./lib/mcp.ts";
import { ensureSystemPackage, getInstallHint } from "./lib/packages.ts";
import { ensurePinnedTool, TLDR_CODE_TOOL } from "./lib/pinned-tools.ts";
import {
  CLAUDE_DIR,
  getTimestamp,
  hasCommand,
  installPaths,
  isWindows,
  os,
} from "./lib/platform.ts";
import { isInteractive, promptYn } from "./lib/prompts.ts";
import {
  type AutoUpdateStateSnapshot,
  autoUpdateJobLoaded,
  decideAutoUpdate,
  plistPath,
  registerAutoUpdate,
  restoreAutoUpdateState,
  snapshotAutoUpdateState,
  unregisterAutoUpdate,
} from "./lib/schedule.ts";
import { writeSettingsBaseline } from "./lib/settings-baseline.ts";
import { mergeSettings, printMergeAccounting } from "./lib/settings-merge.ts";
import { formatPrereqWarnings, reportMissingPrereqs } from "./lib/skill-prereqs.ts";
import { gatherStatus } from "./lib/status.ts";
import {
  buildVersionDelta,
  compareVersion,
  readDestructiveSentinel,
  readSentinel,
  readSentinelInfo,
  type Sentinel,
  writeSentinel,
} from "./lib/version-delta.ts";
import type { McpStdioServer } from "./schemas/mcp.ts";
import { Settings } from "./schemas/settings.ts";

const VERSION = "13.16.0"; // Claude Code 2.1.237 sync: spellcheck key, ANTHROPIC_DEFAULT_MODEL
const STRICT_VERSION = /^\d+\.\d+\.\d+$/;
let sharedBackupSequence = 0;

function createSharedBackupId(): string {
  const now = new Date();
  return `${getTimestamp(now)}-${String(now.getMilliseconds()).padStart(3, "0")}-${process.pid}-${sharedBackupSequence++}`;
}

// --- Arg parsing ---------------------------------------------------------

type Args = {
  rollback: string | true | null;
  uninstall: boolean;
  dryRun: boolean;
  status: boolean;
  help: boolean;
  sourceDir: string;
  interactive: boolean;
  migrateOnly: boolean;
  profile: Profile;
  autoUpdate: "on" | "off" | null;
  target: InstallTarget;
  errors: string[];
};

export type InstallTarget = "auto" | "claude" | "codex" | "both";

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    rollback: null,
    uninstall: false,
    dryRun: false,
    status: false,
    help: false,
    sourceDir: resolve(import.meta.dir, ".."),
    // CC_INTERACTIVE=1 opts in for scripts/CI without argv juggling.
    interactive: process.env.CC_INTERACTIVE === "1",
    migrateOnly: false,
    profile: "full",
    autoUpdate: null,
    target: "auto",
    errors: [],
  };
  for (const a of argv) {
    if (a === "--rollback") args.rollback = true;
    else if (a.startsWith("--rollback=")) args.rollback = a.slice("--rollback=".length);
    else if (a === "--uninstall") args.uninstall = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--status") args.status = true;
    else if (a === "--interactive") args.interactive = true;
    else if (a === "--migrate-only") args.migrateOnly = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--source=")) args.sourceDir = resolve(a.slice("--source=".length));
    else if (a === "--light") args.profile = "light";
    else if (a.startsWith("--target=")) {
      const value = a.slice("--target=".length);
      if (value === "auto" || value === "claude" || value === "codex" || value === "both") {
        args.target = value;
      } else {
        args.errors.push(`--target=${value} is not valid (expected auto, claude, codex, or both)`);
      }
    } else if (a.startsWith("--auto-update=")) {
      const value = a.slice("--auto-update=".length);
      if (value === "on" || value === "off") args.autoUpdate = value;
      else args.errors.push(`--auto-update=${value} is not valid (expected "on" or "off")`);
    } else args.errors.push(`Unknown argument: ${a}`);
  }
  return args;
}

// --- Settings + MCP install ---------------------------------------------

async function installSettings(
  source: string,
  interactive: boolean,
  profile: Profile,
  engine: EngineDescriptor,
  // Prior sentinel's exact echo of what a previous install wrote for
  // engine-managed MCP servers (SentinelInfo.mcpWritten) — threaded through to
  // installMcpToClaudeJson so it can recognize its own stale output even after
  // the live ENGINES registry's serverInstructions text has since changed.
  // Undefined/null on a first install or a pre-fix sentinel.
  priorMcpWritten?: Record<string, unknown> | null,
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
  const accounting = await mergeSettings(
    userSettingsPath,
    settingsForMerge as Record<string, unknown>,
    userSettingsPath,
    { interactive, sourceDir: source },
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
  // Phase 1 of the three-way settings-merge design (docs/settings-merge-three-
  // way-design.md §1): record what this install actually wrote, for a future
  // merge to read — nothing reads it yet. Best-effort, same as the fingerprint
  // above: a baseline write failure must never fail an install.
  await writeSettingsBaseline(CLAUDE_DIR, VERSION, mergedReadBack as Record<string, unknown>);
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

async function installDependencies(profile: Profile, engine: EngineDescriptor): Promise<void> {
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
async function installPinnedTools(profile: Profile): Promise<void> {
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

// --- Auto-update enrollment ----------------------------------------------

/**
 * Resolve + apply the auto-update enrollment decision, then (re)register or
 * unregister the launchd job to match. macOS-only — on other platforms this
 * only prints a note (once, when the user explicitly tried the flag) and
 * leaves the sentinel field untouched (absent, not "declined").
 *
 * Returns the enrollment value to persist in the sentinel: true/false when a
 * decision was made this run, undefined when nothing should be written
 * (non-macOS, or a non-interactive run with no prior decision).
 */
function assertAutoUpdateRequestDoesNotClaimIndependentState(
  args: Args,
  snapshot: AutoUpdateStateSnapshot | null,
): void {
  if (snapshot?.restoreMode === "independent-preserve-only" && args.autoUpdate !== null) {
    throw new Error(
      "An independent same-label auto-update job already exists. Remove or rename it before using --auto-update.",
    );
  }
}

async function applyAutoUpdate(
  args: Args,
  prior: boolean | null,
  snapshot: AutoUpdateStateSnapshot | null,
  enrolledRepoPath: string,
): Promise<boolean | undefined> {
  if (os !== "macos") {
    if (args.autoUpdate !== null) warn("--auto-update is macOS-only; ignoring");
    else info("Auto-update is macOS-only — skipping (nothing to enroll on this platform).");
    return undefined;
  }

  if (snapshot?.restoreMode === "independent-preserve-only") {
    return undefined;
  }

  // Corroborate a sentinel claiming auto_update:true against the real
  // launchd job — an unauthenticated sentinel alone must never be able to
  // (re)register a job that isn't actually loaded. See decideAutoUpdate().
  const jobPresent = await autoUpdateJobLoaded();

  const decision = decideAutoUpdate({
    flag: args.autoUpdate,
    sentinelValue: prior ?? undefined,
    isTTY: isInteractive(),
    jobPresent,
  });

  let enrolled: boolean | undefined;
  if (decision.kind === "ask") {
    enrolled = await promptYn(
      "Enable daily auto-update? Pulls cc-settings and re-runs setup at 10am",
      true,
    );
  } else {
    enrolled = decision.enrolled;
  }

  if (enrolled === true) {
    const result = await registerAutoUpdate(CLAUDE_DIR, homedir(), enrolledRepoPath);
    if (result.ok) success("Auto-update enabled — daily at 10:00 local time.");
    else {
      throw new Error(`Auto-update registration failed: ${result.reason ?? "unknown error"}`);
    }
  } else if (enrolled === false) {
    const result = await unregisterAutoUpdate();
    if (!result.ok) throw new Error("Failed to disable the cc-settings auto-update job");
  }

  return enrolled;
}

async function resolveEnrolledRepoPath(sourceDir: string): Promise<string> {
  const override = process.env.CC_SETTINGS_ENROLLED_REPO;
  if (!override) return sourceDir;

  const expected = process.env.CC_EXPECTED_REPO;
  if (!expected) {
    throw new Error("CC_SETTINGS_ENROLLED_REPO requires the enrolled-path verification pin");
  }
  const [resolvedOverride, resolvedExpected] = await Promise.all([
    realpath(override),
    realpath(expected),
  ]);
  if (resolvedOverride !== resolvedExpected) {
    throw new Error("CC_SETTINGS_ENROLLED_REPO does not match the enrolled-path verification pin");
  }
  return resolvedOverride;
}

function claudeManagedPath(relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Unsafe managed file path in Claude sentinel: ${relativePath}`);
  }
  const destination = resolve(CLAUDE_DIR, relativePath);
  const fromRoot = relative(CLAUDE_DIR, destination);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Managed file path escapes Claude home: ${relativePath}`);
  }
  return destination;
}

async function regularFileHash(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) return null;
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function profileFileMappings(
  sourceDir: string,
  profile: Profile,
): Promise<Array<readonly [source: string, destination: string]>> {
  return currentClaudeManagedSourceFiles(profile).map(({ source, destination }) => [
    join(sourceDir, source),
    destination,
  ]);
}

interface PreparedClaudeInstallOwnership {
  files: Record<string, string>;
  nodeModulesTarget: string | null;
  targetPaths: string[];
  snapshot: ClaudeLifecycleOwnershipSnapshot;
}

interface ClaudeLifecycleFileState {
  present: boolean;
  hash: string | null;
}

interface ClaudeLifecycleOwnershipSnapshot {
  managedFiles: Record<string, string>;
  relativeFiles: Record<string, ClaudeLifecycleFileState>;
  sentinel: ClaudeLifecycleFileState;
  nodeModulesPresent: boolean;
  nodeModulesTarget: string | null;
}

interface ClaudeSharedFileState {
  present: boolean;
  hash: string | null;
  bytes?: Uint8Array;
  mode?: number;
}

interface ClaudeSharedExplicitSnapshot {
  settings: ClaudeSharedFileState;
  global: ClaudeSharedFileState;
}

interface ClaudeSharedExplicitDrift {
  settings?: ClaudeSharedFileState;
  global?: ClaudeSharedFileState;
}

type ClaudeMutationPhase = "unstarted" | "files" | "scheduler";

async function captureClaudeSharedFileState(path: string): Promise<ClaudeSharedFileState> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return { present: false, hash: null };
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Claude shared state is not a regular file: ${path}`);
  }
  const bytes = await readFile(path);
  return {
    present: true,
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    mode: metadata.mode & 0o777,
  };
}

async function captureClaudeSharedExplicitState(): Promise<ClaudeSharedExplicitSnapshot> {
  const [settings, global] = await Promise.all([
    captureClaudeSharedFileState(join(CLAUDE_DIR, "settings.json")),
    captureClaudeSharedFileState(CLAUDE_JSON_PATH),
  ]);
  return { settings, global };
}

function claudeSharedFileStateMatches(
  left: ClaudeSharedFileState,
  right: ClaudeSharedFileState,
): boolean {
  return left.present === right.present && left.hash === right.hash;
}

function isSafeClaudeSharedDrift(state: ClaudeSharedFileState): boolean {
  if (!state.present) return true;
  if (!state.bytes) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(state.bytes).toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

async function captureClaudeSharedExplicitDrift(
  before: ClaudeSharedExplicitSnapshot,
): Promise<ClaudeSharedExplicitDrift> {
  const after = await captureClaudeSharedExplicitState();
  return {
    ...(!claudeSharedFileStateMatches(after.settings, before.settings) &&
    isSafeClaudeSharedDrift(after.settings)
      ? { settings: after.settings }
      : {}),
    ...(!claudeSharedFileStateMatches(after.global, before.global) &&
    isSafeClaudeSharedDrift(after.global)
      ? { global: after.global }
      : {}),
  };
}

async function captureClaudeSharedExplicitDriftAfterFailure(
  before: ClaudeSharedExplicitSnapshot,
): Promise<ClaudeSharedExplicitDrift> {
  try {
    return await captureClaudeSharedExplicitDrift(before);
  } catch {
    // Wrong-type or unreadable failure output is not valid external JSON drift.
    // Exact compensation restores it from the pre-operation snapshot instead.
    return {};
  }
}

async function restoreClaudeSharedExplicitDrift(drift: ClaudeSharedExplicitDrift): Promise<void> {
  for (const [path, state] of [
    [join(CLAUDE_DIR, "settings.json"), drift.settings],
    [CLAUDE_JSON_PATH, drift.global],
  ] as const) {
    if (!state) continue;
    await rm(path, { recursive: true, force: true });
    if (!state.present || state.bytes === undefined || state.mode === undefined) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, state.bytes);
    await chmod(path, state.mode);
  }
}

async function captureClaudeLifecycleFileState(path: string): Promise<ClaudeLifecycleFileState> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return { present: false, hash: null };
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Claude lifecycle expected a regular file: ${path}`);
  }
  return {
    present: true,
    hash: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  };
}

async function captureClaudeLifecycleOwnership(
  managedFiles: Record<string, string>,
  targetPaths: readonly string[],
  nodeModulesTarget: string | null,
): Promise<ClaudeLifecycleOwnershipSnapshot> {
  const relativeFiles: Record<string, ClaudeLifecycleFileState> = {};
  for (const relativePath of new Set([...Object.keys(managedFiles), ...targetPaths])) {
    const state = await captureClaudeLifecycleFileState(claudeManagedPath(relativePath));
    const expectedHash = managedFiles[relativePath]?.toLowerCase();
    if (expectedHash && (!state.present || state.hash !== expectedHash)) {
      throw new Error(
        `Claude managed file is missing or modified: ${relativePath}. ` +
          "Restore the owned bytes or reinstall before continuing.",
      );
    }
    relativeFiles[relativePath] = state;
  }
  const sentinel = await captureClaudeLifecycleFileState(join(CLAUDE_DIR, ".cc-settings-version"));
  const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
  const nodeModulesMetadata = await lstat(installedNodeModules).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (
    nodeModulesMetadata &&
    (!nodeModulesTarget ||
      !(await claudeNodeModulesMatches(installedNodeModules, nodeModulesTarget)))
  ) {
    throw new Error("Claude src/node_modules ownership changed during lifecycle preparation");
  }
  return {
    managedFiles: Object.fromEntries(
      Object.entries(managedFiles).map(([path, hash]) => [path, hash.toLowerCase()]),
    ),
    relativeFiles,
    sentinel,
    nodeModulesPresent: nodeModulesMetadata !== null,
    nodeModulesTarget,
  };
}

async function assertClaudeLifecycleOwnershipUnchanged(
  snapshot: ClaudeLifecycleOwnershipSnapshot,
): Promise<void> {
  try {
    for (const [relativePath, expected] of Object.entries(snapshot.relativeFiles)) {
      const current = await captureClaudeLifecycleFileState(claudeManagedPath(relativePath));
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        throw new Error(`Claude managed file changed after preparation: ${relativePath}`);
      }
    }
    const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
    const metadata = await lstat(installedNodeModules).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    });
    const matches =
      snapshot.nodeModulesPresent === (metadata !== null) &&
      (!snapshot.nodeModulesPresent ||
        (snapshot.nodeModulesTarget !== null &&
          (await claudeNodeModulesMatches(installedNodeModules, snapshot.nodeModulesTarget))));
    if (!matches) throw new Error("Claude src/node_modules changed after preparation");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ClaudePrewriteOwnershipChangedError(detail, cause);
  }
  const currentSentinel = await captureClaudeLifecycleFileState(
    join(CLAUDE_DIR, ".cc-settings-version"),
  );
  if (JSON.stringify(currentSentinel) !== JSON.stringify(snapshot.sentinel)) {
    throw new Error("Claude ownership sentinel changed after lifecycle preparation");
  }
}

async function claudeNodeModulesMatches(path: string, expectedTarget: string): Promise<boolean> {
  const metadata = await lstat(path).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return false;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    const marker = await readFile(join(path, ".cc-settings-owned.ts"), "utf8").catch(() => null);
    return (
      (await realpath(path).catch(() => null)) === expectedTarget &&
      marker === CLAUDE_RUNTIME_MARKER
    );
  }
  if (!metadata.isSymbolicLink()) return false;
  const linkedTarget = resolve(dirname(path), await readlink(path));
  if (linkedTarget === expectedTarget) return true;
  try {
    const [actual, expected] = await Promise.all([realpath(path), realpath(expectedTarget)]);
    return actual === expected;
  } catch {
    return false;
  }
}

async function validateClaudeNodeModulesOwnership(
  sentinel: Awaited<ReturnType<typeof readDestructiveSentinel>>,
): Promise<string | null> {
  const installedPath = claudeManagedPath(join("src", "node_modules"));
  const metadata = await lstat(installedPath).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  });
  if (!metadata) return null;
  let expectedTarget: string | null = null;
  if (metadata.isSymbolicLink() && sentinel?.repo_path) {
    expectedTarget = await realpath(resolve(sentinel.repo_path, "node_modules"));
  } else if (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    sentinel?.managed_files &&
    sentinel.managed_files_manifest_version
  ) {
    expectedTarget = await realpath(installedPath);
  }
  if (!expectedTarget || !(await claudeNodeModulesMatches(installedPath, expectedTarget))) {
    throw new Error(
      "Claude managed destination collision: src/node_modules. " +
        "Preserve or remove the unowned path before installing.",
    );
  }
  return expectedTarget;
}

async function validateClaudeInstallBoundaries(): Promise<void> {
  const allowedSystemAliases = new Map([
    [resolve("/var"), resolve("/private/var")],
    [resolve("/tmp"), resolve("/private/tmp")],
  ]);
  const assertBoundary = async (
    candidate: string,
    leafKind: "file" | "directory",
  ): Promise<void> => {
    const absolute = resolve(candidate);
    const root = parse(absolute).root;
    let current = root;
    const segments = absolute.slice(root.length).split(sep).filter(Boolean);
    for (let index = 0; index < segments.length; index++) {
      current = join(current, segments[index] as string);
      const metadata = await lstat(current).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      });
      if (!metadata) return;
      const leaf = index === segments.length - 1;
      if (metadata.isSymbolicLink()) {
        const allowedTarget = allowedSystemAliases.get(current);
        if (!allowedTarget || (await realpath(current).catch(() => null)) !== allowedTarget) {
          throw new Error(`Unsafe Claude install boundary symlink: ${current}`);
        }
        continue;
      }
      if (!leaf || leafKind === "directory") {
        if (!metadata.isDirectory()) {
          throw new Error(`Claude install boundary is not a directory: ${current}`);
        }
      } else if (!metadata.isFile()) {
        throw new Error(`Claude install boundary is not a regular file: ${current}`);
      }
    }
  };

  const sentinel = await readDestructiveSentinel(CLAUDE_DIR);
  const managedFiles = Object.keys(sentinel?.managed_files ?? {});
  const fileDestinations = new Set([
    ...currentClaudeManagedSourceFiles("full").map(({ destination }) => destination),
    ...managedFiles,
    "settings.json",
    ".cc-settings-version",
  ]);
  await assertBoundary(CLAUDE_DIR, "directory");
  await Promise.all([
    ...[
      "agents",
      "skills",
      "rules",
      "profiles",
      "docs",
      "hooks",
      "output-styles",
      "src",
      "backups",
      "tmp",
    ].map((path) => assertBoundary(join(CLAUDE_DIR, path), "directory")),
    ...[...fileDestinations].map((path) => assertBoundary(claudeManagedPath(path), "file")),
    assertBoundary(join(CLAUDE_DIR, "tmp", "install.lock"), "file"),
    assertBoundary(join(homedir(), ".claude.json"), "file"),
    assertBoundary(plistPath(homedir()), "file"),
  ]);
}

async function gitOutput(sourceDir: string, args: string[]): Promise<Buffer> {
  const child = Bun.spawn(["git", "-C", sourceDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Cannot inspect historical Claude ownership: ${stderr.trim() || args.join(" ")}`,
    );
  }
  return Buffer.from(stdout);
}

async function historicalClaudeOwnership(
  sourceDir: string,
  profile: Profile,
  version: string | undefined,
): Promise<Record<string, string>> {
  if (!version) {
    throw new Error(
      "Legacy Claude ownership has no installed version. Reinstall from the matching historical cc-settings checkout before upgrading.",
    );
  }
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commits = (
    await gitOutput(sourceDir, [
      "log",
      "--format=%H",
      `-G"version"[[:space:]]*:[[:space:]]*"${escapedVersion}"`,
      "--",
      "package.json",
    ])
  )
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  // -G matches diff lines in both directions, so a superseded version always
  // hits two commits: the one that introduced it and the release that removed
  // it. Keep only commits whose package.json actually carries the version.
  const carriers: string[] = [];
  for (const candidate of commits) {
    try {
      const manifest = JSON.parse(
        (await gitOutput(sourceDir, ["show", `${candidate}:package.json`])).toString("utf8"),
      ) as { version?: unknown };
      if (manifest.version === version) carriers.push(candidate);
    } catch {
      // Unreadable or unparsable historical manifest: not a trusted carrier.
    }
  }
  if (carriers.length !== 1) {
    throw new Error(
      `Legacy Claude ownership version ${version} does not resolve to exactly one trusted source commit. ` +
        "Use that version's checkout to reinstall once before upgrading.",
    );
  }
  const commit = carriers[0] as string;
  const selected =
    profile === "full"
      ? [
          "CLAUDE-FULL.md",
          "AGENTS.md",
          "agents",
          "skills",
          "profiles",
          "rules",
          "hooks",
          "docs",
          "output-styles",
          "src",
          "package.json",
          "tsconfig.json",
          "bun.lock",
        ]
      : ["skills/share-learning", "src", "package.json", "tsconfig.json", "bun.lock"];
  const listing = (await gitOutput(sourceDir, ["ls-tree", "-r", commit, "--", ...selected]))
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const sourceFiles: string[] = [];
  for (const line of listing) {
    const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(line);
    if (!match) throw new Error(`Unsafe historical Claude source entry: ${line}`);
    const path = match[2] as string;
    if (path.includes("/.tldr/") || path.endsWith("/.tldrignore")) continue;
    if (["src/package.json", "src/tsconfig.json", "src/bun.lock"].includes(path)) continue;
    sourceFiles.push(path);
  }
  const sourceToDestination = (path: string): string => {
    if (path === "CLAUDE-FULL.md") return "CLAUDE.md";
    if (path === "package.json") return "src/package.json";
    if (path === "tsconfig.json") return "src/tsconfig.json";
    if (path === "bun.lock") return "src/bun.lock";
    return path;
  };
  const ownership: Record<string, string> = {};
  for (const sourcePath of sourceFiles) {
    const destination = sourceToDestination(sourcePath);
    const expected = createHash("sha256")
      .update(await gitOutput(sourceDir, ["show", `${commit}:${sourcePath}`]))
      .digest("hex");
    if ((await regularFileHash(claudeManagedPath(destination))) !== expected) {
      throw new Error(
        `Historical Claude managed file is missing, unsafe, or modified: ${destination}. ` +
          "Restore the exact installed version before migrating.",
      );
    }
    ownership[destination] = expected;
  }
  return ownership;
}

async function isStrictLegacyGeneratedFile(relativePath: string): Promise<boolean> {
  const path = claudeManagedPath(relativePath);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return false;
  if (!metadata.isFile()) return false;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (relativePath === ".cc-settings-hooks-fingerprint") {
      const value = parsed as Record<string, unknown>;
      return (
        typeof value.hash === "string" &&
        /^[a-f0-9]{64}$/.test(value.hash) &&
        typeof value.installedAt === "string" &&
        typeof value.hooksCount === "number"
      );
    }
    if (relativePath === ".cc-settings-src-manifest") {
      const value = parsed as Record<string, unknown>;
      return (
        value.files !== null &&
        typeof value.files === "object" &&
        !Array.isArray(value.files) &&
        Object.values(value.files as Record<string, unknown>).every(
          (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
        )
      );
    }
    const value = parsed as Record<string, unknown>;
    return (
      value.settings !== null &&
      typeof value.settings === "object" &&
      !Array.isArray(value.settings)
    );
  } catch {
    return false;
  }
}

async function prepareClaudeInstallOwnership(
  sourceDir: string,
  profile: Profile,
  sentinel: Awaited<ReturnType<typeof readDestructiveSentinel>>,
  options: { validateTargetCollisions?: boolean; claimManagedAbsentGenerated?: boolean } = {},
): Promise<PreparedClaudeInstallOwnership> {
  const nodeModulesTarget = await validateClaudeNodeModulesOwnership(sentinel);
  let files: Record<string, string> = {};
  if (sentinel?.managed_files) {
    files = Object.fromEntries(
      Object.entries(sentinel.managed_files).map(([path, hash]) => [path, hash.toLowerCase()]),
    );
  } else if (
    sentinel?.managed_files_state === "managed-absent" &&
    options.claimManagedAbsentGenerated !== false
  ) {
    for (const generated of [
      ".cc-settings-hooks-fingerprint",
      ".cc-settings-src-manifest",
      ".cc-settings-baseline.json",
    ]) {
      if (await isStrictLegacyGeneratedFile(generated)) {
        const hash = await regularFileHash(claudeManagedPath(generated));
        if (hash) files[generated] = hash;
      }
    }
  } else if (sentinel) {
    files = await historicalClaudeOwnership(
      sourceDir,
      sentinel.profile ?? "full",
      sentinel.version,
    );
    for (const generated of [
      ".cc-settings-hooks-fingerprint",
      ".cc-settings-src-manifest",
      ...(sentinel.profile === "light" ? [] : [".cc-settings-baseline.json"]),
    ]) {
      const metadata = await lstat(claudeManagedPath(generated)).catch(() => null);
      if (metadata && !(await isStrictLegacyGeneratedFile(generated))) {
        throw new Error(`Historical Claude generated ownership file is modified: ${generated}`);
      }
      if (metadata) {
        const hash = await regularFileHash(claudeManagedPath(generated));
        if (hash) files[generated] = hash;
      }
    }
  }

  const targetPaths = new Set([
    ...currentClaudeManagedSourceFiles(profile).map(({ destination }) => destination),
    ".cc-settings-hooks-fingerprint",
    ".cc-settings-src-manifest",
    ...(profile === "full" ? [".cc-settings-baseline.json"] : []),
  ]);
  for (const relativePath of options.validateTargetCollisions === false ? [] : targetPaths) {
    const metadata = await lstat(claudeManagedPath(relativePath)).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    });
    if (!metadata) continue;
    const expectedHash = files[relativePath];
    const actualHash = metadata.isFile()
      ? await regularFileHash(claudeManagedPath(relativePath))
      : null;
    if (!expectedHash || actualHash !== expectedHash) {
      throw new Error(
        `Claude managed destination collision: ${relativePath}. ` +
          "Preserve or rename the file, or reinstall the owning historical version before upgrading.",
      );
    }
  }
  const targetPathList = options.validateTargetCollisions === false ? [] : [...targetPaths];
  return {
    files,
    nodeModulesTarget,
    targetPaths: targetPathList,
    snapshot: await captureClaudeLifecycleOwnership(files, targetPathList, nodeModulesTarget),
  };
}

async function hashInstalledProfileFiles(
  sourceDir: string,
  profile: Profile,
): Promise<Record<string, string>> {
  const managed: Record<string, string> = {};
  for (const [source, relativeDestination] of await profileFileMappings(sourceDir, profile)) {
    if ((await regularFileHash(source)) === null) continue;
    const installedHash = await regularFileHash(claudeManagedPath(relativeDestination));
    if (installedHash !== null) managed[relativeDestination] = installedHash;
  }
  return managed;
}

async function addGeneratedManagedFiles(
  managedFiles: Record<string, string> | null,
  profile: Profile,
): Promise<Record<string, string>> {
  const managed = { ...(managedFiles ?? {}) };
  for (const relativePath of [
    ".cc-settings-hooks-fingerprint",
    ".cc-settings-src-manifest",
    ...(profile === "full" ? [".cc-settings-baseline.json"] : []),
  ]) {
    const hash = await regularFileHash(claudeManagedPath(relativePath));
    if (hash === null) {
      throw new Error(`Claude generated ownership file is missing or unsafe: ${relativePath}`);
    }
    managed[relativePath] = hash;
  }
  return managed;
}

async function validateClaudeManagedFiles(
  managedFiles: Record<string, string> | null,
  sourceDir: string,
  profile: Profile,
  manifestVersion?: number,
): Promise<void> {
  if (!managedFiles) return;
  const inferredLegacy = manifestVersion === undefined;
  await validateClaudeManagedFileOwnership(
    managedFiles,
    sourceDir,
    profile,
    CLAUDE_DIR,
    inferredLegacy ? "exact" : "upgrade",
    manifestVersion ?? 1,
  );
  if (inferredLegacy) {
    for (const [relativePath, expectedHash] of Object.entries(managedFiles)) {
      if ((await regularFileHash(claudeManagedPath(relativePath))) !== expectedHash.toLowerCase()) {
        throw new Error(
          `Legacy Claude managed_files ownership does not match the live file: ${relativePath}. ` +
            "Reinstall cc-settings once to establish versioned ownership metadata.",
        );
      }
    }
  }
}

async function removeOwnedClaudeFiles(
  sourceDir: string,
  profile: Profile,
  managedFiles: Record<string, string> | null,
  manifestVersion?: number,
  nodeModulesTarget: string | null = null,
): Promise<void> {
  const candidates = new Map<string, string>();
  if (managedFiles) {
    await validateClaudeManagedFiles(managedFiles, sourceDir, profile, manifestVersion);
    for (const [relativePath, hash] of Object.entries(managedFiles)) {
      candidates.set(relativePath, hash.toLowerCase());
    }
  } else {
    for (const [source, relativeDestination] of await profileFileMappings(sourceDir, profile)) {
      const sourceHash = await regularFileHash(source);
      if (sourceHash !== null) candidates.set(relativeDestination, sourceHash);
    }
  }

  await removeClaudeFilesWithHashes(Object.fromEntries(candidates), nodeModulesTarget);
}

async function removeClaudeFilesWithHashes(
  managedFiles: Record<string, string>,
  expectedNodeModulesTarget: string | null,
): Promise<void> {
  const candidates = new Map(
    Object.entries(managedFiles).map(([relativePath, hash]) => [relativePath, hash.toLowerCase()]),
  );

  const removedPaths: string[] = [];
  for (const [relativePath, expectedHash] of candidates) {
    const destination = claudeManagedPath(relativePath);
    if ((await regularFileHash(destination)) !== expectedHash) continue;
    await rm(destination, { force: true });
    removedPaths.push(destination);
  }

  const installedNodeModules = claudeManagedPath(join("src", "node_modules"));
  try {
    await lstat(installedNodeModules);
    if (
      !expectedNodeModulesTarget ||
      !(await claudeNodeModulesMatches(installedNodeModules, expectedNodeModulesTarget))
    ) {
      throw new Error(
        "Claude managed destination collision: src/node_modules changed after ownership preflight.",
      );
    }
    await rm(installedNodeModules, { recursive: true, force: true });
    removedPaths.push(installedNodeModules);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }

  const directories = new Set<string>();
  for (const path of removedPaths) {
    let directory = resolve(path, "..");
    while (directory !== resolve(CLAUDE_DIR)) {
      directories.add(directory);
      directory = resolve(directory, "..");
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(directory);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw cause;
    }
  }
}

async function writeVersionSentinel(
  sourceDir: string,
  profile: Profile,
  engine: EngineDescriptor,
  autoUpdate: boolean | undefined,
  // Whether THIS run resolved the engine explicitly (env override, or a
  // previously-explicit sentinel) — see resolveEngine in code-intel-engine.ts.
  // ALWAYS written, true or false. Writing it unconditionally is what makes
  // ABSENCE mean exactly one thing: "stamped before this field existed". That
  // is the only case where resolveEngine falls back to inferring intent from
  // the engine id, so leaving the field out on `false` would make a fresh
  // implicit install indistinguishable from a legacy sentinel and wrongly pin
  // whatever the default happened to be.
  explicit: boolean,
  // cc-settings' definition of each managed MCP server as written this run.
  // Null on a light install or when no MCP block was installed.
  mcpWritten?: McpServers | null,
  managedFiles?: Record<string, string> | null,
  managedFilesManifestVersion: number | null = CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
  installedVersion: string | null = VERSION,
  managedFilesState?: "managed-absent",
): Promise<void> {
  const payload: Sentinel = {
    ...(installedVersion !== null ? { version: installedVersion } : {}),
    installed_at: new Date().toISOString(),
    // Where this install came from — lets the SessionStart drift check locate
    // the repo and compare the installed version against the packaged one.
    repo_path: sourceDir,
    profile,
    // Resolved code-intel engine id — read back by resolveEngine() so every
    // surface (hooks, next install) agrees on which engine backs `tldr`.
    engine: engine.id,
    engine_explicit: explicit,
    // cc-settings' own definition of EVERY managed server as of this run — lets
    // a LATER install's isStaleCcOutput recognize yesterday's output as ours
    // even after the shipped definition has since changed. Without it, the only
    // recognizable shapes are the ones the CURRENT code would generate, so any
    // edit to a server's definition orphans the entry it replaced: that entry
    // then matches nothing, reads as a hand-edit, and is preserved forever.
    // Recorded fact beats derived-from-code-that-may-have-changed.
    //
    // Records what WE ship, not what ended up on disk. Where the user's copy
    // shadowed ours (see installMcpToClaudeJson's return), disk holds theirs —
    // echoing that would make the next install recognize their customization as
    // our stale output and clobber it. Ours is the safe thing to remember: an
    // entry equal to what we shipped last time is unambiguously replaceable.
    //
    // FULL PROFILE ONLY. A light install REMOVES the managed servers
    // (removeManagedMcpServers), so recording what a full install would have
    // written would claim ownership of entries this run did not write — and a
    // later install could then misread a user's own entry as our stale output.
    // Omitting it is the safe direction: the worst case is one missed stale
    // match, which merely preserves an entry instead of clobbering one.
    ...(profile === "full" && mcpWritten ? { mcp_written: mcpWritten } : {}),
    ...(managedFiles ? { managed_files: managedFiles } : {}),
    ...(managedFilesManifestVersion !== null
      ? { managed_files_manifest_version: managedFilesManifestVersion }
      : {}),
    ...(managedFilesState ? { managed_files_state: managedFilesState } : {}),
    // Auto-update enrollment — omitted entirely when undecided (non-macOS, or
    // a non-interactive run with no prior decision) so "absent" never reads
    // as "declined". See decideAutoUpdate() in src/lib/schedule.ts.
    ...(autoUpdate !== undefined ? { auto_update: autoUpdate } : {}),
  };
  await writeSentinel(CLAUDE_DIR, payload);
}

// --- Status --------------------------------------------------------------

async function cmdStatus(sourceDir: string): Promise<number> {
  const data = await gatherStatus(sourceDir, installPaths(), VERSION);
  printStatus(data);
  return 0; // status is informational; never fail
}

function resolveInstallTarget(target: InstallTarget): Exclude<InstallTarget, "auto"> {
  if (target !== "auto") return target;
  return hasCommand("codex") ? "both" : "claude";
}

function includesTarget(
  target: Exclude<InstallTarget, "auto">,
  candidate: "claude" | "codex",
): boolean {
  return target === candidate || target === "both";
}

interface ClaudeInstalledVersionForGuard {
  version: string;
  usesHistoricalOwnership: boolean;
}

async function readClaudeInstalledVersionForGuard(): Promise<ClaudeInstalledVersionForGuard | null> {
  const sentinelPath = join(CLAUDE_DIR, ".cc-settings-version");
  let text: string;
  try {
    text = await readFile(sentinelPath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read Claude Code install metadata: ${sentinelPath}`, { cause });
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Claude Code install metadata is not valid JSON: ${sentinelPath}`, { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Claude Code install metadata has no valid version: ${sentinelPath}`);
  }
  const sentinel = value as Record<string, unknown>;
  const version = sentinel.version;
  if (version === undefined && sentinel.managed_files_state === "managed-absent") return null;
  if (typeof version !== "string") {
    throw new Error(`Claude Code install metadata has no valid version: ${sentinelPath}`);
  }
  return {
    version,
    usesHistoricalOwnership:
      sentinel.managed_files === undefined && sentinel.managed_files_state === undefined,
  };
}

async function normalInstallVersionGuard(target: Exclude<InstallTarget, "auto">): Promise<boolean> {
  if (!STRICT_VERSION.test(VERSION)) {
    error(`Packaged cc-settings version is invalid: ${VERSION}. Update or replace this checkout.`);
    return false;
  }

  const installedVersions: Array<{
    product: string;
    version: string | null;
    usesHistoricalOwnership: boolean;
  }> = [];
  if (includesTarget(target, "claude")) {
    const installed = await readClaudeInstalledVersionForGuard();
    installedVersions.push({
      product: "Claude Code",
      version: installed?.version ?? null,
      usesHistoricalOwnership: installed?.usesHistoricalOwnership ?? false,
    });
  }
  if (includesTarget(target, "codex")) {
    installedVersions.push({
      product: "Codex",
      version: await readCodexInstalledVersion(),
      usesHistoricalOwnership: false,
    });
  }

  for (const installed of installedVersions) {
    if (installed.version === null) continue;
    if (!STRICT_VERSION.test(installed.version)) {
      if (installed.usesHistoricalOwnership) continue;
      error(
        `${installed.product} has invalid installed version metadata (${installed.version}). Repair or remove its cc-settings sentinel before reinstalling.`,
      );
      return false;
    }
    if (compareVersion(installed.version, VERSION) > 0) {
      error(
        `${installed.product} has cc-settings v${installed.version}, which is newer than this source checkout (v${VERSION}). Update or replace the checkout before reinstalling, or use explicit --rollback for an intentional downgrade.`,
      );
      return false;
    }
  }
  return true;
}

async function printCodexStatus(sourceDir: string): Promise<void> {
  const data = await gatherCodexStatus({ sourceDir });
  console.log("Codex:");
  console.log(`  version: ${data.installedVersion ?? "not installed"}`);
  console.log(`  packaged version: ${data.packagedVersion ?? "unknown"}`);
  if (data.versionWarning) console.log(`  warning: ${data.versionWarning}`);
  console.log(`  profile: ${data.installedProfile ?? "unknown"}`);
  console.log(`  managed instructions: ${data.instructionBlockPresent ? "present" : "missing"}`);
  console.log(
    `  plugin: ${data.pluginInstalled === null ? "unknown" : data.pluginInstalled ? "installed" : "missing"}`,
  );
  console.log(`  native agents: ${data.nativeAgentCount}`);
  console.log(`  command rule: ${data.rulePresent ? "present" : "missing"}`);
  console.log(`  managed source: ${data.sourcePresent ? "present" : "missing"}`);
}

interface PreparedClaudeUninstall {
  sourceDir: string;
  sentinel: Sentinel;
  full: Awaited<ReturnType<typeof composeSettings>>;
  settingsPath: string;
  nodeModulesTarget: string | null;
  snapshot: ClaudeLifecycleOwnershipSnapshot;
}

async function prepareClaudeUninstall(sourceDir: string): Promise<PreparedClaudeUninstall | null> {
  const sentinelState = await readDestructiveSentinel(CLAUDE_DIR);
  if (sentinelState === null) return null;
  const sentinel = sentinelState;
  const nodeModulesTarget = await validateClaudeNodeModulesOwnership(sentinel);
  await validateClaudeManagedFiles(
    sentinel.managed_files_state === "managed-absent" ? null : (sentinel.managed_files ?? {}),
    sourceDir,
    sentinel.profile ?? "full",
    sentinel.managed_files_manifest_version,
  );
  const full = await composeSettings(sourceDir);
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  // Parse every config the uninstall may rewrite before another product is
  // mutated. The cleanup helpers read again during execution, but deterministic
  // corrupt-state failures have already failed closed here.
  await Promise.all([readJsonOrNull(settingsPath), readJsonOrNull(CLAUDE_JSON_PATH)]);
  const managedFiles =
    sentinel.managed_files_state === "managed-absent" ? {} : (sentinel.managed_files ?? {});
  const snapshot = await captureClaudeLifecycleOwnership(
    managedFiles,
    Object.keys(managedFiles),
    nodeModulesTarget,
  );
  return { sourceDir, sentinel, full, settingsPath, nodeModulesTarget, snapshot };
}

async function uninstallClaude(
  prepared: PreparedClaudeUninstall,
  preserveIndependentScheduler = false,
  schedulerPhase?: {
    before: () => Promise<void>;
    after: () => Promise<void>;
  },
): Promise<void> {
  const { sourceDir, sentinel, full, settingsPath, nodeModulesTarget, snapshot } = prepared;
  await assertClaudeLifecycleOwnershipUnchanged(snapshot);
  const teamMcp = structuredClone(full.mcpServers ?? {}) as McpServers;
  await pruneSettingsMcpServers(settingsPath, teamMcp, sentinel.mcp_written);
  const current = await readJsonOrNull(settingsPath);
  if (current !== null && typeof current === "object" && !Array.isArray(current)) {
    const { mcpServers: _managedMcp, ...settingsWithoutMcp } = full;
    const cleaned = stripManagedSettings(current as Record<string, unknown>, settingsWithoutMcp);
    for (const key of ["$schema", "statusLine"] as const) {
      if (key in cleaned && JSON.stringify(cleaned[key]) === JSON.stringify(full[key])) {
        delete cleaned[key];
      }
    }
    await atomicWriteJson(settingsPath, cleaned);
  }
  await removeManagedMcpServers(full, CLAUDE_JSON_PATH, sentinel.mcp_written);
  await removeOwnedClaudeFiles(
    sourceDir,
    sentinel.profile ?? "full",
    sentinel.managed_files_state === "managed-absent" ? {} : (sentinel.managed_files ?? null),
    sentinel.managed_files_manifest_version,
    nodeModulesTarget,
  );
  await schedulerPhase?.before();
  const [, scheduleRemoval] = await Promise.all([
    rm(join(CLAUDE_DIR, ".cc-settings-version"), { force: true }),
    preserveIndependentScheduler
      ? Promise.resolve({ ok: true, removed: false })
      : unregisterAutoUpdate(),
  ]);
  if (!scheduleRemoval.ok) throw new Error("Failed to remove the cc-settings auto-update job");
  await schedulerPhase?.after();
}

async function restoreCombinedAfterClaudeFailure(
  claudeCompensation: PreparedClaudeRollback | null,
  codexCompensation: string | null,
  autoUpdateSnapshot: AutoUpdateStateSnapshot | null,
  cause: unknown,
  claudePhase: ClaudeMutationPhase,
  claudeSharedDrift: ClaudeSharedExplicitDrift = {},
): Promise<void> {
  const restoreFailures: unknown[] = [];
  if (codexCompensation) {
    try {
      await restoreCodexCompensation(codexCompensation);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase !== "unstarted" && claudeCompensation) {
    try {
      await claudeCompensation.execute();
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase === "scheduler") {
    try {
      await restoreAutoUpdateState(autoUpdateSnapshot);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (claudePhase !== "unstarted") {
    try {
      await restoreClaudeSharedExplicitDrift(claudeSharedDrift);
    } catch (restoreCause) {
      restoreFailures.push(restoreCause);
    }
  }
  if (restoreFailures.length > 0) {
    throw new AggregateError(
      [cause, ...restoreFailures],
      "Combined Claude/Codex operation failed and exact compensation was incomplete",
    );
  }
}

async function restoreCodexAfterClaudePrewriteChange(
  codexCompensation: string | null,
  cause: ClaudePrewriteOwnershipChangedError,
  operation: "install" | "uninstall",
): Promise<void> {
  if (!codexCompensation) return;
  try {
    await restoreCodexCompensation(codexCompensation);
  } catch (restoreCause) {
    throw new AggregateError(
      [cause, restoreCause],
      `Combined ${operation} detected a concurrent Claude edit and Codex compensation failed`,
    );
  }
}

async function runSelectedRollback(
  target: Exclude<InstallTarget, "auto">,
  backup: string | true,
  sourceDir: string,
): Promise<number> {
  let selectedBackup = backup;
  if (target === "both") {
    const [claudeIds, codexIds] = await Promise.all([
      listClaudeSharedBackupIds(),
      listCodexSharedBackupIds(),
    ]);
    const codexIdSet = new Set(codexIds);
    const commonIds = claudeIds.filter((id) => codexIdSet.has(id));
    if (backup === true) {
      const newestCommonId = commonIds[0];
      if (!newestCommonId) {
        throw new Error("No paired Claude/Codex backup found for combined rollback");
      }
      selectedBackup = newestCommonId;
    } else {
      const matches = commonIds.filter((id) => id.includes(backup));
      if (matches.length === 0) {
        throw new Error(
          `No paired Claude/Codex backup matches ${backup}. Available paired backups: ${commonIds.slice(0, 5).join(", ") || "none"}`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `Paired Claude/Codex backup target ${backup} is ambiguous. Use a longer or full backup ID.`,
        );
      }
      selectedBackup = matches[0] as string;
    }
  }
  let claudePhase: ClaudeMutationPhase = "unstarted";
  let schedulerSharedBaseline: ClaudeSharedExplicitSnapshot | null = null;
  let claudeSharedDrift: ClaudeSharedExplicitDrift = {};
  const schedulerPhase = {
    before: async (): Promise<void> => {
      schedulerSharedBaseline = await captureClaudeSharedExplicitState();
      claudePhase = "scheduler";
    },
    after: async (): Promise<void> => {
      if (!schedulerSharedBaseline) return;
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDrift(schedulerSharedBaseline)),
      };
      schedulerSharedBaseline = null;
    },
  };
  const claudePreparation = includesTarget(target, "claude")
    ? await prepareClaudeRollback(selectedBackup, {
        prepareManagedAbsent: async () => {
          const prepared = await prepareClaudeUninstall(sourceDir);
          let execution: Promise<number> | null = null;
          return {
            execute: () => {
              execution ??= prepared
                ? uninstallClaude(prepared, false, schedulerPhase).then(() => 0)
                : Promise.resolve(0);
              return execution;
            },
            cleanup: async () => {},
          };
        },
        schedulerPhase,
      })
    : null;
  if (typeof claudePreparation === "number") return claudePreparation;

  let claudeCompensation: PreparedClaudeRollback | null = null;
  let codexCompensation: string | null = null;
  let restoredCodexBackup: string | null = null;
  let claudeCode = 0;
  let autoUpdateSnapshot: AutoUpdateStateSnapshot | null = null;
  let compensationAttempted = false;
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  const compensate = async (cause: unknown): Promise<void> => {
    compensationAttempted = true;
    if (cause instanceof ClaudePrewriteOwnershipChangedError) {
      if (!codexCompensation) return;
      try {
        await restoreCodexCompensation(codexCompensation);
      } catch (restoreCause) {
        throw new AggregateError(
          [cause, restoreCause],
          "Combined rollback detected a concurrent Claude edit and Codex compensation failed",
        );
      }
      return;
    }
    if (claudePhase === "scheduler" && schedulerSharedBaseline) {
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDriftAfterFailure(schedulerSharedBaseline)),
      };
    }
    await restoreCombinedAfterClaudeFailure(
      claudeCompensation,
      codexCompensation,
      autoUpdateSnapshot,
      cause,
      claudePhase,
      claudeSharedDrift,
    );
  };
  try {
    if (claudePreparation) {
      autoUpdateSnapshot = await snapshotAutoUpdateState();
      if (target === "both") {
        await createBackup({
          preserveBackupName: claudePreparation?.selectedArchiveName,
          backupId,
        });
      }
      claudeCompensation = await prepareClaudeCompensation(
        await createBackup({ temporary: true, backupId }),
        claudePreparation.targetManagedPaths,
      );
    }
    if (includesTarget(target, "codex")) {
      const result = await rollbackCodex({ target: selectedBackup, backupId });
      codexCompensation = result.compensationBackup;
      restoredCodexBackup = result.restoredBackup;
    }
    if (claudePreparation) {
      claudePhase = "files";
      claudeCode = await claudePreparation.execute();
    }
    if (claudeCode !== 0) {
      if (claudeCompensation || codexCompensation) {
        await compensate(new Error(`Claude rollback exited ${claudeCode}`));
      }
      return claudeCode;
    }
  } catch (cause) {
    if (!compensationAttempted && (claudeCompensation || codexCompensation)) {
      await compensate(cause);
    }
    throw cause;
  } finally {
    await claudePreparation?.cleanup();
    await claudeCompensation?.cleanup();
  }
  if (restoredCodexBackup) success(`Codex restored from backup ${restoredCodexBackup}`);
  return 0;
}

async function runSelectedUninstall(
  target: Exclude<InstallTarget, "auto">,
  sourceDir: string,
): Promise<number> {
  const claudePreparation = includesTarget(target, "claude")
    ? await prepareClaudeUninstall(sourceDir)
    : null;
  let claudeCompensation: PreparedClaudeRollback | null = null;
  let codexCompensation: string | null = null;
  let autoUpdateSnapshot: AutoUpdateStateSnapshot | null = null;
  let claudeSharedDrift: ClaudeSharedExplicitDrift = {};
  let schedulerSharedBaseline: ClaudeSharedExplicitSnapshot | null = null;
  let claudePhase: ClaudeMutationPhase = "unstarted";
  const currentClaudePhase = (): ClaudeMutationPhase => claudePhase;
  const backupId = target === "both" ? createSharedBackupId() : undefined;
  try {
    if (includesTarget(target, "claude") && target === "both") {
      await createBackup({ backupId, managedAbsent: claudePreparation === null });
    }
    if (claudePreparation) {
      autoUpdateSnapshot = await snapshotAutoUpdateState();
      claudeCompensation = await prepareClaudeCompensation(
        await createBackup({ temporary: true, backupId }),
      );
    }
    const claudeSharedBaseline = claudePreparation
      ? await captureClaudeSharedExplicitState()
      : null;
    if (includesTarget(target, "codex")) {
      codexCompensation = await uninstallCodex({ sourceDir, backupId });
    }
    if (claudeSharedBaseline) {
      claudeSharedDrift = await captureClaudeSharedExplicitDrift(claudeSharedBaseline);
    }
    if (claudePreparation) {
      claudePhase = "files";
      await uninstallClaude(
        claudePreparation,
        autoUpdateSnapshot?.restoreMode === "independent-preserve-only",
        {
          before: async () => {
            schedulerSharedBaseline = await captureClaudeSharedExplicitState();
            claudePhase = "scheduler";
          },
          after: async () => {
            if (!schedulerSharedBaseline) return;
            claudeSharedDrift = {
              ...claudeSharedDrift,
              ...(await captureClaudeSharedExplicitDrift(schedulerSharedBaseline)),
            };
            schedulerSharedBaseline = null;
          },
        },
      );
    }
  } catch (cause) {
    if (cause instanceof ClaudePrewriteOwnershipChangedError) {
      await restoreCodexAfterClaudePrewriteChange(codexCompensation, cause, "uninstall");
      throw cause;
    }
    if (currentClaudePhase() === "scheduler" && schedulerSharedBaseline) {
      claudeSharedDrift = {
        ...claudeSharedDrift,
        ...(await captureClaudeSharedExplicitDriftAfterFailure(schedulerSharedBaseline)),
      };
    }
    if (claudeCompensation || codexCompensation) {
      await restoreCombinedAfterClaudeFailure(
        claudeCompensation,
        codexCompensation,
        autoUpdateSnapshot,
        cause,
        currentClaudePhase(),
        claudeSharedDrift,
      );
    }
    throw cause;
  } finally {
    await claudeCompensation?.cleanup();
  }
  success(`Removed cc-settings from ${target === "both" ? "Claude and Codex" : target}`);
  return 0;
}

// --- Main ----------------------------------------------------------------

/**
 * Run the full install path: deps → backup → dirs → clean → light-incompatible
 * removal → file copy → TS source copy → src manifest.
 *
 * PHASE ORDER IS CORRECTNESS-CRITICAL:
 *   clean before copy; fingerprint after settings write; manifest write for
 *   tamper defense. Do not reorder.
 */
async function runFullInstall(
  args: Args,
  engine: EngineDescriptor,
  priorManagedFiles: Record<string, string>,
  priorNodeModulesTarget: string | null,
  ownershipSnapshot: ClaudeLifecycleOwnershipSnapshot,
  backup: boolean = true,
  backupId?: string,
): Promise<Record<string, string>> {
  // Preflight BEFORE any destructive step. A bad --source (partial checkout,
  // wrong path) must abort here — while the existing install is still intact —
  // not after cleanOldConfig() has already wiped the managed footprint. Two
  // pre-clean gates: the source footprint is complete for this profile, and the
  // config/ fragments compose to a valid settings.json. composeSettings is
  // side-effect-free and runs again inside installSettings; the redundant read
  // of four small JSON files is a deliberate trade for a fail-closed guard.
  preflightInstallSource(args.sourceDir, args.profile);
  await composeSettings(args.sourceDir);

  info("Installing dependencies...");
  await installDependencies(args.profile, engine);
  await installPinnedTools(args.profile);
  printPreflightReport(checkCliTools());

  await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  if (backup) {
    info("Creating backup...");
    await createBackup({ backupId, managedFiles: priorManagedFiles });
    await assertClaudeLifecycleOwnershipUnchanged(ownershipSnapshot);
  }

  info("Installing configuration...");
  await removeClaudeFilesWithHashes(priorManagedFiles, priorNodeModulesTarget);
  await createDirectories();
  // Disjoint destination trees (config dirs vs ~/.claude/src), so install both
  // in parallel. Both must follow the clean above. For light, installConfigFiles
  // owns the full footprint: it copies the LIGHT_SKILLS subset and prunes every
  // full-only target (CLAUDE.md, AGENTS.md, agents/, rules/, profiles/, docs/).
  await Promise.all([
    installConfigFiles(args.sourceDir, args.profile),
    installTsSources(args.sourceDir),
  ]);
  // Content manifest of the just-installed ~/.claude/src tree — the
  // supply-chain layer that catches dropped/patched script content. A failed
  // write aborts because the sentinel must never claim missing metadata.
  const managedRuntimeFiles = currentClaudeManagedSourceFiles(args.profile)
    .map(({ destination }) => destination)
    .filter((destination) => destination.startsWith("src/"))
    .map((destination) => destination.slice("src/".length));
  await writeSrcManifest(join(CLAUDE_DIR, "src"), CLAUDE_DIR, managedRuntimeFiles);
  return await hashInstalledProfileFiles(args.sourceDir, args.profile);
}

function installLockPaths(target: Exclude<InstallTarget, "auto">): string[] {
  const paths: string[] = [];
  if (includesTarget(target, "claude")) paths.push(join(CLAUDE_DIR, "tmp", "install.lock"));
  if (includesTarget(target, "codex")) {
    paths.push(join(codexInstallPaths().codexHome, "tmp", "install.lock"));
  }
  return [...new Set(paths)].sort();
}

/** Run fn while holding the selected products' install locks.
 *  Returns 1 with a message if another install already holds it; otherwise
 *  returns fn's exit code and releases locks in reverse acquisition order. */
async function underInstallLock(
  target: Exclude<InstallTarget, "auto">,
  fn: () => Promise<number>,
): Promise<number> {
  if (includesTarget(target, "claude")) await validateClaudeInstallBoundaries();
  if (includesTarget(target, "codex")) await validateCodexInstallBoundaries();
  const releases: Array<() => Promise<void>> = [];
  try {
    for (const lockPath of installLockPaths(target)) {
      releases.push(await acquireInstallLock(lockPath));
    }
  } catch (err) {
    for (const release of releases.reverse()) await release();
    if (err instanceof InstallLockError) {
      error(err.message);
      return 1;
    }
    throw err;
  }
  try {
    return await fn();
  } finally {
    for (const release of releases.reverse()) await release();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp(VERSION);
    return 0;
  }
  if (args.errors.length > 0) {
    for (const message of args.errors) error(message);
    return 1;
  }
  let target = resolveInstallTarget(args.target);
  if (includesTarget(target, "codex")) {
    await validateProductRootDisjointness(CLAUDE_DIR);
  }
  if (args.status) {
    if (includesTarget(target, "claude")) {
      if (target === "both") console.log("Claude:");
      await cmdStatus(args.sourceDir);
    }
    if (includesTarget(target, "codex")) {
      if (target === "both") console.log("");
      await printCodexStatus(args.sourceDir);
    }
    return 0;
  }
  if (args.rollback !== null) {
    // Rollback now deletes + restores the managed footprint, so it takes the
    // same lock as an install to avoid racing a concurrent setup run.
    const backup = args.rollback;
    return await underInstallLock(target, () =>
      runSelectedRollback(target, backup, args.sourceDir),
    );
  }
  if (args.uninstall) {
    if (includesTarget(target, "claude")) {
      const destructiveSentinel = await readDestructiveSentinel(CLAUDE_DIR);
      await validateClaudeManagedFiles(
        destructiveSentinel === null ? null : (destructiveSentinel.managed_files ?? {}),
        args.sourceDir,
        destructiveSentinel?.profile ?? "full",
        destructiveSentinel?.managed_files_manifest_version,
      );
    }
    return await underInstallLock(target, () => runSelectedUninstall(target, args.sourceDir));
  }

  if (args.migrateOnly && target === "codex") {
    error("--migrate-only is Claude-only; use --target=claude or omit --migrate-only");
    return 1;
  }
  if (args.migrateOnly && target === "both") {
    info("--migrate-only is Claude-only; skipping Codex");
    target = "claude";
  }

  if (!(await normalInstallVersionGuard(target))) return 1;

  if (args.dryRun) {
    if (includesTarget(target, "claude")) await cmdDryRun(args.sourceDir, args.profile, VERSION);
    if (includesTarget(target, "codex")) {
      const actions = await dryRunCodex({ sourceDir: args.sourceDir, profile: args.profile });
      if (target === "both") console.log("");
      console.log("Codex dry run:");
      for (const action of actions) console.log(`  - ${action}`);
    }
    return 0;
  }

  if (
    args.profile === "full" &&
    includesTarget(target, "codex") &&
    !isCodexCliSkippedForTests() &&
    !hasCommand("codex")
  ) {
    error("Codex CLI is required for a full Codex install");
    return 1;
  }

  if (isWindows()) {
    warn("Windows is supported via setup.ps1 bootstrap; direct invocation is experimental.");
  }

  const product =
    target === "claude" ? "Claude Code" : target === "codex" ? "Codex" : "Claude Code + Codex";
  showBanner(VERSION, product);

  // Validate the complete Codex source before either target mutates disk. The
  // lifecycle repeats this preflight immediately before its own backup so a
  // source changed concurrently still fails closed.
  if (includesTarget(target, "codex")) {
    await dryRunCodex({ sourceDir: args.sourceDir, profile: args.profile });
  }
  if (includesTarget(target, "claude")) {
    if (!args.migrateOnly) preflightInstallSource(args.sourceDir, args.profile);
    await composeSettings(args.sourceDir);
    if (target === "both") {
      await Promise.all([
        readJsonOrNull(join(CLAUDE_DIR, "settings.json")),
        readJsonOrNull(CLAUDE_JSON_PATH),
      ]);
    }
  }

  if (!includesTarget(target, "claude")) {
    const installCode = await underInstallLock(target, async () => {
      if (!(await normalInstallVersionGuard(target))) return 1;
      await installCodex({
        sourceDir: args.sourceDir,
        version: VERSION,
        profile: args.profile,
      });
      return 0;
    });
    if (installCode !== 0) return installCode;
    await printCodexStatus(args.sourceDir);
    console.log("");
    console.log(`Installed to: ${palette.cyan}${codexInstallPaths().codexHome}${palette.reset}`);
    console.log("");
    info("Rollback if needed: bun src/setup.ts --target=codex --rollback");
    success("Restart Codex to apply changes.");
    console.log("");
    return 0;
  }

  // Single sentinel read for the whole run (N10) — version (for the
  // version-delta summary), autoUpdate (prior enrollment decision), and the
  // engine id all come from the same on-disk read instead of three
  // sequential ones. Captured BEFORE we overwrite the sentinel later.
  const priorDestructiveSentinel = await readDestructiveSentinel(CLAUDE_DIR);
  if (priorDestructiveSentinel?.managed_files) {
    await validateClaudeManagedFiles(
      priorDestructiveSentinel.managed_files,
      args.sourceDir,
      priorDestructiveSentinel.profile ?? "full",
      priorDestructiveSentinel.managed_files_manifest_version,
    );
  }
  const preparedClaudeInstallOwnership = await prepareClaudeInstallOwnership(
    args.sourceDir,
    args.migrateOnly ? (priorDestructiveSentinel?.profile ?? args.profile) : args.profile,
    priorDestructiveSentinel,
    args.migrateOnly ? { validateTargetCollisions: false, claimManagedAbsentGenerated: false } : {},
  );
  const sentinel = await readSentinelInfo(CLAUDE_DIR);
  const sentinelState = await readSentinel(CLAUDE_DIR);
  const enrolledRepoPath = await resolveEnrolledRepoPath(args.sourceDir);
  const prevInstalledVersion = sentinel.version;
  const priorAutoUpdate = sentinel.autoUpdate;
  // Prior install's exact echo of what it wrote to ~/.claude.json's
  // engine-managed servers — captured BEFORE writeVersionSentinel overwrites
  // the sentinel below (see FIX B: mcp.ts isStaleCcOutput's priorWritten arg).
  const priorMcpWritten = sentinel.mcpWritten;

  // Resolve the code-intel engine once (env > explicit prior sentinel >
  // default) and thread it through dependency install, settings, and the
  // sentinel write. See resolveEngine's precedence doc in code-intel-engine.ts.
  const { engine, explicit: engineExplicit } = await resolveEngine(CLAUDE_DIR, sentinel);

  // Frontmatter validation — catches typos in agents/*.md and skills/*/SKILL.md
  // before we ship them to ~/.claude/. Non-fatal; warn and continue so a single
  // bad agent doesn't block the rest of the install.
  const fmIssues = await validateFrontmatters(args.sourceDir).catch(() => []);
  const fmWarning = formatFrontmatterIssues(fmIssues);
  if (fmWarning) warn(fmWarning);

  // Serialize the destructive install region (dispatch → sentinel write)
  // against a concurrent run — a manual setup.sh racing the scheduled
  // auto-updater's setup invocation would otherwise interleave rm/cp over
  // ~/.claude. The read-only display below the lock release is race-safe.
  // Shipped MCP servers whose definition the user's own copy shadowed. Assigned
  // inside the lock, read by the summary after it releases.
  let mcpOverridden: string[] = [];
  // cc-settings' definition of each managed server this run — stamped into the
  // sentinel so a later install can recognize it as our own prior output.
  let mcpWritten: McpServers | null = null;
  let managedFiles = sentinelState.managed_files ?? null;
  const installCode = await underInstallLock(target, async () => {
    if (!(await normalInstallVersionGuard(target))) return 1;
    let claudeCompensation: PreparedClaudeRollback | null = null;
    let codexCompensation: string | null = null;
    let autoUpdateSnapshot: AutoUpdateStateSnapshot | null = null;
    let claudeSharedDrift: ClaudeSharedExplicitDrift = {};
    let schedulerSharedBaseline: ClaudeSharedExplicitSnapshot | null = null;
    let compensationAttempted = false;
    let claudePhase: ClaudeMutationPhase = "unstarted";
    const backupId = target === "both" ? createSharedBackupId() : undefined;
    const compensate = async (cause: unknown): Promise<void> => {
      compensationAttempted = true;
      if (cause instanceof ClaudePrewriteOwnershipChangedError) {
        await restoreCodexAfterClaudePrewriteChange(codexCompensation, cause, "install");
        return;
      }
      if (claudePhase === "scheduler" && schedulerSharedBaseline) {
        claudeSharedDrift = {
          ...claudeSharedDrift,
          ...(await captureClaudeSharedExplicitDriftAfterFailure(schedulerSharedBaseline)),
        };
      }
      await restoreCombinedAfterClaudeFailure(
        claudeCompensation,
        codexCompensation,
        autoUpdateSnapshot,
        cause,
        claudePhase,
        claudeSharedDrift,
      );
    };
    try {
      autoUpdateSnapshot = await snapshotAutoUpdateState();
      assertAutoUpdateRequestDoesNotClaimIndependentState(args, autoUpdateSnapshot);
      claudeCompensation = await prepareClaudeCompensation(
        await createBackup({
          temporary: true,
          backupId,
          managedFiles: preparedClaudeInstallOwnership.files,
        }),
        preparedClaudeInstallOwnership.targetPaths,
      );
      const claudeSharedBaseline = await captureClaudeSharedExplicitState();
      if (includesTarget(target, "codex")) {
        codexCompensation = await installCodex({
          sourceDir: args.sourceDir,
          version: VERSION,
          profile: args.profile,
          backupId,
        });
      }
      claudeSharedDrift = await captureClaudeSharedExplicitDrift(claudeSharedBaseline);

      claudePhase = "files";
      const claudeCode = await (async (): Promise<number> => {
        // Dispatch to migrate-only or full install path.
        if (args.migrateOnly) {
          info("Migrate-only: backup + merger + sentinel; skipping file copy");
          await assertClaudeLifecycleOwnershipUnchanged(preparedClaudeInstallOwnership.snapshot);
          await createBackup({ managedFiles: preparedClaudeInstallOwnership.files });
          await assertClaudeLifecycleOwnershipUnchanged(preparedClaudeInstallOwnership.snapshot);
          await createDirectories(); // idempotent — ensures ~/.claude/ shape exists for merger
        } else {
          managedFiles = await runFullInstall(
            args,
            engine,
            preparedClaudeInstallOwnership.files,
            preparedClaudeInstallOwnership.nodeModulesTarget,
            preparedClaudeInstallOwnership.snapshot,
            true,
            backupId,
          );
        }

        try {
          ({ overridden: mcpOverridden, mcpWritten } = await installSettings(
            args.sourceDir,
            args.interactive,
            args.profile,
            engine,
            priorMcpWritten,
          ));
        } catch (err) {
          // JsonParseError is the one we want to surface loudly — see lib/json-io.ts.
          if (err instanceof JsonParseError) {
            error(String((err as Error).message));
            error("Aborting. Fix the corrupt JSON or rollback: bun src/setup.ts --rollback");
            return 1;
          }
          throw err;
        }

        schedulerSharedBaseline = await captureClaudeSharedExplicitState();
        claudePhase = "scheduler";
        const autoUpdateEnrolled = await applyAutoUpdate(
          args,
          priorAutoUpdate,
          autoUpdateSnapshot,
          enrolledRepoPath,
        );
        claudeSharedDrift = {
          ...claudeSharedDrift,
          ...(await captureClaudeSharedExplicitDrift(schedulerSharedBaseline)),
        };
        schedulerSharedBaseline = null;
        if (args.profile === "light" && priorDestructiveSentinel?.profile === "full") {
          const baselinePath = claudeManagedPath(".cc-settings-baseline.json");
          const baselineHash =
            priorDestructiveSentinel.managed_files?.[".cc-settings-baseline.json"];
          if (baselineHash && (await regularFileHash(baselinePath)) === baselineHash) {
            await rm(baselinePath, { force: true });
          }
        }
        if (!args.migrateOnly || managedFiles) {
          const refreshedGenerated = await addGeneratedManagedFiles(managedFiles, args.profile);
          managedFiles = args.migrateOnly
            ? Object.fromEntries(
                Object.entries(refreshedGenerated).filter(([path]) => path in (managedFiles ?? {})),
              )
            : refreshedGenerated;
        }
        await writeVersionSentinel(
          enrolledRepoPath,
          args.profile,
          engine,
          autoUpdateEnrolled,
          engineExplicit,
          mcpWritten,
          managedFiles,
          args.migrateOnly
            ? (priorDestructiveSentinel?.managed_files_manifest_version ?? null)
            : CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION,
          args.migrateOnly ? (priorDestructiveSentinel?.version ?? null) : VERSION,
          args.migrateOnly &&
            !managedFiles &&
            (!priorDestructiveSentinel ||
              priorDestructiveSentinel.managed_files_state === "managed-absent")
            ? "managed-absent"
            : undefined,
        );
        return 0;
      })();
      if (claudeCode !== 0) {
        await compensate(new Error(`Claude install exited ${claudeCode}`));
      }
      return claudeCode;
    } catch (cause) {
      if (!compensationAttempted && (claudeCompensation || codexCompensation)) {
        await compensate(cause);
      }
      throw cause;
    } finally {
      await claudeCompensation?.cleanup();
    }
  });
  if (installCode !== 0) return installCode;

  if (!args.migrateOnly) await showSummary(args.profile, args.sourceDir, mcpOverridden);
  if (includesTarget(target, "codex")) {
    console.log("");
    await printCodexStatus(args.sourceDir);
  }

  // Version delta: surface what just landed (prev → current + per-version
  // titles from CHANGELOG.md). Uses prevInstalledVersion captured BEFORE
  // writeVersionSentinel ran — the sentinel now holds the new version.
  const changelogPath = join(args.sourceDir, "CHANGELOG.md");
  const delta = await buildVersionDelta(prevInstalledVersion, VERSION, changelogPath).catch(
    () => null,
  );
  if (delta) {
    console.log("");
    console.log(delta);
  }

  // Skill prereq check: warn if any installed skill declares `requires:` for
  // a CLI / MCP that's missing from the user's environment. Non-fatal — the
  // skill simply fails at runtime if the user invokes it without the prereq.
  const skillsDir = join(CLAUDE_DIR, "skills");
  const prereqReports = await reportMissingPrereqs(skillsDir).catch(() => []);
  const prereqWarnings = formatPrereqWarnings(prereqReports);
  if (prereqWarnings) {
    console.log("");
    warn(prereqWarnings);
  }

  console.log("");
  console.log(`Installed to: ${palette.cyan}${CLAUDE_DIR}${palette.reset}`);
  if (includesTarget(target, "codex")) {
    console.log(
      `Codex installed to: ${palette.cyan}${codexInstallPaths().codexHome}${palette.reset}`,
    );
  }
  console.log("");
  info(`Rollback if needed: bun src/setup.ts --target=${target} --rollback`);
  success(
    `Restart ${target === "both" ? "Claude Code and Codex" : "Claude Code"} to apply changes.`,
  );
  console.log("");
  return 0;
}

// Only run main() when invoked directly.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      const detail =
        err instanceof Error
          ? [err.message, err.stack]
              .filter((value, index, all) => value && all.indexOf(value) === index)
              .join("\n")
          : String(err);
      error(`Setup failed: ${detail}`);
      process.exit(1);
    });
}
