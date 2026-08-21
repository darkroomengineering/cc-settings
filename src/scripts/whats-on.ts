#!/usr/bin/env bun
// "What's on" report — answers "what is the USER-SCOPE installed state at
// ~/.claude, what does each piece do, and how do I switch it off." Reads
// ~/.claude (never the repo checkout), never mutates anything.
//
// This is deliberately NOT `bun src/setup.ts --status`: --status answers
// install-health questions (version drift, present/missing counts, auto-update
// enrollment). This answers effect questions — one line per thing, always with
// an off-switch — and cross-links to --status rather than duplicating it.
//
// SCOPE CAVEAT: this reads ~/.claude/settings.json only. Claude Code layers
// several other scopes on top at runtime — a project-level .claude/settings.json,
// .claude/settings.local.json, managed policy, and CLI flags — any of which can
// change the EFFECTIVE values without changing anything this report shows. This
// is deliberately not a full precedence resolver: it detects and flags a
// project-level settings.json in the cwd, and otherwise just names the other
// scopes that can override it.
//
// Usage:
//   bun run whats-on            # plain-text report against the real install
//   bun run whats-on --json     # same data, machine-readable
//
// Installed copy (works without the repo checkout):
//   bun ~/.claude/src/scripts/whats-on.ts

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { iterCommandHooks, parseHookCommand, parseHooksBlock } from "../lib/hook-command.ts";
import { readJsonOrNull } from "../lib/json-io.ts";
import { type InstallPaths, installPaths } from "../lib/platform.ts";
import { Settings } from "../schemas/settings.ts";

// --- Data shapes -----------------------------------------------------------

export interface OutputStyleInfo {
  /** The configured style name, or null when `outputStyle` is unset (built-in Default). */
  name: string | null;
  /** Whether a file in ~/.claude/output-styles/ resolves to `name` — matched
   *  against frontmatter `name:` first, then filenames case-insensitively.
   *  Null when name is null. */
  fileExists: boolean | null;
}

export interface AlwaysOnFileInfo {
  present: boolean;
  bytes: number;
}

export interface RulesInfo {
  /** Rule files with NO `paths:` frontmatter key — Claude Code injects these
   *  into every session, not just when a matching file is in play. */
  alwaysOnCount: number;
  /** Rule files WITH a `paths:` frontmatter key — only loaded when a matching
   *  file is in play. */
  pathConditionedCount: number;
  /** Filenames counted as always-on, sorted — named because they cost context
   *  every turn. */
  alwaysOnNames: string[];
}

export interface AlwaysOnInfo {
  claudeMd: AlwaysOnFileInfo;
  agentsMd: AlwaysOnFileInfo;
  rules: RulesInfo;
}

export interface ModelEffortInfo {
  model: string | null;
  effortLevel: string | undefined;
  subagentModel: string | undefined;
}

export interface HookScriptRow {
  /** e.g. "tool-cadence.ts" */
  basename: string;
  /** e.g. "hooks/tool-cadence.ts" — relative to ~/.claude/src */
  relPath: string;
  /** Hook events this script is wired to, sorted. */
  events: string[];
  /** First leading `//` comment line from the installed script, or null if none found. */
  description: string | null;
}

export interface HooksInfo {
  groupCount: number;
  eventCount: number;
  scripts: HookScriptRow[];
}

export interface InventoryInfo {
  skillsCount: number;
  agentsCount: number;
  mcpServers: string[];
  permissionsAllowCount: number;
  permissionsDenyCount: number;
}

export interface ScopeInfo {
  /** Absolute path to a project-level .claude/settings.json found in the cwd
   *  this report ran from, or null if none exists. Presence detection only —
   *  no precedence merging. When set, it (and .claude/settings.local.json,
   *  managed policy, and CLI flags) can override the user-scope values below
   *  without changing anything this report shows. */
  projectSettingsPath: string | null;
}

export interface WhatsOnData {
  outputStyle: OutputStyleInfo;
  alwaysOn: AlwaysOnInfo;
  modelEffort: ModelEffortInfo;
  hooks: HooksInfo;
  inventory: InventoryInfo;
  scope: ScopeInfo;
}

// --- Helpers -----------------------------------------------------------

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function fileInfo(path: string): Promise<AlwaysOnFileInfo> {
  try {
    const s = await stat(path);
    return { present: true, bytes: s.size };
  } catch {
    return { present: false, bytes: 0 };
  }
}

async function countDirEntries(dir: string, filter?: (name: string) => boolean): Promise<number> {
  try {
    const entries = await readdir(dir);
    return filter ? entries.filter(filter).length : entries.length;
  } catch {
    return 0;
  }
}

/** List `*.md` files directly inside `dir`, or [] if the dir is unreadable/absent. */
async function listMdFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((e) => e.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Parsed frontmatter object of a file, or {} on any read/parse failure —
 *  callers treat a missing key the same as a missing/unparseable file. */
async function frontmatterOf(path: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const fm = parseFrontmatter(content);
  return fm && typeof fm === "object" && !Array.isArray(fm) ? (fm as Record<string, unknown>) : {};
}

/** First leading `//` comment line of a script, after an optional shebang.
 *  Returns null (never fabricated) when no leading comment line is found. */
async function leadingCommentLine(path: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const lines = content.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  // Tolerate a single blank line between the shebang and the leading comment
  // block (several shipped scripts format it that way).
  if (lines[i]?.trim() === "") i++;
  const line = lines[i];
  if (!line?.trimStart().startsWith("//")) return null;
  const text = line
    .trimStart()
    .replace(/^\/\/\s?/, "")
    .trim();
  if (!text) return null;
  const MAX = 100;
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}

// --- Gathering ---------------------------------------------------------

/** Every `*.md` file in `dir`, mapped to its RESOLVED style name: the
 *  frontmatter `name:` value when present and a non-empty string, otherwise
 *  the filename (minus `.md`) — mirroring how Claude Code itself resolves an
 *  output style (frontmatter `name:`, falling back to the filename). */
async function resolvedOutputStyleNames(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const entry of await listMdFiles(dir)) {
    const base = entry.replace(/\.md$/, "");
    const fm = await frontmatterOf(join(dir, entry));
    const fmName = fm.name;
    map.set(base, typeof fmName === "string" && fmName.trim() ? fmName : base);
  }
  return map;
}

async function gatherOutputStyle(
  claudeDir: string,
  settingsOk: boolean,
  settings: Settings,
  rawObj: Record<string, unknown>,
): Promise<OutputStyleInfo> {
  const name = (settingsOk ? settings.outputStyle : asStr(rawObj.outputStyle)) ?? null;
  if (!name) return { name: null, fileExists: null };
  const resolved = await resolvedOutputStyleNames(join(claudeDir, "output-styles"));
  // Match resolved frontmatter names first (exact — that's the literal `name:`
  // value Claude Code reads), then fall back to filenames case-insensitively
  // (covers e.g. output-styles/darkroom.md with `name: Darkroom` on a
  // case-sensitive filesystem). Only report missing when neither matches.
  let fileExists = [...resolved.values()].includes(name);
  if (!fileExists) {
    const lower = name.toLowerCase();
    fileExists = [...resolved.keys()].some((base) => base.toLowerCase() === lower);
  }
  return { name, fileExists };
}

async function gatherRules(claudeDir: string): Promise<RulesInfo> {
  const dir = join(claudeDir, "rules");
  let alwaysOnCount = 0;
  let pathConditionedCount = 0;
  const alwaysOnNames: string[] = [];
  for (const entry of await listMdFiles(dir)) {
    const fm = await frontmatterOf(join(dir, entry));
    if ("paths" in fm) {
      pathConditionedCount++;
    } else {
      alwaysOnCount++;
      alwaysOnNames.push(entry);
    }
  }
  alwaysOnNames.sort();
  return { alwaysOnCount, pathConditionedCount, alwaysOnNames };
}

async function gatherAlwaysOn(claudeDir: string): Promise<AlwaysOnInfo> {
  const [claudeMd, agentsMd, rules] = await Promise.all([
    fileInfo(join(claudeDir, "CLAUDE.md")),
    fileInfo(join(claudeDir, "AGENTS.md")),
    gatherRules(claudeDir),
  ]);
  return { claudeMd, agentsMd, rules };
}

function gatherModelEffort(
  settingsOk: boolean,
  settings: Settings,
  rawObj: Record<string, unknown>,
): ModelEffortInfo {
  const model = (settingsOk ? settings.model : asStr(rawObj.model)) ?? null;
  const envObj = settingsOk ? (settings.env ?? {}) : asObj(rawObj.env);
  return {
    model,
    effortLevel: asStr((envObj as Record<string, unknown>).CLAUDE_CODE_EFFORT_LEVEL),
    subagentModel: asStr((envObj as Record<string, unknown>).CLAUDE_CODE_SUBAGENT_MODEL),
  };
}

async function gatherHooks(claudeDir: string, raw: unknown): Promise<HooksInfo> {
  const { hooksCandidate } = parseHooksBlock(raw);
  let groupCount = 0;
  let eventCount = 0;
  if (hooksCandidate && typeof hooksCandidate === "object") {
    for (const groups of Object.values(hooksCandidate as Record<string, unknown>)) {
      if (!Array.isArray(groups) || groups.length === 0) continue;
      eventCount++;
      groupCount += groups.length;
    }
  }

  // Collect every managed script referenced, and the set of events it's wired to.
  const eventsByScript = new Map<string, Set<string>>();
  for (const { event, command } of iterCommandHooks(raw)) {
    const parsed = parseHookCommand(command.trim());
    if (parsed.managed && parsed.relPath) {
      if (!eventsByScript.has(parsed.relPath)) eventsByScript.set(parsed.relPath, new Set());
      eventsByScript.get(parsed.relPath)?.add(event);
    }
  }

  const scripts: HookScriptRow[] = [];
  for (const [relPath, events] of eventsByScript) {
    const basename = relPath.split("/").pop() ?? relPath;
    const description = await leadingCommentLine(join(claudeDir, "src", relPath));
    scripts.push({ basename, relPath, events: [...events].sort(), description });
  }
  scripts.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { groupCount, eventCount, scripts };
}

async function gatherInventory(
  paths: InstallPaths,
  settingsOk: boolean,
  settings: Settings,
  rawObj: Record<string, unknown>,
): Promise<InventoryInfo> {
  const { claudeDir } = paths;
  const [skillsCount, agentsCount, claudeJson] = await Promise.all([
    countDirEntries(join(claudeDir, "skills")),
    countDirEntries(join(claudeDir, "agents"), (n) => n.endsWith(".md")),
    readJsonOrNull(paths.claudeJsonPath).catch(() => null),
  ]);
  const mcpServers = Object.keys(asObj(claudeJson).mcpServers ?? {});
  const rawPermissions = asObj(rawObj.permissions);
  const permissionsAllowCount = settingsOk
    ? (settings.permissions?.allow?.length ?? 0)
    : asStrArray(rawPermissions.allow).length;
  const permissionsDenyCount = settingsOk
    ? (settings.permissions?.deny?.length ?? 0)
    : asStrArray(rawPermissions.deny).length;

  return {
    skillsCount,
    agentsCount,
    mcpServers,
    permissionsAllowCount,
    permissionsDenyCount,
  };
}

/**
 * Gather all "what's on" data from the filesystem. No console output.
 * Never throws on an unmodelled/malformed settings.json — falls back to raw
 * JSON on schema-parse failure, and to empty defaults on unreadable/absent
 * JSON entirely.
 *
 * `cwd` drives the project-settings presence check (ScopeInfo) — defaults to
 * the real process cwd; tests pass a fixture dir.
 */
export async function gatherWhatsOn(
  paths: InstallPaths,
  cwd: string = process.cwd(),
): Promise<WhatsOnData> {
  const { claudeDir } = paths;
  const settingsPath = join(claudeDir, "settings.json");
  const raw = (await readJsonOrNull(settingsPath).catch(() => null)) ?? {};
  const rawObj = asObj(raw);
  const parsed = Settings.safeParse(raw);
  const settingsOk = parsed.success;
  const settings: Settings = parsed.success ? parsed.data : {};

  const [outputStyle, alwaysOn, hooks, inventory] = await Promise.all([
    gatherOutputStyle(claudeDir, settingsOk, settings, rawObj),
    gatherAlwaysOn(claudeDir),
    gatherHooks(claudeDir, raw),
    gatherInventory(paths, settingsOk, settings, rawObj),
  ]);
  const modelEffort = gatherModelEffort(settingsOk, settings, rawObj);
  const projectSettings = join(cwd, ".claude", "settings.json");
  const scope: ScopeInfo = {
    projectSettingsPath: existsSync(projectSettings) ? projectSettings : null,
  };

  return { outputStyle, alwaysOn, modelEffort, hooks, inventory, scope };
}

// --- Rendering ---------------------------------------------------------

export function formatWhatsOn(data: WhatsOnData): string {
  const lines: string[] = [];
  lines.push("What's on — USER-SCOPE INSTALLED state at ~/.claude (not full session precedence)");
  lines.push(
    "  Overriding scopes NOT reflected below: project .claude/settings.json, " +
      ".claude/settings.local.json, managed policy, CLI flags.",
  );
  if (data.scope.projectSettingsPath) {
    lines.push(
      `  NOTE: a project settings.json exists at ${data.scope.projectSettingsPath} — it may ` +
        "override values in this report.",
    );
  }
  lines.push("(install health / drift requires a checkout: `bash setup.sh --status`)");
  lines.push("");

  // 1. OUTPUT STYLE
  lines.push("OUTPUT STYLE (user scope)");
  if (data.outputStyle.name === null) {
    lines.push("  none configured — the built-in Default style is in effect.");
  } else if (data.outputStyle.fileExists === false) {
    lines.push(
      `  ⚠ settings.json names output style "${data.outputStyle.name}", but no file in ` +
        "~/.claude/output-styles/ resolves to it (checked frontmatter `name:` and filenames). " +
        "Claude Code will fall back silently — fix the name or restore the file.",
    );
  } else {
    lines.push(`  "${data.outputStyle.name}" — shapes how the assistant formats replies.`);
  }
  lines.push("  Applies to the MAIN conversation only — subagents run their own system prompt.");
  lines.push("  A change needs /clear or a new session to take effect.");
  lines.push("  Off-switch: /config -> Output style -> Default.");
  lines.push("");

  // 2. ALWAYS-ON INSTRUCTIONS
  lines.push("ALWAYS-ON INSTRUCTIONS (user scope)");
  lines.push(
    `  CLAUDE.md: ${data.alwaysOn.claudeMd.present ? `present, ${data.alwaysOn.claudeMd.bytes} bytes` : "absent"} — always injected, every turn.`,
  );
  lines.push(
    `  AGENTS.md: ${data.alwaysOn.agentsMd.present ? `present, ${data.alwaysOn.agentsMd.bytes} bytes` : "absent"} — ` +
      "NOT auto-loaded by Claude Code. CLAUDE.md merely instructs the model to read it; it's only " +
      "in effect when that instruction is followed, not injected every turn on its own.",
  );
  lines.push(
    `  rules/: ${data.alwaysOn.rules.alwaysOnCount} always-on (no \`paths:\` frontmatter — ` +
      `injected every turn) + ${data.alwaysOn.rules.pathConditionedCount} PATH-CONDITIONED ` +
      "(only loaded when a matching file is in play).",
  );
  if (data.alwaysOn.rules.alwaysOnNames.length > 0) {
    lines.push(`    always-on: ${data.alwaysOn.rules.alwaysOnNames.join(", ")}`);
  }
  lines.push("  Off-switch: edit or remove the file(s) at ~/.claude.");
  lines.push("");

  // 3. MODEL & EFFORT
  lines.push("MODEL & EFFORT (user scope)");
  lines.push(`  model: ${data.modelEffort.model ?? "(unset — Claude Code default)"}`);
  lines.push(`  CLAUDE_CODE_EFFORT_LEVEL: ${data.modelEffort.effortLevel ?? "(unset)"}`);
  lines.push(`  CLAUDE_CODE_SUBAGENT_MODEL: ${data.modelEffort.subagentModel ?? "(unset)"}`);
  lines.push("  Off-switch/override: /model, /effort <level>.");
  lines.push("");

  // 4. HOOKS
  lines.push("HOOKS (user scope)");
  lines.push(
    `  ${data.hooks.groupCount} group(s) across ${data.hooks.eventCount} event(s) registered.`,
  );
  if (data.hooks.scripts.length === 0) {
    lines.push("  no cc-settings-managed hook scripts referenced.");
  } else {
    for (const s of data.hooks.scripts) {
      const eventsLabel = s.events.join(", ");
      const desc = s.description ? ` — ${s.description}` : "";
      lines.push(`  ${s.basename}  [${eventsLabel}]${desc}`);
    }
  }
  lines.push("  Off-switch: edit the hooks block in ~/.claude/settings.json.");
  lines.push("");

  // 5. INVENTORY
  lines.push("INVENTORY (user scope)");
  lines.push(`  skills: ${data.inventory.skillsCount}`);
  lines.push(`  agents: ${data.inventory.agentsCount}`);
  lines.push(
    `  MCP servers: ${data.inventory.mcpServers.length}` +
      (data.inventory.mcpServers.length > 0 ? ` (${data.inventory.mcpServers.join(", ")})` : ""),
  );
  lines.push(
    `  permissions: ${data.inventory.permissionsAllowCount} allow / ${data.inventory.permissionsDenyCount} deny`,
  );
  lines.push(
    '  dry-run a command: `bun ~/.claude/src/scripts/permissions-check.ts --installed "<cmd>"`',
  );
  lines.push("");

  // 6. FOOTER
  lines.push("Skill guide: ~/.claude/docs/skills.md");
  lines.push("Install health (from a cc-settings checkout): `bash setup.sh --status`");

  return lines.join("\n");
}

// --- CLI ---------------------------------------------------------------

async function main(): Promise<number> {
  const json = process.argv.includes("--json");
  const data = await gatherWhatsOn(installPaths());
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(formatWhatsOn(data));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
