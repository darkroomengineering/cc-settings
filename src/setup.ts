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

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkCliTools, printPreflightReport } from "./lib/cli-preflight.ts";
import { debug, error, info, palette, showBanner, success, warn } from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import { formatFrontmatterIssues, validateFrontmatters } from "./lib/frontmatter-validate.ts";
import {
  writeFingerprint as writeHooksFingerprint,
  writeSrcManifest,
} from "./lib/hooks-fingerprint.ts";
import { cmdRollback, printHelp } from "./lib/install-cmds.ts";
import { cmdDryRun, printStatus, showSummary } from "./lib/install-display.ts";
import { atomicWriteJson, JsonParseError, readJsonOrNull } from "./lib/json-io.ts";
import {
  applyLightProfile,
  LIGHT_SKILLS,
  PROFILE_MANIFEST,
  type Profile,
  stripManagedSettings,
} from "./lib/light-profile.ts";
import { MANAGED_SKILLS } from "./lib/managed-skills.ts";
import {
  installMcpToClaudeJson,
  type McpServers,
  mergeSettingsWithMcpPreservation,
  removeManagedMcpServers,
} from "./lib/mcp.ts";
import { ensurePythonPackage, ensureSystemPackage, getInstallHint } from "./lib/packages.ts";
import { CLAUDE_DIR, getTimestamp, hasCommand, isWindows } from "./lib/platform.ts";
import { printMergeAccounting } from "./lib/settings-merge.ts";
import { formatPrereqWarnings, reportMissingPrereqs } from "./lib/skill-prereqs.ts";
import { gatherStatus } from "./lib/status.ts";
import { buildVersionDelta, readInstalledVersion } from "./lib/version-delta.ts";
import { Settings } from "./schemas/settings.ts";

const VERSION = "11.30.3"; // sync with Claude Code v2.1.195: track CLAUDE_CODE_DISABLE_MOUSE_CLICKS env var in manifest + docs; hyphenated hook-matcher exact-match fix verified-safe (no hyphenated matchers); no schema/wiring changes

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
  }
  return args;
}

// --- Install plan --------------------------------------------------------

/**
 * Describes one planned install action — either a file/dir copy or a prune.
 * Produced once by buildInstallPlan; consumed by installConfigFiles (action),
 * cmdDryRun (display), and showSummary (display).
 */
export interface InstallStep {
  /** Path relative to both sourceDir (for "copy") and CLAUDE_DIR (for "prune"). */
  rel: string;
  /** "copy" = copy from source → target; "prune" = remove from target. */
  action: "copy" | "prune";
  /** Whether the source (for "copy") or target (for "prune") exists on disk. */
  exists: boolean;
  /** Human-readable annotation shown in dry-run / summary tables. */
  label?: string;
}

/**
 * Produce the complete planned footprint for an install: every file/dir that
 * will be copied or pruned, derived from PROFILE_MANIFEST and LIGHT_SKILLS.
 * The display sites (showSummary, cmdDryRun) and the light-profile install path
 * (installConfigFiles) consume this list instead of re-walking the manifest;
 * the full-profile install reads PROFILE_MANIFEST directly (the plan is derived
 * from the same manifest).
 *
 * Does NOT touch disk — pure computation from the manifest + existsSync checks.
 */
export function buildInstallPlan(sourceDir: string, profile: "full" | "light"): InstallStep[] {
  const steps: InstallStep[] = [];

  if (profile === "light") {
    // Copy the LIGHT_SKILLS subset of skills/.
    for (const skill of LIGHT_SKILLS) {
      const rel = `skills/${skill}`;
      steps.push({
        rel,
        action: "copy",
        exists: existsSync(join(sourceDir, rel)),
        label: `→ ~/.claude/${rel}/`,
      });
    }

    // Prune skills from a prior full install that are not in the light set.
    // Scoped to MANAGED_SKILLS so user-authored skills are never touched.
    const lightSkillSet = new Set(LIGHT_SKILLS);
    for (const skill of MANAGED_SKILLS) {
      if (!lightSkillSet.has(skill)) {
        steps.push({
          rel: `skills/${skill}`,
          action: "prune",
          exists: existsSync(join(CLAUDE_DIR, `skills/${skill}`)),
        });
      }
    }

    // Prune full-only rootFiles and dirs (CLAUDE.md, AGENTS.md, agents/, …).
    const { full, light } = PROFILE_MANIFEST;
    const lightFiles = new Set(light.rootFiles.map(([, dest]) => dest));
    const lightDirs = new Set([...light.dirs, ...light.retainedDirs]);
    for (const [, dest] of full.rootFiles) {
      if (!lightFiles.has(dest)) {
        steps.push({
          rel: dest,
          action: "prune",
          exists: existsSync(join(CLAUDE_DIR, dest)),
        });
      }
    }
    for (const d of full.dirs) {
      if (!lightDirs.has(d)) {
        steps.push({
          rel: d,
          action: "prune",
          exists: existsSync(join(CLAUDE_DIR, d)),
        });
      }
    }
  } else {
    // Full profile: every rootFile + dir from the manifest.
    const ROOT_FILE_LABELS: Record<string, string> = {
      "CLAUDE.md": "(Claude-Code config)",
      "AGENTS.md": "(portable standards)",
    };
    const manifest = PROFILE_MANIFEST.full;
    for (const [src, dest] of manifest.rootFiles) {
      const label = ROOT_FILE_LABELS[dest] ? `${dest} ${ROOT_FILE_LABELS[dest]}` : dest;
      steps.push({
        rel: src,
        action: "copy",
        exists: existsSync(join(sourceDir, src)),
        label,
      });
    }
    for (const d of manifest.dirs) {
      steps.push({
        rel: d,
        action: "copy",
        exists: existsSync(join(sourceDir, d)),
        label: `${d}/`,
      });
    }
  }

  return steps;
}

// --- Install phases ------------------------------------------------------

async function createBackup(): Promise<void> {
  const backupDir = join(CLAUDE_DIR, "backups");
  await mkdir(backupDir, { recursive: true });

  const home = homedir();
  // Home-relative paths so the archive can include ~/.claude.json — it holds the
  // MCP server config that installMcpToClaudeJson rewrites and lives alongside
  // ~/.claude, not inside it. Without it, --rollback could not restore a user's
  // MCP setup. cmdRollback detects this layout (".claude/"-prefixed entries) and
  // extracts from $HOME; older ~/.claude-relative archives still restore correctly.
  const candidates = [
    ".claude/settings.json",
    ".claude/CLAUDE.md",
    ".claude/AGENTS.md",
    ".claude.json",
  ];
  const existing = candidates.filter((f) => existsSync(join(home, f)));
  if (existing.length === 0) return;

  const stamp = getTimestamp();
  const archive = join(backupDir, `backup-${stamp}.tar.gz`);
  const proc = Bun.spawn(["tar", "-czf", archive, ...existing], {
    cwd: home,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderrText, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    // A silent backup failure would let the install proceed into cleanOldConfig
    // (which rm -rf's managed dirs) with no restore point — the advertised
    // --rollback safety net would be quietly disabled. Abort instead.
    error(`Backup failed (tar exited ${code}): ${stderrText.trim()}`);
    error("Aborting so --rollback stays possible. Fix the tar error above and re-run.");
    throw new Error(`backup failed — tar exited ${code}`);
  }

  // Keep last 5.
  const kept = (await readdir(backupDir)).filter((e) => /^backup-.*\.tar\.gz$/.test(e)).sort();
  if (kept.length > 5) {
    await Promise.all(
      kept
        .slice(0, kept.length - 5)
        .map((old) => rm(join(backupDir, old), { force: true }).catch(() => {})),
    );
  }
}

async function createDirectories(): Promise<void> {
  const dirs = [
    "agents",
    "skills",
    "profiles",
    "rules",
    "handoffs",
    "learnings",
    "hooks",
    "memory",
    "memory/agents",
    "docs",
    "tldr-cache",
    "backups",
    "tmp",
    "logs",
    "src",
    "src/scripts",
    "src/hooks",
    "src/lib",
    "src/schemas",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(CLAUDE_DIR, d), { recursive: true })));
}

async function cleanOldConfig(): Promise<void> {
  const removeGlob = async (dir: string, pattern: RegExp) => {
    const full = join(CLAUDE_DIR, dir);
    if (!existsSync(full)) return;
    const entries = await readdir(full).catch(() => []);
    await Promise.all(
      entries.filter((e) => pattern.test(e)).map((e) => rm(join(full, e), { force: true })),
    );
  };

  const junkFiles = [
    "skill-rules.cache",
    "skill-activation.out",
    "skill-index.compiled",
    "skill-index.checksum",
    "CLAUDE.md",
    "AGENTS.md",
  ];

  // Every removal below targets a disjoint path, so they run concurrently:
  // legacy bash artifacts, fresh wipes of managed content (re-installed after),
  // managed skill directories, and stale caches + legacy top-level docs.
  await Promise.all([
    rm(join(CLAUDE_DIR, "scripts"), { recursive: true, force: true }).catch(() => {}),
    rm(join(CLAUDE_DIR, "lib"), { recursive: true, force: true }).catch(() => {}),
    rm(join(CLAUDE_DIR, "hooks-config.json"), { force: true }).catch(() => {}),
    rm(join(CLAUDE_DIR, "hooks-config.local.json"), { force: true }).catch(() => {}),
    removeGlob("agents", /\.md$/),
    removeGlob("skills", /\.(json|md)$/),
    removeGlob("profiles", /\.md$/),
    removeGlob("rules", /\.md$/),
    // contexts/ retired (folded into profiles/); prune the legacy installed dir.
    rm(join(CLAUDE_DIR, "contexts"), { recursive: true, force: true }).catch(() => {}),
    removeGlob("hooks", /\.md$/),
    removeGlob("docs", /\.md$/),
    ...MANAGED_SKILLS.map((s) =>
      rm(join(CLAUDE_DIR, "skills", s), { recursive: true, force: true }),
    ),
    ...junkFiles.map((junk) => rm(join(CLAUDE_DIR, junk), { force: true }).catch(() => {})),
  ]);
}

async function copyIfPresent(src: string, dst: string): Promise<boolean> {
  if (!existsSync(src)) return false;
  await cp(src, dst, { recursive: false, force: true });
  return true;
}

/**
 * Copy entries from srcDir to dstDir, filtering by the keep predicate.
 * Skips entries where keep(name) returns false.
 */
async function copyDirContentsFiltered(
  srcDir: string,
  dstDir: string,
  keep: (name: string) => boolean,
): Promise<void> {
  if (!existsSync(srcDir)) return;
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  // Each entry copies to a distinct destination path — run them concurrently.
  await Promise.all(
    entries
      .filter((e) => keep(e.name))
      .map((e) => cp(join(srcDir, e.name), join(dstDir, e.name), { recursive: true, force: true })),
  );
}

/** Copy all entries from srcDir to dstDir (no filtering). */
async function copyDirContents(srcDir: string, dstDir: string): Promise<void> {
  return copyDirContentsFiltered(srcDir, dstDir, () => true);
}

/**
 * Execute the copy/prune steps from buildInstallPlan. cleanOldConfig must
 * already have run so MANAGED_SKILLS dirs are wiped before copy.
 *
 * For the light profile, all plan steps (copy + prune) are executed directly
 * from buildInstallPlan — making buildInstallPlan the honest single source of
 * truth for what the light path touches (§1.3).
 */
async function installConfigFiles(source: string, profile: Profile): Promise<void> {
  if (profile === "light") {
    const plan = buildInstallPlan(source, profile);
    // Execute copy steps: LIGHT_SKILLS subset via filtered copy.
    const lightSkillSet = new Set(LIGHT_SKILLS);
    await copyDirContentsFiltered(join(source, "skills"), join(CLAUDE_DIR, "skills"), (name) =>
      lightSkillSet.has(name),
    );
    // Execute all prune steps from the plan (skill dirs + full-only rootFiles/dirs).
    const pruneSteps = plan.filter((s) => s.action === "prune");
    await Promise.all(
      pruneSteps.map((s) =>
        rm(join(CLAUDE_DIR, s.rel), { recursive: true, force: true }).catch(() => {}),
      ),
    );
  } else {
    // Full profile: every rootFile + dir from the manifest. Destinations are
    // disjoint, so all copies run in parallel.
    const manifest = PROFILE_MANIFEST.full;
    await Promise.all([
      ...manifest.rootFiles.map(([src, dest]) =>
        copyIfPresent(join(source, src), join(CLAUDE_DIR, dest)),
      ),
      ...manifest.dirs.map((d) => copyDirContents(join(source, d), join(CLAUDE_DIR, d))),
    ]);
  }
}

async function installTsSources(source: string): Promise<void> {
  const srcTs = join(source, "src");
  if (!existsSync(srcTs)) return;
  const dstTs = join(CLAUDE_DIR, "src");
  // Clean previous TS install so stale ports don't linger.
  await rm(dstTs, { recursive: true, force: true });
  await mkdir(dstTs, { recursive: true });
  await copyDirContents(srcTs, dstTs);

  // Dep resolution: copy lockfile + config, link node_modules back to source.
  await Promise.all([
    copyIfPresent(join(source, "package.json"), join(dstTs, "package.json")),
    copyIfPresent(join(source, "tsconfig.json"), join(dstTs, "tsconfig.json")),
    copyIfPresent(join(source, "bun.lock"), join(dstTs, "bun.lock")),
  ]);

  const srcNm = join(source, "node_modules");
  const dstNm = join(dstTs, "node_modules");
  if (existsSync(srcNm) && !existsSync(dstNm)) {
    try {
      await Bun.spawn(["ln", "-s", srcNm, dstNm], { stdout: "ignore", stderr: "ignore" }).exited;
    } catch {
      await cp(srcNm, dstNm, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// --- Settings + MCP install ---------------------------------------------

async function installSettings(
  source: string,
  interactive: boolean,
  profile: Profile,
): Promise<void> {
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
    return;
  }

  // Full profile path: merge the in-memory composed settings into the user's
  // settings.json, then install the team MCP block into ~/.claude.json. The
  // MCP block was validated exactly once — by composeSettings, whose Settings
  // schema types mcpServers with the McpServers schema.
  const teamMcp = (fullComposed.mcpServers ?? {}) as McpServers;
  const accounting = await mergeSettingsWithMcpPreservation(
    userSettingsPath,
    fullComposed,
    userSettingsPath,
    { interactive },
  );
  if (accounting) printMergeAccounting(accounting, { interactive });
  await installMcpToClaudeJson(teamMcp);

  // Record a SHA256 of the merged hooks block so verify-hooks.ts (the
  // SessionStart integrity check) can detect post-install tampering — the
  // Shai-Hulud worm attack pattern (May 2026). Re-running setup.sh refreshes
  // the fingerprint, which is the intended workflow when users intentionally
  // add custom hooks. See SECURITY.md. Read back the merged file the merger
  // just wrote; best-effort, so a read failure only skips the fingerprint.
  const mergedReadBack = await readJsonOrNull(userSettingsPath).catch(() => null);
  if (mergedReadBack !== null) await fingerprintSettingsHooks(mergedReadBack);
}

/**
 * Hash + persist the hooks block of a settings object for the SessionStart
 * integrity check. Validates against Settings first, with a forward-compat
 * fallback: if a new Claude Code version added a key the schema doesn't know
 * yet, the raw object is fingerprinted so the check isn't silently skipped.
 * Schema issues are debug-logged. The write is best-effort — a failed write
 * means verify-hooks.ts prints a "missing fingerprint" nudge on the next
 * session; it never blocks.
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
    await writeHooksFingerprint(validated.success ? validated.data : settings, CLAUDE_DIR);
  } catch {
    // Best-effort — see JSDoc above.
  }
}

// --- Dependencies --------------------------------------------------------

async function installDependencies(profile: Profile): Promise<void> {
  // CC_SKIP_DEPS=1 — used by E2E tests to avoid touching system-wide install
  // locations (npm global, pipx, etc.) when running setup.sh against a tmp
  // HOME. Setting HOME to tmpdir doesn't isolate `npm i -g` writes.
  if (process.env.CC_SKIP_DEPS === "1") return;

  // Light is raw Claude Code + statusLine (pure Bun) + share-learning skill.
  // No hooks require jq, pipx, or llm-tldr — skip all system deps.
  if (profile === "light") return;

  if (!hasCommand("jq")) {
    const ok = await ensureSystemPackage("jq");
    if (!ok) warn(`Install jq manually: ${getInstallHint("jq")}`);
  }

  if (!hasCommand("pipx")) await ensureSystemPackage("pipx").catch(() => false);
  if (!hasCommand("tldr") && !hasCommand("tldr-mcp")) {
    await ensurePythonPackage("llm-tldr", "tldr").catch(() => false);
  }
}

async function writeVersionSentinel(sourceDir: string, profile: Profile): Promise<void> {
  const payload = {
    version: VERSION,
    installed_at: new Date().toISOString(),
    installer: "src/setup.ts",
    // Where this install came from — lets the SessionStart drift check locate
    // the repo and compare the installed version against the packaged one.
    repo_path: sourceDir,
    profile,
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
async function runFullInstall(args: Args): Promise<void> {
  info("Installing dependencies...");
  await installDependencies(args.profile);
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
    return await cmdRollback(args.rollback);
  }
  if (args.dryRun) {
    await cmdDryRun(args.sourceDir, args.profile, VERSION);
    return 0;
  }

  if (isWindows()) {
    warn("Windows is supported via setup.ps1 bootstrap; direct invocation is experimental.");
  }

  showBanner(VERSION);

  // Capture the previously-installed version BEFORE we overwrite the sentinel
  // — used to print the version-delta summary at the end of the install.
  const prevInstalledVersion = await readInstalledVersion(CLAUDE_DIR);

  // Frontmatter validation — catches typos in agents/*.md and skills/*/SKILL.md
  // before we ship them to ~/.claude/. Non-fatal; warn and continue so a single
  // bad agent doesn't block the rest of the install.
  const fmIssues = await validateFrontmatters(args.sourceDir).catch(() => []);
  const fmWarning = formatFrontmatterIssues(fmIssues);
  if (fmWarning) warn(fmWarning);

  // Dispatch to migrate-only or full install path.
  if (args.migrateOnly) {
    info("Migrate-only: backup + merger + sentinel; skipping file copy");
    await createBackup();
    await createDirectories(); // idempotent — ensures ~/.claude/ shape exists for merger
  } else {
    await runFullInstall(args);
  }

  try {
    await installSettings(args.sourceDir, args.interactive, args.profile);
  } catch (err) {
    // JsonParseError is the one we want to surface loudly — see lib/json-io.ts.
    if (err instanceof JsonParseError) {
      error(String((err as Error).message));
      error("Aborting. Fix the corrupt JSON or rollback: bun src/setup.ts --rollback");
      return 1;
    }
    throw err;
  }

  await writeVersionSentinel(args.sourceDir, args.profile);
  if (!args.migrateOnly) await showSummary(args.profile);

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
