#!/usr/bin/env bun
// "What's on" report — answers "what is shaping my session right now, what
// does each piece do, and how do I switch it off." Reads the INSTALLED state
// at ~/.claude (never the repo checkout), never mutates anything.
//
// This is deliberately NOT `bun src/setup.ts --status`: --status answers
// install-health questions (version drift, present/missing counts, auto-update
// enrollment). This answers effect questions — one line per thing, always with
// an off-switch — and cross-links to --status rather than duplicating it.
//
// Usage:
//   bun run whats-on            # plain-text report against the real install
//   bun run whats-on --json     # same data, machine-readable

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { iterCommandHooks, parseHookCommand, parseHooksBlock } from "../lib/hook-command.ts";
import { readJsonOrNull } from "../lib/json-io.ts";
import { type InstallPaths, installPaths } from "../lib/platform.ts";
import { Settings } from "../schemas/settings.ts";

// --- Data shapes -----------------------------------------------------------

export interface OutputStyleInfo {
  /** The configured style name, or null when `outputStyle` is unset (built-in Default). */
  name: string | null;
  /** Whether ~/.claude/output-styles/<name>.md exists. Null when name is null. */
  fileExists: boolean | null;
}

export interface AlwaysOnFileInfo {
  present: boolean;
  bytes: number;
}

export interface AlwaysOnInfo {
  claudeMd: AlwaysOnFileInfo;
  agentsMd: AlwaysOnFileInfo;
  /** Count of files under rules/ — path-conditioned, NOT always-on. */
  rulesCount: number;
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

export interface WhatsOnData {
  outputStyle: OutputStyleInfo;
  alwaysOn: AlwaysOnInfo;
  modelEffort: ModelEffortInfo;
  hooks: HooksInfo;
  inventory: InventoryInfo;
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

async function gatherOutputStyle(
  claudeDir: string,
  settingsOk: boolean,
  settings: Settings,
  rawObj: Record<string, unknown>,
): Promise<OutputStyleInfo> {
  const name = (settingsOk ? settings.outputStyle : asStr(rawObj.outputStyle)) ?? null;
  if (!name) return { name: null, fileExists: null };
  const fileExists = existsSync(join(claudeDir, "output-styles", `${name}.md`));
  return { name, fileExists };
}

async function gatherAlwaysOn(claudeDir: string): Promise<AlwaysOnInfo> {
  const [claudeMd, agentsMd, rulesCount] = await Promise.all([
    fileInfo(join(claudeDir, "CLAUDE.md")),
    fileInfo(join(claudeDir, "AGENTS.md")),
    countDirEntries(join(claudeDir, "rules")),
  ]);
  return { claudeMd, agentsMd, rulesCount };
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
 */
export async function gatherWhatsOn(paths: InstallPaths): Promise<WhatsOnData> {
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

  return { outputStyle, alwaysOn, modelEffort, hooks, inventory };
}

// --- Rendering ---------------------------------------------------------

export function formatWhatsOn(data: WhatsOnData): string {
  const lines: string[] = [];
  lines.push("What's on — what's shaping this session, and how to turn it off");
  lines.push("(install health / drift instead: `bun src/setup.ts --status`)");
  lines.push("");

  // 1. OUTPUT STYLE
  lines.push("OUTPUT STYLE");
  if (data.outputStyle.name === null) {
    lines.push("  none configured — the built-in Default style is in effect.");
  } else if (data.outputStyle.fileExists === false) {
    lines.push(
      `  ⚠ settings.json names output style "${data.outputStyle.name}", but ` +
        `~/.claude/output-styles/${data.outputStyle.name}.md does NOT exist. Claude Code will ` +
        "fall back silently — fix the name or restore the file.",
    );
  } else {
    lines.push(`  "${data.outputStyle.name}" — shapes how the assistant formats replies.`);
  }
  lines.push("  Applies to the MAIN conversation only — subagents run their own system prompt.");
  lines.push("  A change needs /clear or a new session to take effect.");
  lines.push("  Off-switch: /config -> Output style -> Default.");
  lines.push("");

  // 2. ALWAYS-ON INSTRUCTIONS
  lines.push("ALWAYS-ON INSTRUCTIONS");
  lines.push(
    `  CLAUDE.md: ${data.alwaysOn.claudeMd.present ? `present, ${data.alwaysOn.claudeMd.bytes} bytes` : "absent"} — always injected, every turn.`,
  );
  lines.push(
    `  AGENTS.md: ${data.alwaysOn.agentsMd.present ? `present, ${data.alwaysOn.agentsMd.bytes} bytes` : "absent"} — always injected, every turn.`,
  );
  lines.push(
    `  rules/: ${data.alwaysOn.rulesCount} file(s) — PATH-CONDITIONED, not always-on. ` +
      "Only loaded when a matching file is in play.",
  );
  lines.push("  Off-switch: edit or remove the file(s) at ~/.claude.");
  lines.push("");

  // 3. MODEL & EFFORT
  lines.push("MODEL & EFFORT");
  lines.push(`  model: ${data.modelEffort.model ?? "(unset — Claude Code default)"}`);
  lines.push(`  CLAUDE_CODE_EFFORT_LEVEL: ${data.modelEffort.effortLevel ?? "(unset)"}`);
  lines.push(`  CLAUDE_CODE_SUBAGENT_MODEL: ${data.modelEffort.subagentModel ?? "(unset)"}`);
  lines.push("  Off-switch/override: /model, /effort <level>.");
  lines.push("");

  // 4. HOOKS
  lines.push("HOOKS");
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
  lines.push("INVENTORY");
  lines.push(`  skills: ${data.inventory.skillsCount}`);
  lines.push(`  agents: ${data.inventory.agentsCount}`);
  lines.push(
    `  MCP servers: ${data.inventory.mcpServers.length}` +
      (data.inventory.mcpServers.length > 0 ? ` (${data.inventory.mcpServers.join(", ")})` : ""),
  );
  lines.push(
    `  permissions: ${data.inventory.permissionsAllowCount} allow / ${data.inventory.permissionsDenyCount} deny`,
  );
  lines.push('  dry-run a command: `bun run permissions:check "<cmd>"`');
  lines.push("");

  // 6. FOOTER
  lines.push("Full inventory: MANUAL.md");
  lines.push("Install health: `bun src/setup.ts --status`");

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
