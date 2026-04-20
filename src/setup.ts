#!/usr/bin/env bun
// cc-settings installer (full TypeScript port of setup.sh v8.0).
//
// Invoked by the bash bootstrap at repo root (`setup.sh`) which:
//   1. Handles `bash <(curl ...)` by cloning the repo.
//   2. Ensures Bun is installed.
//   3. Execs `bun "$REPO/src/setup.ts" --source="$REPO"`.
//
// Direct invocation from a cloned repo works too: `bun src/setup.ts`.
//
// Flags:
//   --source=<dir>          Explicit source directory (defaults to ../ from this file).
//   --rollback[=TS]         Restore newest backup (or a timestamp match) from ~/.claude/backups.
//   --dry-run               Print planned actions without touching disk.
//   --ts-hooks              Install settings.json with TS hook paths (CC_USE_TS_HOOKS=1 equivalent).
//   --help, -h              Usage.
//
// CC_USE_TS_HOOKS=1 in env is equivalent to --ts-hooks. Default is OFF (bash
// hooks) until the 7-day shadow observation window completes. See
// docs/migration-coexistence.md.

import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
import {
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

const VERSION = "9.0"; // bumped from 8.0: bash → TS installer
const CLAUDE_DIR = join(homedir(), ".claude");

// --- Arg parsing ---------------------------------------------------------

type Args = {
  rollback: string | true | null;
  dryRun: boolean;
  tsHooks: boolean;
  help: boolean;
  sourceDir: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    rollback: null,
    dryRun: false,
    tsHooks: process.env.CC_USE_TS_HOOKS === "1" || process.env.CC_USE_TS_HOOKS === "true",
    help: false,
    sourceDir: resolve(import.meta.dir, ".."),
  };
  for (const a of argv) {
    if (a === "--rollback") args.rollback = true;
    else if (a.startsWith("--rollback=")) args.rollback = a.slice("--rollback=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--ts-hooks") args.tsHooks = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--source=")) args.sourceDir = resolve(a.slice("--source=".length));
  }
  return args;
}

function printHelp(): void {
  console.log(`cc-settings installer v${VERSION}

Usage: bun src/setup.ts [flags]

Flags:
  --source=<dir>      Source repo path (default: parent of setup.ts).
  --rollback[=TS]     Restore newest backup, or one matching timestamp TS.
  --dry-run           Print planned actions; do not touch disk.
  --ts-hooks          Install with TS hook paths (or set CC_USE_TS_HOOKS=1).
  --help, -h          Show this message.

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
    "scripts",
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
    "lib",
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
  "checkpoint",
  "component",
  "consolidate",
  "context",
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
  "teams",
  "test",
  "tldr",
  "verify",
  "versions",
];

async function cleanOldConfig(): Promise<void> {
  const removeGlob = async (dir: string, pattern: RegExp) => {
    const full = join(CLAUDE_DIR, dir);
    if (!existsSync(full)) return;
    const entries = await readdir(full).catch(() => []);
    for (const e of entries) if (pattern.test(e)) await rm(join(full, e), { force: true });
  };
  await removeGlob("lib", /\.sh$/);
  await removeGlob("scripts", /\.sh$/);
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

async function copyIfPresent(
  src: string,
  dst: string,
  opts: { recursive?: boolean } = {},
): Promise<boolean> {
  if (!existsSync(src)) return false;
  await cp(src, dst, { recursive: opts.recursive ?? false, force: true });
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

  for (const d of [
    "lib",
    "scripts",
    "agents",
    "skills",
    "profiles",
    "rules",
    "contexts",
    "hooks",
    "docs",
  ]) {
    await copyDirContents(join(source, d), join(CLAUDE_DIR, d));
  }
  // Mark shell scripts executable (bash side still authoritative during migration).
  const scriptsDir = join(CLAUDE_DIR, "scripts");
  if (existsSync(scriptsDir)) {
    for (const e of await readdir(scriptsDir)) {
      if (e.endsWith(".sh")) await chmod(join(scriptsDir, e), 0o755).catch(() => {});
    }
  }

  // hooks-config.json — install only if missing or source is newer.
  const srcHooksCfg = join(source, "hooks-config.json");
  const dstHooksCfg = join(CLAUDE_DIR, "hooks-config.json");
  if (existsSync(srcHooksCfg)) {
    let shouldCopy = !existsSync(dstHooksCfg);
    if (!shouldCopy) {
      const [s, d] = await Promise.all([
        Bun.file(srcHooksCfg).stat(),
        Bun.file(dstHooksCfg).stat(),
      ]);
      shouldCopy = s.mtimeMs > d.mtimeMs;
    }
    if (shouldCopy) await cp(srcHooksCfg, dstHooksCfg, { force: true });
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

  // Link back to source for dep resolution. Phase 6 cutover promotes
  // ~/.claude/src to a standalone dir with its own node_modules.
  await copyIfPresent(join(source, "package.json"), join(dstTs, "package.json"));
  await copyIfPresent(join(source, "tsconfig.json"), join(dstTs, "tsconfig.json"));
  await copyIfPresent(join(source, "bun.lock"), join(dstTs, "bun.lock"));

  // Symlink node_modules so bun can resolve imports from installed hooks
  // without re-running bun install under ~/.claude.
  const srcNm = join(source, "node_modules");
  const dstNm = join(dstTs, "node_modules");
  if (existsSync(srcNm) && !existsSync(dstNm)) {
    try {
      await Bun.spawn(["ln", "-s", srcNm, dstNm], { stdout: "ignore", stderr: "ignore" }).exited;
    } catch {
      // Windows / no ln — fall back to copy. Heavy but correct.
      await cp(srcNm, dstNm, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// --- Hook-command rewriting (CC_USE_TS_HOOKS support) --------------------

// Map bash hook paths → TS hook paths for the six we've ported to src/hooks/
// vs src/scripts/. Entries not in the map are left alone (keeps inline
// `bash -c '…'` blocks untouched for Phase 6.2 extraction).
//
// Note: shadow wrapper (scripts/safety-net-shadow.sh) is NOT wired here.
// The 141 parity test cases already prove TS↔bash equivalence; the rollback
// path (`bun src/setup.ts --rollback`) is the production safety net. The
// shadow wrapper stays in the repo as opt-in tooling for future risky ports.
const HOOK_REWRITE: ReadonlyArray<{ bash: RegExp; ts: string }> = [
  { bash: /\/scripts\/safety-net\.sh/g, ts: "/src/hooks/safety-net.ts" },
  { bash: /\/scripts\/statusline\.sh/g, ts: "/src/hooks/statusline.ts" },
  { bash: /\/scripts\/pre-edit-validate\.sh/g, ts: "/src/hooks/pre-edit-validate.ts" },
  { bash: /\/scripts\/skill-activation\.sh/g, ts: "/src/hooks/skill-activation.ts" },
  { bash: /\/scripts\/post-edit\.sh/g, ts: "/src/scripts/post-edit.ts" },
  { bash: /\/scripts\/post-edit-tsc\.sh/g, ts: "/src/scripts/post-edit-tsc.ts" },
  { bash: /\/scripts\/post-compact\.sh/g, ts: "/src/scripts/post-compact.ts" },
  { bash: /\/scripts\/post-failure\.sh/g, ts: "/src/scripts/post-failure.ts" },
  { bash: /\/scripts\/stop-failure\.sh/g, ts: "/src/scripts/stop-failure.ts" },
  { bash: /\/scripts\/session-start\.sh/g, ts: "/src/scripts/session-start.ts" },
  { bash: /\/scripts\/log-bash\.sh/g, ts: "/src/scripts/log-bash.ts" },
  { bash: /\/scripts\/track-tldr\.sh/g, ts: "/src/scripts/track-tldr.ts" },
  { bash: /\/scripts\/tldr-stats\.sh/g, ts: "/src/scripts/tldr-stats.ts" },
  { bash: /\/scripts\/notify\.sh/g, ts: "/src/scripts/notify.ts" },
  {
    bash: /\/scripts\/check-docs-before-install\.sh/g,
    ts: "/src/scripts/check-docs-before-install.ts",
  },
  { bash: /\/scripts\/handoff\.sh/g, ts: "/src/scripts/handoff.ts" },
];

// Inline `bash -c '…'` hooks matched by a distinctive substring and routed
// to their extracted TS counterpart. Content-match is fragile but the
// source-of-truth is settings.json in this repo, which we control — a
// mismatch shows up immediately in tests/setup-rewrite.test.ts.
const INLINE_REWRITE: ReadonlyArray<{ marker: string; ts: string; arg?: string }> = [
  { marker: "Correction detected", ts: "/src/scripts/detect-correction.ts" },
  { marker: "Pre-commit Hook", ts: "/src/scripts/pre-commit-tsc.ts" },
  { marker: "Session had significant changes", ts: "/src/scripts/stop-summary.ts" },
  { marker: "Agent started:", ts: "/src/scripts/swarm-log.ts", arg: "start" },
  { marker: "Agent stopped:", ts: "/src/scripts/swarm-log.ts", arg: "stop" },
  { marker: "Task created:", ts: "/src/scripts/swarm-log.ts", arg: "task" },
];

export function rewriteHookCommands(command: string): string {
  const trimmed = command.trim();

  // Case 1: `bash "path.sh"` → `bun "path.ts"`.
  if (/^bash\s+["']\S+\.sh["']/.test(trimmed)) {
    let out = command.replace(/^\s*bash\s+/, "bun ");
    for (const { bash, ts } of HOOK_REWRITE) out = out.replace(bash, ts);
    return out;
  }

  // Case 2: Inline `bash -c '…'` → `bun .../src/scripts/X.ts [arg]` if the
  // body carries a known marker; else leave as-is.
  if (/^bash\s+-c\s/.test(trimmed)) {
    for (const { marker, ts, arg } of INLINE_REWRITE) {
      if (command.includes(marker)) {
        const path = `$HOME/.claude${ts}`;
        return arg ? `bun "${path}" ${arg}` : `bun "${path}"`;
      }
    }
  }
  return command;
}

export function rewriteSettingsForTs(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return settings;
  const nextHooks: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      nextHooks[event] = groups;
      continue;
    }
    nextHooks[event] = groups.map((group) => {
      const g = group as { hooks?: unknown[] };
      if (!Array.isArray(g.hooks)) return group;
      const nextInner = g.hooks.map((h) => {
        const hook = h as { type?: string; command?: string };
        if (hook.type !== "command" || !hook.command) return h;
        return { ...hook, command: rewriteHookCommands(hook.command) };
      });
      return { ...group, hooks: nextInner };
    });
  }
  return { ...settings, hooks: nextHooks };
}

// --- Settings + MCP install ---------------------------------------------

async function installSettings(source: string, tsHooks: boolean): Promise<void> {
  const teamSettingsPath = join(source, "settings.json");
  const userSettingsPath = join(CLAUDE_DIR, "settings.json");
  if (!existsSync(teamSettingsPath)) {
    error("Team settings.json not found at source.");
    process.exit(1);
  }

  const teamRaw = await readFile(teamSettingsPath, "utf8");
  const team = JSON.parse(teamRaw) as Record<string, unknown>;
  const teamFinal = tsHooks ? rewriteSettingsForTs(team) : team;

  // Write rewritten team settings to a temp path so the MCP-preservation merge
  // reads the correct hook commands.
  const tempTeam = join(CLAUDE_DIR, ".cc-team-settings.json.tmp");
  await writeFile(tempTeam, `${JSON.stringify(teamFinal, null, 2)}\n`);

  try {
    await mergeSettingsWithMcpPreservation(userSettingsPath, tempTeam, userSettingsPath);
    await installMcpToClaudeJson(tempTeam);
  } finally {
    await rm(tempTeam, { force: true }).catch(() => {});
  }
}

// --- Dependencies --------------------------------------------------------

async function installDependencies(): Promise<void> {
  detectPackageManagers();

  if (!hasCommand("jq")) {
    const ok = await ensureSystemPackage("jq");
    if (!ok) warn(`Install jq manually: ${getInstallHint("jq")}`);
  }

  // Optional: pipx (via system PM), pinchtab, agent-browser, llm-tldr
  if (!hasCommand("pipx")) await ensureSystemPackage("pipx").catch(() => false);
  if (!hasCommand("pinchtab")) await ensureNpmGlobal("pinchtab").catch(() => false);
  if (!hasCommand("agent-browser")) await ensureNpmGlobal("agent-browser").catch(() => false);
  if (!hasCommand("tldr") && !hasCommand("tldr-mcp")) {
    await ensurePythonPackage("llm-tldr", "tldr").catch(() => false);
  }
}

async function compileSkillIndex(): Promise<boolean> {
  // Prefer the TS port if present; fall back to the bash script.
  const tsPort = join(CLAUDE_DIR, "src", "scripts", "compile-skills.ts");
  const bashScript = join(CLAUDE_DIR, "scripts", "compile-skills.sh");
  const cmd = existsSync(tsPort)
    ? ["bun", tsPort, "--force"]
    : existsSync(bashScript)
      ? ["bash", bashScript, "--force"]
      : null;
  if (!cmd) return false;
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

async function writeVersionSentinel(tsHooks: boolean): Promise<void> {
  const payload = {
    version: VERSION,
    installed_at: new Date().toISOString(),
    installer: "src/setup.ts",
    tsHooks,
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

async function showSummary(tsHooks: boolean): Promise<void> {
  console.log("");
  boxStart("Installed");
  boxLine("ok", "CLAUDE.md (Claude-Code config)");
  boxLine("ok", "AGENTS.md (portable standards)");
  boxLine("ok", `settings.json (${tsHooks ? "TS hooks" : "bash hooks"})`);
  boxLine("ok", "~/.claude.json (MCP servers)");
  boxLine("ok", `agents/ (${await countEntries("agents", /\.md$/)})`);
  boxLine("ok", `profiles/ (${await countEntries("profiles", /\.md$/)})`);
  boxLine("ok", `rules/ (${await countEntries("rules", /\.md$/)})`);
  boxLine("ok", `contexts/ (${await countEntries("contexts", /\.md$/)})`);
  boxLine("ok", "skills/");
  boxLine("ok", "scripts/  (bash, authoritative until Phase 7)");
  boxLine("ok", "src/      (TS ports; hooks invoke when CC_USE_TS_HOOKS=1)");
  boxLine("ok", "docs/");
  boxLine("ok", "memory/");
  boxEnd();

  // MCP summary read directly from ~/.claude.json.
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

async function cmdDryRun(source: string, tsHooks: boolean): Promise<void> {
  console.log(`cc-settings installer v${VERSION} — dry-run`);
  console.log(`source:    ${source}`);
  console.log(`target:    ${CLAUDE_DIR}`);
  console.log(`hookMode:  ${tsHooks ? "ts" : "bash (default)"}`);
  console.log("");
  console.log("Would install:");
  const items: Array<[string, string]> = [
    ["CLAUDE-FULL.md", "→ ~/.claude/CLAUDE.md"],
    ["AGENTS.md", "→ ~/.claude/AGENTS.md"],
    ["settings.json", "→ ~/.claude/settings.json (MCP-merged)"],
    ["scripts/", "→ ~/.claude/scripts/ (bash hooks)"],
    ["src/", "→ ~/.claude/src/ (TS ports)"],
    ["lib/", "→ ~/.claude/lib/"],
    ["agents/", "→ ~/.claude/agents/"],
    ["skills/", "→ ~/.claude/skills/"],
    ["profiles/", "→ ~/.claude/profiles/"],
    ["rules/", "→ ~/.claude/rules/"],
    ["contexts/", "→ ~/.claude/contexts/"],
    ["hooks/", "→ ~/.claude/hooks/"],
    ["docs/", "→ ~/.claude/docs/"],
    ["hooks-config.json", "→ ~/.claude/hooks-config.json (if newer)"],
  ];
  for (const [rel, effect] of items) {
    const mark = existsSync(join(source, rel)) ? "✓" : " ";
    console.log(`  ${mark} ${rel.padEnd(22)} ${effect}`);
  }
  console.log("");
  console.log("No files written. Re-run without --dry-run to install.");
}

// --- Main ----------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.rollback !== null) {
    return await cmdRollback(args.rollback);
  }
  if (args.dryRun) {
    await cmdDryRun(args.sourceDir, args.tsHooks);
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
    await installSettings(args.sourceDir, args.tsHooks);
  } catch (err) {
    // McpParseError is the one we want to surface loudly — see lib/mcp.ts.
    if ((err as McpParseError).name === "McpParseError") {
      error(String((err as Error).message));
      error("Aborting. Fix the corrupt JSON or rollback: bun src/setup.ts --rollback");
      return 1;
    }
    throw err;
  }

  info("Compiling skill index...");
  if (await compileSkillIndex()) success("Skill index compiled");
  else warn("Skill index compilation skipped (will compile on first session)");

  await writeVersionSentinel(args.tsHooks);
  await showSummary(args.tsHooks);

  console.log("");
  console.log(`Installed to: ${palette.cyan}${CLAUDE_DIR}${palette.reset}`);
  console.log("");
  if (args.tsHooks) {
    info("TS hooks active. Rollback: bun src/setup.ts --rollback");
  } else {
    const hint = `${palette.cyan}CC_USE_TS_HOOKS=1 bash setup.sh${palette.reset}`;
    info(`Bash hooks active. To enable TS hooks: ${hint}`);
  }
  success("Restart Claude Code to apply changes.");
  console.log("");
  return 0;
}

// Only run main() when invoked directly (`bun src/setup.ts`). Tests that
// import from this module must not trigger an install.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      error(`Setup failed: ${err?.stack ?? err}`);
      process.exit(1);
    });
}

// Silence unused-import lints for symbols we reference only in comments
// or code paths not taken on every platform.
void basename;
void dirname;
