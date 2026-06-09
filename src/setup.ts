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
//                      No CLAUDE.md, AGENTS.md, agents, rules, profiles, contexts, docs,
//                      MCP servers, effort override, or permission rules.
//   --help, -h         Usage.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkCliTools, printPreflightReport } from "./lib/cli-preflight.ts";
import {
  boxEnd,
  boxLine,
  boxStart,
  debug,
  error,
  info,
  palette,
  showBanner,
  success,
  warn,
} from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import { formatFrontmatterIssues, validateFrontmatters } from "./lib/frontmatter-validate.ts";
import { writeFingerprint as writeHooksFingerprint } from "./lib/hooks-fingerprint.ts";
import { atomicWriteJson, type JsonParseError, readJsonOrNull } from "./lib/json-io.ts";
import {
  applyLightProfile,
  LIGHT_SKILLS,
  type Profile,
  stripManagedSettings,
} from "./lib/light-profile.ts";
import { MANAGED_SKILLS } from "./lib/managed-skills.ts";
import { CLAUDE_JSON_PATH, installMcpToClaudeJson } from "./lib/mcp.ts";
import {
  detectPackageManagers,
  ensurePythonPackage,
  ensureSystemPackage,
  getInstallHint,
} from "./lib/packages.ts";
import { getTimestamp, hasCommand, isWindows } from "./lib/platform.ts";
import { mergeSettingsWithMcpPreservation } from "./lib/settings-merge.ts";
import { formatPrereqWarnings, reportMissingPrereqs } from "./lib/skill-prereqs.ts";
import { gatherStatus } from "./lib/status.ts";
import type { StatusData } from "./lib/status-types.ts";
import { buildVersionDelta, readInstalledVersion } from "./lib/version-delta.ts";
import { Settings } from "./schemas/settings.ts";

const VERSION = "11.23.0"; // adopt Claude Fable 5 as default model + deep-reasoning agent tier (temporary CLAUDE_CODE_SUBAGENT_MODEL boost through 2026-06-21)
const CLAUDE_DIR = join(homedir(), ".claude");

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

function printHelp(): void {
  console.log(`cc-settings installer v${VERSION}

Usage: bun src/setup.ts [flags]

Flags:
  --source=<dir>     Source repo path (default: parent of setup.ts).
  --rollback[=TS]    Restore newest backup, or one matching timestamp TS.
  --dry-run          Print planned actions; do not touch disk.
  --light            Install raw Claude Code + statusLine + share-learning only:
                       • skills: share-learning (only)
                       • settings.json: $schema + statusLine only
                       • no MCP servers, no hooks, no effort override
                       • no CLAUDE.md, AGENTS.md, agents, rules, profiles,
                         contexts, docs, or permission rules
                     Re-run without --light to upgrade to full.
  --status           Report installed version, drift vs repo HEAD, missing
                     managed skills, hooks, key env vars, and MCP servers.
  --interactive      Prompt on settings.json conflicts (scalar overrides, team
                     additions to allow/ask rules, new hook groups). Also opt in
                     via CC_INTERACTIVE=1.
  --migrate-only     Run only the settings.json merger + version sentinel;
                     skip file copy, dependency install, and skill/agent
                     refresh. Use after a cc-settings update if you only
                     want the merger's deprecation prune to apply.
  --help, -h         Show this message.

Rollback examples:
  bun src/setup.ts --rollback
  bun src/setup.ts --rollback=2026-04-20T10-00-00Z`);
}

// --- Rollback ------------------------------------------------------------

async function cmdRollback(target: string | true): Promise<number> {
  const backupDir = join(CLAUDE_DIR, "backups");
  if (!existsSync(backupDir)) {
    error(`No backups directory found at ${backupDir}`);
    return 1;
  }
  const entries = (await readdir(backupDir))
    .filter((e) => /^backup-.*\.tar\.gz$/.test(e))
    .sort()
    .reverse();
  const match = target === true ? entries[0] : entries.find((e) => e.includes(target));
  if (!match) {
    error("No matching backup found.");
    console.error("Available backups:");
    for (const e of entries.slice(0, 5)) console.error(`  ${e}`);
    return 1;
  }
  info(`Rolling back from: ${match}`);
  const archivePath = join(backupDir, match);
  // Newer archives are $HOME-relative (entries prefixed with ".claude/", plus a
  // top-level ".claude.json"); pre-MCP-backup archives are ~/.claude-relative
  // (bare "settings.json"). Detect the layout so each restores to the right place.
  const listing = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "ignore" });
  const archiveEntries = (await new Response(listing.stdout).text()).trim().split("\n");
  await listing.exited;
  const homeRelative = archiveEntries.some((e) => e.startsWith(".claude/") || e === ".claude.json");
  const proc = Bun.spawn(["tar", "-xzf", archivePath], {
    cwd: homeRelative ? homedir() : CLAUDE_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) success("Restored. Restart Claude Code to apply.");
  return code;
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
    stderr: "ignore",
  });
  await proc.exited;

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
    "contexts",
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
    removeGlob("contexts", /\.md$/),
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
  for (const e of entries) {
    if (!keep(e.name)) continue;
    const src = join(srcDir, e.name);
    const dst = join(dstDir, e.name);
    await cp(src, dst, { recursive: true, force: true });
  }
}

/** Copy all entries from srcDir to dstDir (no filtering). */
async function copyDirContents(srcDir: string, dstDir: string): Promise<void> {
  return copyDirContentsFiltered(srcDir, dstDir, () => true);
}

async function installConfigFiles(source: string, profile: Profile): Promise<void> {
  if (profile === "light") {
    // Light = raw Claude Code. Install ONLY share-learning skill.
    // No CLAUDE.md, no AGENTS.md, no agents, no rules, no profiles, no contexts,
    // no hooks docs, no docs.

    // skills: only LIGHT_SKILLS (share-learning)
    const lightSkillSet = new Set(LIGHT_SKILLS);
    await copyDirContentsFiltered(join(source, "skills"), join(CLAUDE_DIR, "skills"), (name) =>
      lightSkillSet.has(name),
    );

    // Prune cc-settings skills left over from a prior full install that are
    // not in the light set. Scope removal to skill folders that exist in the
    // source repo — never touch user-authored skills.
    const sourceSkillDirs = (await readdir(join(source, "skills"), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    await Promise.all(
      sourceSkillDirs
        .filter((name) => !lightSkillSet.has(name))
        .map((name) => rm(join(CLAUDE_DIR, "skills", name), { recursive: true, force: true })),
    );
  } else {
    // Full profile: CLAUDE.md, AGENTS.md, and all dirs.
    await copyIfPresent(join(source, "CLAUDE-FULL.md"), join(CLAUDE_DIR, "CLAUDE.md"));
    await copyIfPresent(join(source, "AGENTS.md"), join(CLAUDE_DIR, "AGENTS.md"));

    for (const d of ["rules", "contexts", "hooks", "docs"]) {
      await copyDirContents(join(source, d), join(CLAUDE_DIR, d));
    }

    for (const d of ["agents", "profiles", "skills"]) {
      await copyDirContents(join(source, d), join(CLAUDE_DIR, d));
    }
  }
}

/**
 * Remove files/dirs that cc-settings full installs but light does NOT install.
 * Called before the light file-copy phase so a prior full install is cleaned up.
 * Never removes src/ or skills/share-learning (user-authored skills untouched).
 */
async function removeLightIncompatibleFiles(): Promise<void> {
  const removeIfExists = (p: string) => rm(p, { recursive: true, force: true }).catch(() => {});
  await Promise.all([
    removeIfExists(join(CLAUDE_DIR, "CLAUDE.md")),
    removeIfExists(join(CLAUDE_DIR, "AGENTS.md")),
    removeIfExists(join(CLAUDE_DIR, "agents")),
    removeIfExists(join(CLAUDE_DIR, "rules")),
    removeIfExists(join(CLAUDE_DIR, "profiles")),
    removeIfExists(join(CLAUDE_DIR, "contexts")),
    removeIfExists(join(CLAUDE_DIR, "docs")),
  ]);
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
      // Existing settings.json: strip cc-settings footprint, then overlay light.
      const cleaned = stripManagedSettings(existingRaw as Record<string, unknown>, fullComposed);
      result = {
        ...cleaned,
        // Always write $schema and statusLine from the light baseline.
        ...(lightBaseline["$schema"] !== undefined ? { $schema: lightBaseline["$schema"] } : {}),
        ...(lightBaseline.statusLine !== undefined ? { statusLine: lightBaseline.statusLine } : {}),
      };
    }
    await atomicWriteJson(userSettingsPath, result);

    // Light has no team MCP servers. Remove any cc-settings-managed servers
    // that may have been written to ~/.claude.json by a prior full install.
    await removeManagedMcpServers(fullComposed);

    // Fingerprint the (empty/light) hooks block for the integrity check.
    try {
      const mergedParsed = JSON.parse(await Bun.file(userSettingsPath).text());
      const validated = Settings.safeParse(mergedParsed);
      const mergedSettings = validated.success ? validated.data : mergedParsed;
      await writeHooksFingerprint(mergedSettings, CLAUDE_DIR);
    } catch {
      // Best-effort — see comment in full path below.
    }
    return;
  }

  // Full profile path: use the existing merger as before.
  const teamStaged = join(CLAUDE_DIR, ".team-settings.staged.json");
  await atomicWriteJson(teamStaged, fullComposed);
  try {
    await mergeSettingsWithMcpPreservation(userSettingsPath, teamStaged, userSettingsPath, {
      interactive,
    });
    await installMcpToClaudeJson(teamStaged);

    // Record a SHA256 of the merged hooks block so verify-hooks.ts (the
    // SessionStart integrity check) can detect post-install tampering — the
    // Shai-Hulud worm attack pattern (May 2026). Re-running setup.sh refreshes
    // the fingerprint, which is the intended workflow when users intentionally
    // add custom hooks. See SECURITY.md.
    try {
      const mergedText = await Bun.file(userSettingsPath).text();
      const mergedParsed = JSON.parse(mergedText);
      // Validate the merged result against Settings before hashing its hooks
      // block. Use safeParse + forward-compat fallback: if a new Claude Code
      // version added a key the schema doesn't know yet, we still fingerprint
      // the raw object so the hook-integrity check isn't silently skipped.
      // A strict-parse failure here is non-fatal — the fingerprint is best-effort.
      const validated = Settings.safeParse(mergedParsed);
      const mergedSettings = validated.success ? validated.data : mergedParsed;
      if (!validated.success) {
        const issues = validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        debug(`settings.json failed schema validation after merge (fingerprinting raw): ${issues}`);
      }
      await writeHooksFingerprint(mergedSettings, CLAUDE_DIR);
    } catch {
      // Fingerprint write is best-effort. A failed write means verify-hooks.ts
      // prints a "missing fingerprint" nudge on next session; it never blocks.
    }
  } finally {
    await rm(teamStaged, { force: true }).catch(() => {});
  }
}

/**
 * Remove cc-settings-managed MCP servers from ~/.claude.json, preserving
 * any user-only servers. Called during a light install — light has no team
 * MCP servers, so the full install's context7 etc. must be removed.
 */
async function removeManagedMcpServers(fullComposed: Record<string, unknown>): Promise<void> {
  const fullMcp = (
    fullComposed.mcpServers !== null && typeof fullComposed.mcpServers === "object"
      ? fullComposed.mcpServers
      : {}
  ) as Record<string, unknown>;
  if (Object.keys(fullMcp).length === 0) return;

  const parsed = await readJsonOrNull(CLAUDE_JSON_PATH);
  if (!parsed || typeof parsed !== "object") return;
  const current = parsed as Record<string, unknown>;
  const currentMcp = (
    current.mcpServers !== null && typeof current.mcpServers === "object" ? current.mcpServers : {}
  ) as Record<string, unknown>;

  // Remove only the keys that are cc-settings-managed (present in full baseline).
  const next: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(currentMcp)) {
    if (!(key in fullMcp)) {
      next[key] = val;
    }
  }

  const updated = { ...current };
  if (Object.keys(next).length === 0) {
    delete updated.mcpServers;
  } else {
    updated.mcpServers = next;
  }
  await atomicWriteJson(CLAUDE_JSON_PATH, updated);
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

  detectPackageManagers();

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
  const tmp = join(CLAUDE_DIR, ".cc-settings-version.tmp");
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tmp, join(CLAUDE_DIR, ".cc-settings-version"));
}

// --- Summary -------------------------------------------------------------

async function countEntries(dir: string, pattern: RegExp): Promise<number> {
  const full = join(CLAUDE_DIR, dir);
  if (!existsSync(full)) return 0;
  try {
    const entries = await readdir(full);
    return entries.filter((e) => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

async function showSummary(profile: Profile): Promise<void> {
  const profileLabel = profile === "light" ? " [light]" : "";
  console.log("");
  boxStart(`Installed${profileLabel}`);
  if (profile === "light") {
    boxLine("ok", "settings.json ($schema + statusLine only)");
    boxLine("ok", "skills/share-learning");
    boxLine("ok", "src/      (TS; statusLine + libs)");
    boxLine("ok", "memory/");
  } else {
    const [agentCount, profileCount, ruleCount, contextCount] = await Promise.all([
      countEntries("agents", /\.md$/),
      countEntries("profiles", /\.md$/),
      countEntries("rules", /\.md$/),
      countEntries("contexts", /\.md$/),
    ]);
    boxLine("ok", "CLAUDE.md (Claude-Code config)");
    boxLine("ok", "AGENTS.md (portable standards)");
    boxLine("ok", "settings.json (TS hooks)");
    boxLine("ok", "~/.claude.json (MCP servers)");
    boxLine("ok", `agents/ (${agentCount})`);
    boxLine("ok", `profiles/ (${profileCount})`);
    boxLine("ok", `rules/ (${ruleCount})`);
    boxLine("ok", `contexts/ (${contextCount})`);
    boxLine("ok", "skills/");
    boxLine("ok", "src/      (TS; hooks + scripts + libs + schemas)");
    boxLine("ok", "docs/");
    boxLine("ok", "memory/");
  }
  boxEnd();

  if (profile === "light") {
    console.log("");
    console.log(
      `${palette.dim}Light profile: raw Claude Code · statusLine · share-learning skill only${palette.reset}`,
    );
    console.log(
      `${palette.dim}No CLAUDE.md, AGENTS.md, MCP servers, hooks, or effort override.${palette.reset}`,
    );
    console.log(`${palette.dim}Re-run without --light to upgrade to full.${palette.reset}`);
  }

  const claudeJson = (await readJsonOrNull(CLAUDE_JSON_PATH)) as {
    mcpServers?: Record<string, { _status?: unknown }>;
  } | null;
  const servers = Object.entries(claudeJson?.mcpServers ?? {});
  if (servers.length > 0) {
    console.log("");
    console.log(`${palette.bold}MCP servers in ~/.claude.json:${palette.reset}`);
    // Group by `_status` annotation. Servers without a status are listed as
    // "user-added" — they came from the user's machine, not the team config.
    const core: string[] = [];
    const optional: string[] = [];
    const userAdded: string[] = [];
    for (const [name, server] of servers) {
      const status = (server as { _status?: unknown })._status;
      if (status === "core") core.push(name);
      else if (status === "optional") optional.push(name);
      else userAdded.push(name);
    }
    if (core.length > 0) {
      console.log(`  ${palette.dim}core:${palette.reset}`);
      for (const s of core) console.log(`    - ${s}`);
    }
    if (optional.length > 0) {
      console.log(`  ${palette.dim}optional (manually added):${palette.reset}`);
      for (const s of optional) console.log(`    - ${s}`);
    }
    if (userAdded.length > 0) {
      console.log(`  ${palette.dim}user-added:${palette.reset}`);
      for (const s of userAdded) console.log(`    - ${s}`);
    }
  }
}

// --- Dry run -------------------------------------------------------------

async function cmdDryRun(source: string, profile: Profile): Promise<void> {
  const profileLabel = profile === "light" ? " [light profile]" : "";
  console.log(`cc-settings installer v${VERSION} — dry-run${profileLabel}`);
  console.log(`source: ${source}`);
  console.log(`target: ${CLAUDE_DIR}`);
  console.log("");

  if (profile === "light") {
    console.log("Would install (light = raw Claude Code + statusLine + share-learning):");
    const items: Array<[string, string]> = [
      ["skills/share-learning/", "→ ~/.claude/skills/share-learning/"],
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ["config/", "→ ~/.claude/settings.json ($schema + statusLine only)"],
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(28)} ${effect}`);
    }
    console.log("");
    console.log("Light profile: no CLAUDE.md · no AGENTS.md · no MCP servers · no hooks");
    console.log("               no agents · no rules · no profiles · no contexts · no docs");
    console.log("               default Claude Code permissions · default effort");
  } else {
    console.log("Would install:");
    const items: Array<[string, string]> = [
      ["CLAUDE-FULL.md", "→ ~/.claude/CLAUDE.md"],
      ["AGENTS.md", "→ ~/.claude/AGENTS.md"],
      ["config/", "→ ~/.claude/settings.json (composed + MCP-merged)"],
      ["src/", "→ ~/.claude/src/ (all TS)"],
      ["agents/", "→ ~/.claude/agents/"],
      ["skills/", "→ ~/.claude/skills/"],
      ["profiles/", "→ ~/.claude/profiles/"],
      ["rules/", "→ ~/.claude/rules/"],
      ["contexts/", "→ ~/.claude/contexts/"],
      ["hooks/", "→ ~/.claude/hooks/"],
      ["docs/", "→ ~/.claude/docs/"],
    ];
    for (const [rel, effect] of items) {
      const mark = existsSync(join(source, rel)) ? "✓" : " ";
      console.log(`  ${mark} ${rel.padEnd(22)} ${effect}`);
    }
  }

  console.log("");
  console.log("No files written. Re-run without --dry-run to install.");
}

// --- Status --------------------------------------------------------------

function printStatus(data: StatusData): void {
  console.log("cc-settings --status");
  console.log("");

  // Installed version
  if (data.sentinel.version) {
    const profileLabel = data.sentinel.profile ? ` [${data.sentinel.profile}]` : "";
    console.log(
      `  installed: v${data.sentinel.version}${profileLabel}  (${data.sentinel.installedAt ?? "unknown"})`,
    );
  } else {
    console.log(
      `  installed: ${palette.yellow}none${palette.reset}  (no sentinel at ~/.claude/.cc-settings-version)`,
    );
  }
  console.log(`  packaged:  v${data.packagedVersion}`);

  // Git drift
  if (data.git?.sha) {
    const g = data.git;
    const driftNote =
      g.behind === null
        ? "(sentinel absent — can't compute drift)"
        : g.behind === 0
          ? `${palette.green}up to date${palette.reset}`
          : `${palette.yellow}${g.behind} commit(s) since install${palette.reset}`;
    console.log(`  repo HEAD: ${g.sha}  ${driftNote}`);
  }

  console.log("");
  console.log("Managed skills:");
  console.log(`  present: ${data.skills.presentCount}/${data.skills.shippedCount}`);
  if (data.skills.missing.length > 0) {
    console.log(`  missing: ${data.skills.missing.join(", ")}`);
  }

  console.log("");
  console.log("Hooks:");
  console.log(
    `  events registered: ${data.hooks.events.length}  (${data.hooks.groupCount} group(s) total)`,
  );
  if (data.hooks.events.length > 0) {
    console.log(`  ${data.hooks.events.sort().join(", ")}`);
  }

  console.log("");
  console.log("Env vars:");
  for (const { key, value } of data.envVars) {
    const mark =
      value === undefined
        ? `${palette.yellow}✗${palette.reset}`
        : `${palette.green}✓${palette.reset}`;
    const val = value === undefined ? "(unset)" : value;
    console.log(`  ${mark} ${key}=${val}`);
  }

  console.log("");
  console.log("Permissions:");
  console.log(`  allow: ${data.permissions.allowCount}  deny: ${data.permissions.denyCount}`);

  console.log("");
  console.log("MCP servers:");
  const { servers } = data.mcp;
  console.log(
    `  configured: ${servers.length}${servers.length > 0 ? `  (${servers.join(", ")})` : ""}`,
  );

  console.log("");

  if (data.warnings.length === 0) {
    success("all checks passed");
  } else {
    for (const { message } of data.warnings) warn(message);
  }
}

async function cmdStatus(sourceDir: string): Promise<number> {
  const data = await gatherStatus(sourceDir, CLAUDE_DIR, VERSION);
  printStatus(data);
  return 0; // status is informational; never fail
}

// --- Main ----------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.status) {
    return await cmdStatus(args.sourceDir);
  }
  if (args.rollback !== null) {
    return await cmdRollback(args.rollback);
  }
  if (args.dryRun) {
    await cmdDryRun(args.sourceDir, args.profile);
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

  if (args.migrateOnly) {
    info("Migrate-only: backup + merger + sentinel; skipping file copy");
    await createBackup();
    await createDirectories(); // idempotent — ensures ~/.claude/ shape exists for merger
  } else {
    info("Installing dependencies...");
    await installDependencies(args.profile);
    printPreflightReport(checkCliTools());

    info("Creating backup...");
    await createBackup();

    info("Installing configuration...");
    await createDirectories();
    await cleanOldConfig();
    // For light: remove dirs that full installs but light must not have
    // (CLAUDE.md, AGENTS.md, agents/, rules/, profiles/, contexts/, docs/).
    // Must run AFTER cleanOldConfig so any leftover full-install content is gone.
    if (args.profile === "light") {
      await removeLightIncompatibleFiles();
    }
    // Disjoint destination trees (config dirs vs ~/.claude/src), so install both
    // in parallel. Both must follow the clean above.
    await Promise.all([
      installConfigFiles(args.sourceDir, args.profile),
      installTsSources(args.sourceDir),
    ]);
  }

  try {
    await installSettings(args.sourceDir, args.interactive, args.profile);
  } catch (err) {
    // JsonParseError is the one we want to surface loudly — see lib/json-io.ts.
    if ((err as JsonParseError).name === "JsonParseError") {
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
