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
//   --fresh            Reinstall as if from scratch: removes settings.json,
//                      prior-install state, and the repo's local approvals,
//                      then installs the full baseline. Login, history, and
//                      memory untouched. Recover with --rollback.
//   --help, -h         Usage.

import { existsSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  addGeneratedManagedFiles,
  assertClaudeLifecycleOwnershipUnchanged,
  type ClaudeMutationPhase,
  type ClaudeSharedExplicitDrift,
  type ClaudeSharedExplicitSnapshot,
  captureClaudeSharedExplicitDrift,
  captureClaudeSharedExplicitDriftAfterFailure,
  captureClaudeSharedExplicitState,
  claudeManagedPath,
  prepareClaudeInstallOwnership,
  regularFileHash,
  validateClaudeManagedFiles,
  writeVersionSentinel,
} from "./lib/claude-install-ownership.ts";
import { installSettings } from "./lib/claude-install-settings.ts";
import { CURRENT_CLAUDE_MANAGED_FILES_MANIFEST_VERSION } from "./lib/claude-managed-files.ts";
import { resolveEngine } from "./lib/code-intel-engine.ts";
import {
  codexCliAvailable,
  codexInstallPaths,
  dryRunCodex,
  gatherCodexStatus,
  installCodex,
  isCodexCliSkippedForTests,
  readCodexInstalledVersion,
  validateProductRootDisjointness,
} from "./lib/codex-install.ts";
import { error, info, palette, progressArrow, showBanner, success, warn } from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import { formatFrontmatterIssues, validateFrontmatters } from "./lib/frontmatter-validate.ts";
import { FINGERPRINT_FILENAME } from "./lib/hooks-fingerprint.ts";
import {
  ClaudePrewriteOwnershipChangedError,
  type PreparedClaudeRollback,
  prepareClaudeCompensation,
  printHelp,
} from "./lib/install-cmds.ts";
import { cmdDryRun, printStatus, showSummary } from "./lib/install-display.ts";
import { createBackup, createDirectories, preflightInstallSource } from "./lib/install-fs.ts";
import {
  applyAutoUpdate,
  assertAutoUpdateRequestDoesNotClaimIndependentState,
  createSharedBackupId,
  resolveEnrolledRepoPath,
  restoreCodexAfterClaudePrewriteChange,
  restoreCombinedAfterClaudeFailure,
  runFullInstall,
  runSelectedRollback,
  runSelectedUninstall,
  underInstallLock,
} from "./lib/install-lifecycle.ts";
import { type InstallArgs, type InstallTarget, includesTarget } from "./lib/install-types.ts";
import { JsonParseError, readJsonOrNull } from "./lib/json-io.ts";
import { CLAUDE_JSON_PATH, type McpServers, removeManagedMcpServers } from "./lib/mcp.ts";
import { CLAUDE_DIR, getTimestamp, installPaths, isWindows } from "./lib/platform.ts";
import { promptYn } from "./lib/prompts.ts";
import { type AutoUpdateStateSnapshot, snapshotAutoUpdateState } from "./lib/schedule.ts";
import {
  BASELINE_FILENAME,
  readSettingsBaseline,
  type SettingsBaseline,
} from "./lib/settings-baseline.ts";
import { formatPrereqWarnings, reportMissingPrereqs } from "./lib/skill-prereqs.ts";
import { gatherStatus } from "./lib/status.ts";
import {
  buildVersionDelta,
  compareVersion,
  readDestructiveSentinel,
  readSentinel,
  readSentinelInfo,
} from "./lib/version-delta.ts";

export type { InstallTarget } from "./lib/install-types.ts";

const VERSION = "15.12.0"; // Sync with Claude Code v2.1.270: maxEffortLevel/modelSettings, bashEditDiffEnabled, gatewayInternalNetworks, six env vars.
const STRICT_VERSION = /^\d+\.\d+\.\d+$/;

export function parseArgs(argv: string[]): InstallArgs {
  const args: InstallArgs = {
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
    fresh: false,
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
    else if (a === "--fresh") args.fresh = true;
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

// --- Status --------------------------------------------------------------

async function cmdStatus(sourceDir: string): Promise<number> {
  const data = await gatherStatus(sourceDir, installPaths(), VERSION);
  printStatus(data);
  return 0; // status is informational; never fail
}

/**
 * Auto-detect used to silently pick `both` whenever a `codex` binary was on
 * PATH — surprise-installing cc-settings for Codex when the user only wanted
 * Claude, and hard-failing when the binary was a proxy shim (cmux drops one
 * under $TMPDIR/cmux-cli-shims that exits 0 while printing "codex not found
 * in PATH"). The Codex install is now opt-in on the `auto` path:
 * ask, with the probe result as the default. Non-interactive callers (CI,
 * piped input) fall through to the default silently — never Codex without
 * explicit consent.
 *
 * Explicit `--target=claude|codex|both` bypasses the prompt entirely.
 */
async function resolveInstallTarget(
  target: InstallTarget,
): Promise<Exclude<InstallTarget, "auto">> {
  if (target !== "auto") return target;
  const codexLooksInstalled = codexCliAvailable();
  const wantsCodex = await promptYn(
    codexLooksInstalled
      ? "Codex detected. Install cc-settings for Codex too?"
      : "Also install cc-settings for the Codex CLI? (only if you use Codex)",
    codexLooksInstalled,
  );
  return wantsCodex ? "both" : "claude";
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
  let target = await resolveInstallTarget(args.target);
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

  // Validate Claude's packaged source before checking product-specific tools.
  // A broken combined package should report its own defect even when Codex is
  // not installed, and it must still fail before locks or product mutation.
  if (includesTarget(target, "claude")) {
    if (!args.migrateOnly) preflightInstallSource(args.sourceDir, args.profile);
    await composeSettings(args.sourceDir);
  }

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
    !codexCliAvailable()
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
  // `let`, not `const`: --fresh nulls these after physically deleting
  // .cc-settings-version below, so the rest of the run takes the exact same
  // branches it already takes on a genuine first install (see the --fresh
  // cleanup block inside underInstallLock).
  let priorDestructiveSentinel = await readDestructiveSentinel(CLAUDE_DIR);
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
  let prevInstalledVersion = sentinel.version;
  let priorAutoUpdate = sentinel.autoUpdate;
  // Prior install's exact echo of what it wrote to ~/.claude.json's
  // engine-managed servers — captured BEFORE writeVersionSentinel overwrites
  // the sentinel below (see FIX B: mcp.ts isStaleCcOutput's priorWritten arg).
  let priorMcpWritten = sentinel.mcpWritten;

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
      // Read the previous install's settings baseline BEFORE any file work —
      // runFullInstall deletes the managed footprint (baseline included)
      // ahead of installSettings, which threads this into the merge to prune
      // env keys cc-settings retired between versions.
      let priorSettingsBaseline: SettingsBaseline | null = null;
      const claudeCode = await (async (): Promise<number> => {
        // Dispatch to migrate-only or full install path.
        if (args.migrateOnly) {
          priorSettingsBaseline = await readSettingsBaseline(CLAUDE_DIR);
          info("Migrate-only: backup + merger + sentinel; skipping file copy");
          await assertClaudeLifecycleOwnershipUnchanged(preparedClaudeInstallOwnership.snapshot);
          await createBackup({ managedFiles: preparedClaudeInstallOwnership.files });
          await assertClaudeLifecycleOwnershipUnchanged(preparedClaudeInstallOwnership.snapshot);
          await createDirectories(); // idempotent — ensures ~/.claude/ shape exists for merger
        } else {
          priorSettingsBaseline = await readSettingsBaseline(CLAUDE_DIR);
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

        // --fresh: reinstall as if from scratch. Placed AFTER the migrate-only
        // or full-install backup above (both are non-temporary — the kind
        // --rollback restores from — and both run before any of these files
        // are rewritten), so settings.json and .cc-settings-version are
        // already captured there and recoverable via --rollback before this
        // block deletes them. Placed BEFORE installSettings so mergeSettings
        // sees no existing settings.json and writes the team baseline
        // verbatim instead of merging over it. Scope is config only: never
        // touches ~/.claude.json wholesale, login/auth state, conversation
        // history, or memory — only the files cc-settings itself writes.
        if (args.fresh && !args.dryRun) {
          const userSettingsPath = join(CLAUDE_DIR, "settings.json");
          if (existsSync(userSettingsPath)) {
            await rm(userSettingsPath, { force: true });
            progressArrow("Fresh: removed settings.json (recoverable via --rollback)");
          }
          const sentinelPath = join(CLAUDE_DIR, ".cc-settings-version");
          if (existsSync(sentinelPath)) {
            await rm(sentinelPath, { force: true });
            progressArrow("Fresh: removed the prior-install sentinel (.cc-settings-version)");
          }
          const baselinePath = join(CLAUDE_DIR, BASELINE_FILENAME);
          if (existsSync(baselinePath)) {
            await rm(baselinePath, { force: true });
            progressArrow(`Fresh: removed the prior settings baseline (${BASELINE_FILENAME})`);
          }
          const fingerprintPath = join(CLAUDE_DIR, FINGERPRINT_FILENAME);
          if (existsSync(fingerprintPath)) {
            await rm(fingerprintPath, { force: true });
            progressArrow(`Fresh: removed the prior hooks fingerprint (${FINGERPRINT_FILENAME})`);
          }

          // Drop any cc-settings-managed MCP servers a prior install wrote to
          // ~/.claude.json — the normal install path only overwrites entries
          // it still ships, so a server we no longer ship would otherwise
          // linger. Must run BEFORE priorMcpWritten is nulled below: it needs
          // the real prior value to recognize what to remove.
          await removeManagedMcpServers(
            await composeSettings(args.sourceDir),
            CLAUDE_JSON_PATH,
            priorMcpWritten,
          );

          // Move aside the repo's accreted local permission approvals.
          const localPath = join(args.sourceDir, ".claude", "settings.local.json");
          if (existsSync(localPath)) {
            const movedTo = `${localPath}.bak-${getTimestamp(new Date())}`;
            await rename(localPath, movedTo);
            progressArrow(`Fresh: moved aside ${localPath} → ${movedTo}`);
          }

          // Everything above physically deleted the ONE file all four of
          // these were read from (.cc-settings-version) — null them so the
          // rest of this run takes the same branches it already takes on a
          // genuine first install, instead of consulting now-deleted prior
          // state. managedFiles is deliberately left alone: by this point it
          // holds the freshly-copied content-hash map runFullInstall just
          // produced (or, on the migrate-only path, the untouched pre-existing
          // map), not stale prior-install state — nulling it here would drop
          // real data the sentinel write below still needs.
          priorDestructiveSentinel = null;
          priorMcpWritten = null;
          priorAutoUpdate = null;
          prevInstalledVersion = null;
          priorSettingsBaseline = null;
        }

        try {
          ({ overridden: mcpOverridden, mcpWritten } = await installSettings(
            args.sourceDir,
            VERSION,
            args.interactive,
            args.profile,
            engine,
            priorMcpWritten,
            priorSettingsBaseline,
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
          VERSION,
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
      // AggregateError.errors carries the real causes — without unwrapping,
      // the outer wrapper message swallows them and leaves the operator with
      // no way to see what actually failed (e.g. restoreCombinedAfterClaudeFailure
      // wraps the underlying Claude install error plus any restore failures).
      if (err instanceof AggregateError && Array.isArray(err.errors)) {
        for (const [i, cause] of err.errors.entries()) {
          const causeDetail =
            cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
          error(`  cause[${i}]: ${causeDetail}`);
        }
      }
      process.exit(1);
    });
}
