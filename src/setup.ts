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
//   --rollback[=TS]    Restore newest backup (or a timestamp match) from ~/.claude/backups.
//   --dry-run          Print planned actions without touching disk.
//   --light            Install raw Claude Code + statusLine + share-learning skill only.
//                      No CLAUDE.md, AGENTS.md, agents, rules, profiles, docs,
//                      MCP servers, effort override, or permission rules.
//   --help, -h         Usage.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkCliTools, printPreflightReport } from "./lib/cli-preflight.ts";
import {
  type EngineDescriptor,
  ensureEngineInstalled,
  resolveEngine,
} from "./lib/code-intel-engine.ts";
import { debug, error, info, palette, showBanner, success, warn } from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import { formatFrontmatterIssues, validateFrontmatters } from "./lib/frontmatter-validate.ts";
import {
  writeFingerprint as writeHooksFingerprint,
  writeSrcManifest,
} from "./lib/hooks-fingerprint.ts";
import { cmdRollback, printHelp } from "./lib/install-cmds.ts";
import { cmdDryRun, printStatus, showSummary } from "./lib/install-display.ts";
import {
  cleanOldConfig,
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
  mergeSettingsWithMcpPreservation,
  removeManagedMcpServers,
} from "./lib/mcp.ts";
import { ensureSystemPackage, getInstallHint } from "./lib/packages.ts";
import { CLAUDE_DIR, hasCommand, isWindows, os } from "./lib/platform.ts";
import { isInteractive, promptYn } from "./lib/prompts.ts";
import {
  autoUpdateJobLoaded,
  decideAutoUpdate,
  registerAutoUpdate,
  unregisterAutoUpdate,
} from "./lib/schedule.ts";
import { printMergeAccounting } from "./lib/settings-merge.ts";
import { formatPrereqWarnings, reportMissingPrereqs } from "./lib/skill-prereqs.ts";
import { gatherStatus } from "./lib/status.ts";
import { buildVersionDelta, readSentinelInfo } from "./lib/version-delta.ts";
import type { McpStdioServer } from "./schemas/mcp.ts";
import { Settings } from "./schemas/settings.ts";

const VERSION = "12.12.0"; // mcp_written covers every managed server, not just tldr

// --- Arg parsing ---------------------------------------------------------

type Args = {
  rollback: string | true | null;
  dryRun: boolean;
  status: boolean;
  help: boolean;
  sourceDir: string;
  interactive: boolean;
  migrateOnly: boolean;
  profile: Profile;
  autoUpdate: "on" | "off" | null;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    rollback: null,
    dryRun: false,
    status: false,
    help: false,
    sourceDir: resolve(import.meta.dir, ".."),
    // CC_INTERACTIVE=1 opts in for scripts/CI without argv juggling.
    interactive: process.env.CC_INTERACTIVE === "1",
    migrateOnly: false,
    profile: "full",
    autoUpdate: null,
  };
  for (const a of argv) {
    if (a === "--rollback") args.rollback = true;
    else if (a.startsWith("--rollback=")) args.rollback = a.slice("--rollback=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--status") args.status = true;
    else if (a === "--interactive") args.interactive = true;
    else if (a === "--migrate-only") args.migrateOnly = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--source=")) args.sourceDir = resolve(a.slice("--source=".length));
    else if (a === "--light") args.profile = "light";
    else if (a.startsWith("--auto-update=")) {
      const value = a.slice("--auto-update=".length);
      if (value === "on" || value === "off") args.autoUpdate = value;
      else warn(`--auto-update=${value} is not valid (expected "on" or "off") — ignoring`);
    }
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
    const existingRaw = await readJsonOrNull(userSettingsPath);
    let result: Record<string, unknown>;
    if (existingRaw === null || typeof existingRaw !== "object") {
      // Fresh install — write the light baseline directly.
      result = lightBaseline;
    } else {
      // Existing settings.json: strip cc-settings footprint, then overlay the
      // light baseline. applyLightProfile emits ONLY $schema + statusLine, and
      // only when present in the composed settings, so a plain spread is exact.
      const cleaned = stripManagedSettings(existingRaw as Record<string, unknown>, fullComposed);
      result = { ...cleaned, ...lightBaseline };
    }
    await atomicWriteJson(userSettingsPath, result);

    // Light has no team MCP servers. Remove any cc-settings-managed servers
    // that may have been written to ~/.claude.json by a prior full install.
    await removeManagedMcpServers(fullComposed);

    // Fingerprint the (empty/light) hooks block for the integrity check —
    // straight from the in-memory object, no disk re-read.
    await fingerprintSettingsHooks(result);
    // Light ships no MCP servers: nothing can be overridden, and nothing is
    // ours to remember having written.
    return { overridden: [], mcpWritten: null };
  }

  // Full profile path: merge the in-memory composed settings into the user's
  // settings.json, then install the team MCP block into ~/.claude.json. The
  // MCP block was validated exactly once — by composeSettings, whose Settings
  // schema types mcpServers with the McpServers schema.
  //
  // Clone before mutating: the settings.json merger below reads fullComposed,
  // so the static `tldr` fragment must survive there unchanged. Only the
  // ~/.claude.json copy gets the resolved engine's command/args/instructions —
  // this is the single point where the engine swaps in behind the "tldr" name.
  const teamMcp = structuredClone(fullComposed.mcpServers ?? {}) as McpServers;
  const tldrEntry = teamMcp.tldr as McpStdioServer | undefined;
  if (tldrEntry) {
    tldrEntry.command = engine.mcp.command;
    tldrEntry.args = engine.mcp.args;
    tldrEntry.serverInstructions = engine.serverInstructions;
  }
  // Feed the engine-mutated teamMcp (not the untouched fullComposed.mcpServers)
  // into the settings.json merge too, so settings.json and ~/.claude.json never
  // disagree about which engine backs the "tldr" server (H9) — the merger's
  // own resolveMcpServers still runs its usual user-wins-on-divergence logic
  // against THIS mcpServers value, it just starts from the resolved engine
  // instead of the static config/20-mcp.json fragment.
  const settingsForMerge: Record<string, unknown> = { ...fullComposed, mcpServers: teamMcp };
  const accounting = await mergeSettingsWithMcpPreservation(
    userSettingsPath,
    settingsForMerge,
    userSettingsPath,
    { interactive },
    priorMcpWritten,
  );
  if (accounting) printMergeAccounting(accounting, { interactive });
  const mcpOverridden = await installMcpToClaudeJson(teamMcp, CLAUDE_JSON_PATH, priorMcpWritten);

  // Record a SHA256 of the merged hooks block so verify-hooks.ts (the
  // SessionStart integrity check) can detect post-install tampering — the
  // Shai-Hulud worm attack pattern (May 2026). Re-running setup.sh refreshes
  // the fingerprint, which is the intended workflow when users intentionally
  // add custom hooks. See SECURITY.md. Read back the merged file the merger
  // just wrote; best-effort, so a read failure only skips the fingerprint.
  const mergedReadBack = await readJsonOrNull(userSettingsPath).catch(() => null);
  if (mergedReadBack !== null) await fingerprintSettingsHooks(mergedReadBack);
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
 * write is best-effort — a failed write means verify-hooks.ts prints a
 * "missing fingerprint" nudge on the next session; it never blocks.
 */
async function fingerprintSettingsHooks(settings: unknown): Promise<void> {
  try {
    const validated = Settings.safeParse(settings);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      debug(`settings.json failed schema validation after merge (fingerprinting raw): ${issues}`);
    }
    await writeHooksFingerprint(settings, CLAUDE_DIR);
  } catch {
    // Best-effort — see JSDoc above.
  }
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
async function applyAutoUpdate(args: Args, prior: boolean | null): Promise<boolean | undefined> {
  if (os !== "macos") {
    if (args.autoUpdate !== null) warn("--auto-update is macOS-only; ignoring");
    else info("Auto-update is macOS-only — skipping (nothing to enroll on this platform).");
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
    const result = await registerAutoUpdate(CLAUDE_DIR, homedir(), args.sourceDir);
    if (result.ok) success("Auto-update enabled — daily at 10:00 local time.");
    else warn(`Auto-update registration failed: ${result.reason ?? "unknown error"}`);
  } else if (enrolled === false) {
    await unregisterAutoUpdate();
  }

  return enrolled;
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
): Promise<void> {
  const payload = {
    version: VERSION,
    installed_at: new Date().toISOString(),
    installer: "src/setup.ts",
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
    // Auto-update enrollment — omitted entirely when undecided (non-macOS, or
    // a non-interactive run with no prior decision) so "absent" never reads
    // as "declined". See decideAutoUpdate() in src/lib/schedule.ts.
    ...(autoUpdate !== undefined ? { auto_update: autoUpdate } : {}),
  };
  await atomicWriteJson(join(CLAUDE_DIR, ".cc-settings-version"), payload);
}

// --- Status --------------------------------------------------------------

async function cmdStatus(sourceDir: string): Promise<number> {
  const data = await gatherStatus(sourceDir, CLAUDE_DIR, VERSION);
  printStatus(data);
  return 0; // status is informational; never fail
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
async function runFullInstall(args: Args, engine: EngineDescriptor): Promise<void> {
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
  printPreflightReport(checkCliTools());

  info("Creating backup...");
  await createBackup();

  info("Installing configuration...");
  await createDirectories();
  await cleanOldConfig();
  // Disjoint destination trees (config dirs vs ~/.claude/src), so install both
  // in parallel. Both must follow the clean above. For light, installConfigFiles
  // owns the full footprint: it copies the LIGHT_SKILLS subset and prunes every
  // full-only target (CLAUDE.md, AGENTS.md, agents/, rules/, profiles/, docs/).
  await Promise.all([
    installConfigFiles(args.sourceDir, args.profile),
    installTsSources(args.sourceDir),
  ]);
  // Content manifest of the just-installed ~/.claude/src tree — the
  // supply-chain layer that catches dropped/patched script content
  // (verify-hooks.ts re-checks it at SessionStart; audit-hooks.ts gates
  // "trusted" on it). Refreshed ONLY here, never by the auditor. Best-effort:
  // a failed write just downgrades audit classifications to "unknown".
  await writeSrcManifest(join(CLAUDE_DIR, "src"), CLAUDE_DIR).catch(() => {});
}

/** Run fn while holding the exclusive install lock (see lib/install-lock.ts).
 *  Returns 1 with a message if another install already holds it; otherwise
 *  returns fn's exit code and always releases the lock. Wraps every mutating
 *  entry point — full/migrate install AND --rollback — so they can't race each
 *  other's rm/cp over ~/.claude. */
async function underInstallLock(fn: () => Promise<number>): Promise<number> {
  let release: () => Promise<void>;
  try {
    release = await acquireInstallLock();
  } catch (err) {
    if (err instanceof InstallLockError) {
      error(err.message);
      return 1;
    }
    throw err;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp(VERSION);
    return 0;
  }
  if (args.status) {
    return await cmdStatus(args.sourceDir);
  }
  if (args.rollback !== null) {
    // Rollback now deletes + restores the managed footprint, so it takes the
    // same lock as an install to avoid racing a concurrent setup run.
    const target = args.rollback;
    return await underInstallLock(() => cmdRollback(target));
  }
  if (args.dryRun) {
    await cmdDryRun(args.sourceDir, args.profile, VERSION);
    return 0;
  }

  if (isWindows()) {
    warn("Windows is supported via setup.ps1 bootstrap; direct invocation is experimental.");
  }

  showBanner(VERSION);

  // Single sentinel read for the whole run (N10) — version (for the
  // version-delta summary), autoUpdate (prior enrollment decision), and the
  // engine id all come from the same on-disk read instead of three
  // sequential ones. Captured BEFORE we overwrite the sentinel later.
  const sentinel = await readSentinelInfo(CLAUDE_DIR);
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
  const installCode = await underInstallLock(async () => {
    // Dispatch to migrate-only or full install path.
    if (args.migrateOnly) {
      info("Migrate-only: backup + merger + sentinel; skipping file copy");
      await createBackup();
      await createDirectories(); // idempotent — ensures ~/.claude/ shape exists for merger
    } else {
      await runFullInstall(args, engine);
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

    const autoUpdateEnrolled = await applyAutoUpdate(args, priorAutoUpdate);
    await writeVersionSentinel(
      args.sourceDir,
      args.profile,
      engine,
      autoUpdateEnrolled,
      engineExplicit,
      mcpWritten,
    );
    return 0;
  });
  if (installCode !== 0) return installCode;

  if (!args.migrateOnly) await showSummary(args.profile, args.sourceDir, mcpOverridden);

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
  const prereqReports = await reportMissingPrereqs(skillsDir, CLAUDE_DIR).catch(() => []);
  const prereqWarnings = formatPrereqWarnings(prereqReports);
  if (prereqWarnings) {
    console.log("");
    warn(prereqWarnings);
  }

  console.log("");
  console.log(`Installed to: ${palette.cyan}${CLAUDE_DIR}${palette.reset}`);
  console.log("");
  info("Rollback if needed: bun src/setup.ts --rollback");
  success("Restart Claude Code to apply changes.");
  console.log("");
  return 0;
}

// Only run main() when invoked directly.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      error(`Setup failed: ${err?.stack ?? err}`);
      process.exit(1);
    });
}
