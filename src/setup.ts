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
//   --help, -h         Usage.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  boxEnd,
  boxLine,
  boxStart,
  error,
  info,
  palette,
  showBanner,
  success,
  warn,
} from "./lib/colors.ts";
import { composeSettings } from "./lib/compose-settings.ts";
import {
  atomicWriteJson,
  CLAUDE_JSON_PATH,
  installMcpToClaudeJson,
  type McpParseError,
  mergeSettingsWithMcpPreservation,
  readJsonOrNull,
} from "./lib/mcp.ts";
import {
  detectPackageManagers,
  ensureNpmGlobal,
  ensurePythonPackage,
  ensureSystemPackage,
  getInstallHint,
} from "./lib/packages.ts";
import { getTimestamp, hasCommand, isWindows } from "./lib/platform.ts";

const VERSION = "10.3.0"; // v2.1.121 sync: alwaysLoad MCP, mcp_tool hooks, prUrlTemplate, statusline effort, agent permissionMode
const CLAUDE_DIR = join(homedir(), ".claude");

// --- Arg parsing ---------------------------------------------------------

type Args = {
  rollback: string | true | null;
  dryRun: boolean;
  status: boolean;
  help: boolean;
  sourceDir: string;
  interactive: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    rollback: null,
    dryRun: false,
    status: false,
    help: false,
    sourceDir: resolve(import.meta.dir, ".."),
    // CC_INTERACTIVE=1 opts in for scripts/CI without argv juggling.
    interactive: process.env.CC_INTERACTIVE === "1",
  };
  for (const a of argv) {
    if (a === "--rollback") args.rollback = true;
    else if (a.startsWith("--rollback=")) args.rollback = a.slice("--rollback=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--status") args.status = true;
    else if (a === "--interactive") args.interactive = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--source=")) args.sourceDir = resolve(a.slice("--source=".length));
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
  --status           Report installed version, drift vs repo HEAD, missing
                     managed skills, hooks, key env vars, and MCP servers.
  --interactive      Prompt on settings.json conflicts (scalar overrides, team
                     additions to allow/ask rules, new hook groups). Also opt in
                     via CC_INTERACTIVE=1.
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
  const proc = Bun.spawn(["tar", "-xzf", join(backupDir, match)], {
    cwd: CLAUDE_DIR,
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

  const candidates = ["settings.json", "CLAUDE.md", "AGENTS.md"];
  const existing = candidates.filter((f) => existsSync(join(CLAUDE_DIR, f)));
  if (existing.length === 0) return;

  const stamp = getTimestamp();
  const archive = join(backupDir, `backup-${stamp}.tar.gz`);
  const proc = Bun.spawn(["tar", "-czf", archive, ...existing], {
    cwd: CLAUDE_DIR,
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;

  // Keep last 5.
  const kept = (await readdir(backupDir)).filter((e) => /^backup-.*\.tar\.gz$/.test(e)).sort();
  if (kept.length > 5) {
    for (const old of kept.slice(0, kept.length - 5)) {
      await rm(join(backupDir, old), { force: true }).catch(() => {});
    }
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
  for (const d of dirs) await mkdir(join(CLAUDE_DIR, d), { recursive: true });
}

// Managed skill directories — only these are wiped on re-install so users
// can keep hand-authored skills in skills/ without losing them.
const MANAGED_SKILLS = [
  "ask",
  "audit",
  "autoresearch",
  "build",
  "cc-sync",
  "cc-update",
  "checkpoint",
  "component",
  "consolidate",
  "context",
  "context-doc",
  "create-handoff",
  "debug",
  "design-tokens",
  "discovery",
  "docs",
  "explore",
  "f-thread",
  "figma",
  "fix",
  "hook",
  "init",
  "l-thread",
  "learn",
  "lenis",
  "lighthouse",
  "orchestrate",
  "prd",
  "premortem",
  "project",
  "qa",
  "refactor",
  "resume-handoff",
  "review",
  "ship",
  "tdd",
  "teams",
  "test",
  "tldr",
  "verify",
  "write-a-skill",
  "zoom-out",
  // Kept for upgrade cleanup; skill was removed (superseded by `docs` + `check-docs-before-install` hook).
  "versions",
];

async function cleanOldConfig(): Promise<void> {
  const removeGlob = async (dir: string, pattern: RegExp) => {
    const full = join(CLAUDE_DIR, dir);
    if (!existsSync(full)) return;
    const entries = await readdir(full).catch(() => []);
    for (const e of entries) if (pattern.test(e)) await rm(join(full, e), { force: true });
  };

  // Wipe previously-installed bash artifacts (for upgraders from <10.0).
  await rm(join(CLAUDE_DIR, "scripts"), { recursive: true, force: true }).catch(() => {});
  await rm(join(CLAUDE_DIR, "lib"), { recursive: true, force: true }).catch(() => {});
  await rm(join(CLAUDE_DIR, "hooks-config.json"), { force: true }).catch(() => {});
  await rm(join(CLAUDE_DIR, "hooks-config.local.json"), { force: true }).catch(() => {});

  // Fresh wipe of managed content (we re-install it below).
  await removeGlob("agents", /\.md$/);
  await removeGlob("skills", /\.(json|md)$/);
  await removeGlob("profiles", /\.md$/);
  await removeGlob("rules", /\.md$/);
  await removeGlob("contexts", /\.md$/);
  await removeGlob("hooks", /\.md$/);
  await removeGlob("docs", /\.md$/);

  for (const s of MANAGED_SKILLS) {
    await rm(join(CLAUDE_DIR, "skills", s), { recursive: true, force: true });
  }

  for (const junk of [
    "skill-rules.cache",
    "skill-activation.out",
    "skill-index.compiled",
    "skill-index.checksum",
    "CLAUDE.md",
    "AGENTS.md",
  ]) {
    await rm(join(CLAUDE_DIR, junk), { force: true }).catch(() => {});
  }
}

async function copyIfPresent(src: string, dst: string): Promise<boolean> {
  if (!existsSync(src)) return false;
  await cp(src, dst, { recursive: false, force: true });
  return true;
}

async function copyDirContents(srcDir: string, dstDir: string): Promise<void> {
  if (!existsSync(srcDir)) return;
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = join(srcDir, e.name);
    const dst = join(dstDir, e.name);
    await cp(src, dst, { recursive: true, force: true });
  }
}

async function installConfigFiles(source: string): Promise<void> {
  await copyIfPresent(join(source, "CLAUDE-FULL.md"), join(CLAUDE_DIR, "CLAUDE.md"));
  await copyIfPresent(join(source, "AGENTS.md"), join(CLAUDE_DIR, "AGENTS.md"));
  for (const d of ["agents", "skills", "profiles", "rules", "contexts", "hooks", "docs"]) {
    await copyDirContents(join(source, d), join(CLAUDE_DIR, d));
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
  await copyIfPresent(join(source, "package.json"), join(dstTs, "package.json"));
  await copyIfPresent(join(source, "tsconfig.json"), join(dstTs, "tsconfig.json"));
  await copyIfPresent(join(source, "bun.lock"), join(dstTs, "bun.lock"));

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

async function installSettings(source: string, interactive: boolean): Promise<void> {
  const userSettingsPath = join(CLAUDE_DIR, "settings.json");
  // Compose team settings from config/ fragments, stage to a temp file so the
  // existing merger (path-based) can consume them without API churn.
  const teamComposed = await composeSettings(source);
  const teamStaged = join(CLAUDE_DIR, ".team-settings.staged.json");
  await atomicWriteJson(teamStaged, teamComposed);
  try {
    await mergeSettingsWithMcpPreservation(userSettingsPath, teamStaged, userSettingsPath, {
      interactive,
    });
    await installMcpToClaudeJson(teamStaged);
  } finally {
    await rm(teamStaged, { force: true }).catch(() => {});
  }
}

// --- Dependencies --------------------------------------------------------

async function installDependencies(): Promise<void> {
  detectPackageManagers();

  if (!hasCommand("jq")) {
    const ok = await ensureSystemPackage("jq");
    if (!ok) warn(`Install jq manually: ${getInstallHint("jq")}`);
  }

  if (!hasCommand("pipx")) await ensureSystemPackage("pipx").catch(() => false);
  if (!hasCommand("pinchtab")) await ensureNpmGlobal("pinchtab").catch(() => false);
  if (!hasCommand("tldr") && !hasCommand("tldr-mcp")) {
    await ensurePythonPackage("llm-tldr", "tldr").catch(() => false);
  }
}

async function writeVersionSentinel(): Promise<void> {
  const payload = {
    version: VERSION,
    installed_at: new Date().toISOString(),
    installer: "src/setup.ts",
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

async function showSummary(): Promise<void> {
  console.log("");
  boxStart("Installed");
  boxLine("ok", "CLAUDE.md (Claude-Code config)");
  boxLine("ok", "AGENTS.md (portable standards)");
  boxLine("ok", "settings.json (TS hooks)");
  boxLine("ok", "~/.claude.json (MCP servers)");
  boxLine("ok", `agents/ (${await countEntries("agents", /\.md$/)})`);
  boxLine("ok", `profiles/ (${await countEntries("profiles", /\.md$/)})`);
  boxLine("ok", `rules/ (${await countEntries("rules", /\.md$/)})`);
  boxLine("ok", `contexts/ (${await countEntries("contexts", /\.md$/)})`);
  boxLine("ok", "skills/");
  boxLine("ok", "src/      (TS; hooks + scripts + libs + schemas)");
  boxLine("ok", "docs/");
  boxLine("ok", "memory/");
  boxEnd();

  const claudeJson = await readJsonOrNull<{ mcpServers?: Record<string, unknown> }>(
    CLAUDE_JSON_PATH,
  );
  const servers = Object.keys(claudeJson?.mcpServers ?? {});
  if (servers.length > 0) {
    console.log("");
    console.log(`${palette.bold}MCP servers in ~/.claude.json:${palette.reset}`);
    for (const s of servers) console.log(`  - ${s}`);
  }
}

// --- Dry run -------------------------------------------------------------

async function cmdDryRun(source: string): Promise<void> {
  console.log(`cc-settings installer v${VERSION} — dry-run`);
  console.log(`source: ${source}`);
  console.log(`target: ${CLAUDE_DIR}`);
  console.log("");
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
  console.log("");
  console.log("No files written. Re-run without --dry-run to install.");
}

// --- Status --------------------------------------------------------------

interface VersionSentinel {
  version?: string;
  installed_at?: string;
  installer?: string;
}

async function gitHeadInfo(sourceDir: string): Promise<{ sha: string; behind: number | null }> {
  const sha = await runCapture(["git", "-C", sourceDir, "rev-parse", "--short", "HEAD"]);
  // How many commits has HEAD advanced since the last install? We count with the
  // sentinel file's mtime as a rough lower bound — there's no installed-sha,
  // so this answers "anything changed since the sentinel was written?"
  const sentinelPath = join(CLAUDE_DIR, ".cc-settings-version");
  let behind: number | null = null;
  if (existsSync(sentinelPath)) {
    const since = (await Bun.file(sentinelPath).stat()).mtime.toISOString();
    const count = await runCapture([
      "git",
      "-C",
      sourceDir,
      "rev-list",
      "--count",
      `HEAD`,
      `--since=${since}`,
    ]);
    const n = Number.parseInt(count, 10);
    behind = Number.isFinite(n) ? n : null;
  }
  return { sha, behind };
}

async function runCapture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return proc.exitCode === 0 ? out.trim() : "";
}

async function cmdStatus(sourceDir: string): Promise<number> {
  console.log(`cc-settings --status`);
  console.log("");

  // Installed version
  const sentinelPath = join(CLAUDE_DIR, ".cc-settings-version");
  let sentinel: VersionSentinel | null = null;
  if (existsSync(sentinelPath)) {
    try {
      sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as VersionSentinel;
    } catch {
      // malformed — treat as absent
    }
  }
  if (sentinel?.version) {
    console.log(`  installed: v${sentinel.version}  (${sentinel.installed_at ?? "unknown"})`);
  } else {
    console.log(
      `  installed: ${palette.yellow}none${palette.reset}  (no sentinel at ~/.claude/.cc-settings-version)`,
    );
  }
  console.log(`  packaged:  v${VERSION}`);

  // Git drift — only if source is a git checkout.
  if (existsSync(join(sourceDir, ".git"))) {
    const { sha, behind } = await gitHeadInfo(sourceDir);
    if (sha) {
      const driftNote =
        behind === null
          ? "(sentinel absent — can't compute drift)"
          : behind === 0
            ? `${palette.green}up to date${palette.reset}`
            : `${palette.yellow}${behind} commit(s) since install${palette.reset}`;
      console.log(`  repo HEAD: ${sha}  ${driftNote}`);
    }
  }

  console.log("");
  console.log("Managed skills:");
  const skillsDir = join(CLAUDE_DIR, "skills");
  const installedSkills = existsSync(skillsDir)
    ? new Set(await readdir(skillsDir).catch(() => []))
    : new Set<string>();
  // Filter out skills that are in MANAGED_SKILLS only for cleanup (not shipped).
  const shippedSkills = MANAGED_SKILLS.filter((s) => existsSync(join(sourceDir, "skills", s)));
  const missing = shippedSkills.filter((s) => !installedSkills.has(s));
  console.log(`  present: ${shippedSkills.length - missing.length}/${shippedSkills.length}`);
  if (missing.length > 0) {
    console.log(`  missing: ${missing.join(", ")}`);
  }

  // Settings.json inspection
  const userSettingsPath = join(CLAUDE_DIR, "settings.json");
  const userSettings = (await readJsonOrNull<Record<string, unknown>>(userSettingsPath)) ?? {};

  const hooks = (userSettings.hooks ?? {}) as Record<string, unknown>;
  const hookEvents = Object.keys(hooks);
  const hookCount = hookEvents.reduce(
    (n, ev) => n + (Array.isArray(hooks[ev]) ? (hooks[ev] as unknown[]).length : 0),
    0,
  );
  console.log("");
  console.log("Hooks:");
  console.log(`  events registered: ${hookEvents.length}  (${hookCount} group(s) total)`);
  if (hookEvents.length > 0) {
    console.log(`  ${hookEvents.sort().join(", ")}`);
  }

  // Env var audit — surface the ones CLAUDE-FULL.md promises.
  const env = (userSettings.env ?? {}) as Record<string, unknown>;
  const expectedEnv = [
    "CLAUDE_CODE_EFFORT_LEVEL",
    "ENABLE_PROMPT_CACHING_1H",
    "ENABLE_TOOL_SEARCH",
    "CLAUDE_CODE_NO_FLICKER",
    "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
  ];
  console.log("");
  console.log("Env vars:");
  for (const k of expectedEnv) {
    const v = env[k];
    const mark =
      v === undefined ? `${palette.yellow}✗${palette.reset}` : `${palette.green}✓${palette.reset}`;
    const val = v === undefined ? "(unset)" : String(v);
    console.log(`  ${mark} ${k}=${val}`);
  }

  // Permissions
  const perms = (userSettings.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(perms.allow) ? (perms.allow as unknown[]).length : 0;
  const deny = Array.isArray(perms.deny) ? (perms.deny as unknown[]).length : 0;
  console.log("");
  console.log("Permissions:");
  console.log(`  allow: ${allow}  deny: ${deny}`);

  // MCP servers from ~/.claude.json
  const claudeJson = await readJsonOrNull<{ mcpServers?: Record<string, unknown> }>(
    CLAUDE_JSON_PATH,
  );
  const servers = Object.keys(claudeJson?.mcpServers ?? {});
  console.log("");
  console.log("MCP servers:");
  console.log(
    `  configured: ${servers.length}${servers.length > 0 ? `  (${servers.join(", ")})` : ""}`,
  );

  console.log("");

  // Summary row — was anything worth flagging?
  const warnings: string[] = [];
  if (missing.length > 0) warnings.push(`${missing.length} skill(s) missing`);
  if (sentinel?.version && sentinel.version !== VERSION) {
    warnings.push(`installed v${sentinel.version} ≠ packaged v${VERSION} (re-run to update)`);
  }
  const missingEnv = expectedEnv.filter((k) => env[k] === undefined);
  if (missingEnv.length > 0) warnings.push(`${missingEnv.length} env var(s) unset`);

  if (warnings.length === 0) {
    success("all checks passed");
  } else {
    for (const w of warnings) warn(w);
  }
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
    await cmdDryRun(args.sourceDir);
    return 0;
  }

  if (isWindows()) {
    warn("Windows is supported via setup.ps1 bootstrap; direct invocation is experimental.");
  }

  showBanner(VERSION);

  info("Installing dependencies...");
  await installDependencies();

  info("Creating backup...");
  await createBackup();

  info("Installing configuration...");
  await createDirectories();
  await cleanOldConfig();
  await installConfigFiles(args.sourceDir);
  await installTsSources(args.sourceDir);

  try {
    await installSettings(args.sourceDir, args.interactive);
  } catch (err) {
    // McpParseError is the one we want to surface loudly — see lib/mcp.ts.
    if ((err as McpParseError).name === "McpParseError") {
      error(String((err as Error).message));
      error("Aborting. Fix the corrupt JSON or rollback: bun src/setup.ts --rollback");
      return 1;
    }
    throw err;
  }

  await writeVersionSentinel();
  await showSummary();

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
