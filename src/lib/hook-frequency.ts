// Hook firing frequency from Claude Code transcripts, mapped onto the hook
// entries in config/40-hooks.json. Pure parsing and aggregation;
// src/scripts/hook-report.ts and src/scripts/hook-bench.ts do the I/O.
//
// Transcripts record what the model did, not what Claude Code fired, so every
// firing count here is derived: a hook fires once per transcript event its
// event name and matcher select. Events without a transcript record
// (Notification, CwdChanged, Task*, StopFailure, PreModelSwitch,
// PostToolBatch) map to null and are reported as not countable.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Hook entries ─────────────────────────────────────────────────────────────

export interface HookEntry {
  /** Script basename plus any trailing argument, e.g. "swarm-log start". */
  id: string;
  event: string;
  matcher: string | null;
  /** Permission-rule filter, e.g. "Bash(git push*)", or null. */
  filter: string | null;
  command: string;
  async: boolean;
  timeout: number | null;
}

interface RawHook {
  type?: string;
  command?: string;
  if?: string;
  async?: boolean;
  timeout?: number;
}

interface RawGroup {
  matcher?: string;
  hooks?: RawHook[];
}

/** Flatten the `hooks` block of a settings fragment into one entry per
 *  command hook, in file order. */
export function flattenHooks(config: unknown): HookEntry[] {
  const hooks = (config as { hooks?: Record<string, RawGroup[]> } | null)?.hooks ?? {};
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      for (const h of group.hooks ?? []) {
        if (h.type !== "command" || !h.command) continue;
        const m = h.command.match(/\/([\w-]+)\.ts"?(?:\s+(.*))?$/);
        out.push({
          id: m ? [m[1], m[2]].filter(Boolean).join(" ") : h.command,
          event,
          matcher: group.matcher ?? null,
          filter: h.if ?? null,
          command: h.command,
          async: h.async === true,
          timeout: h.timeout ?? null,
        });
      }
    }
  }
  return out;
}

export async function loadHookEntries(path: string): Promise<HookEntry[]> {
  return flattenHooks(JSON.parse(await readFile(path, "utf8")));
}

/** `config/40-hooks.json` in a checkout. An install under ~/.claude has no
 *  `config/`, so it reads the composed `settings.json`, which has the same
 *  `hooks` shape and holds the hooks that actually run. */
export function hooksConfigPath(root: string): string {
  const repo = join(root, "config", "40-hooks.json");
  return existsSync(repo) ? repo : join(root, "settings.json");
}

/** Claude Code matchers are regexes tested against the whole tool name. */
export function matchesTool(matcher: string | null, tool: string): boolean {
  if (matcher === null || matcher === "" || matcher === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return false;
  }
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}$`, "s");
}

/** Evaluate an `if` filter such as `Bash(gh*pr create*) Bash(gh*pr ready*)`
 *  (space-separated rules, any match passes). Only Bash rules can be judged
 *  from a transcript; a rule for another tool matches that tool by name. */
export function matchesFilter(filter: string | null, tool: string, command: string): boolean {
  if (filter === null) return true;
  for (const rule of filter.match(/[\w]+\([^)]*\)/g) ?? []) {
    const m = rule.match(/^(\w+)\((.*)\)$/);
    if (!m || m[1] !== tool) continue;
    if (tool !== "Bash" || globToRegExp(m[2] ?? "").test(command.trim())) return true;
  }
  return false;
}

// ── Transcript counts ────────────────────────────────────────────────────────

export interface ToolCall {
  tool: string;
  /** Bash command text, "" for other tools. */
  command: string;
  failed: boolean;
}

export interface SessionCounts {
  id: string;
  calls: ToolCall[];
  prompts: number;
  /** Completed turns: Stop hook firings (stop_hook_summary), falling back to
   *  turn_duration records. */
  turns: number;
  compactions: number;
  subagentSpawns: number;
  /** Sum of turn_duration records, milliseconds: time the model was working. */
  activeMs: number;
  /** First to last transcript timestamp, milliseconds, idle time included. */
  spanMs: number;
  stopHooks: { command: string; durationMs: number }[];
  /** Per Stop firing: the slowest hook's durationMs. */
  stopWallMs: number[];
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.map(obj).filter((b): b is Record<string, unknown> => b !== undefined)
    : [];
}

export function emptyCounts(id: string): SessionCounts {
  return {
    id,
    calls: [],
    prompts: 0,
    turns: 0,
    compactions: 0,
    subagentSpawns: 0,
    activeMs: 0,
    spanMs: 0,
    stopHooks: [],
    stopWallMs: [],
  };
}

/** Fold one transcript (main or subagent thread) into `into`. Tool calls and
 *  failures count for every thread because hooks fire inside subagents too;
 *  prompts, turns, compactions and Stop timings come from the main thread
 *  only. Tool calls dedupe by tool_use id (one transcript line per content
 *  block repeats the request). */
export function countTranscript(text: string, into: SessionCounts, main: boolean): void {
  const seen = new Set<string>();
  const byId = new Map<string, ToolCall>();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let turnDurations = 0;
  let stopSummaries = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = obj(JSON.parse(line));
    } catch {
      continue;
    }
    if (!entry) continue;
    if (typeof entry.timestamp === "string") {
      const t = Date.parse(entry.timestamp);
      if (Number.isFinite(t)) {
        first = Math.min(first, t);
        last = Math.max(last, t);
      }
    }
    const message = obj(entry.message);
    if (entry.type === "assistant") {
      for (const b of blocks(message?.content)) {
        if (b.type !== "tool_use" || typeof b.name !== "string") continue;
        const id = String(b.id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const cmd = b.name === "Bash" ? obj(b.input)?.command : undefined;
        const call: ToolCall = {
          tool: b.name,
          command: typeof cmd === "string" ? cmd : "",
          failed: false,
        };
        into.calls.push(call);
        if (id) byId.set(id, call);
        if (b.name === "Agent" || b.name === "Task") into.subagentSpawns++;
      }
    } else if (entry.type === "user") {
      const content = message?.content;
      const parts = blocks(content);
      for (const b of parts) {
        if (b.type !== "tool_result" || b.is_error !== true) continue;
        const call = byId.get(String(b.tool_use_id ?? ""));
        if (call) call.failed = true;
      }
      const isPrompt =
        entry.isMeta !== true &&
        entry.isSidechain !== true &&
        obj(entry.origin)?.kind !== "system" &&
        (typeof content === "string"
          ? content.length > 0
          : parts.length > 0 &&
            parts.some((b) => b.type === "text") &&
            !parts.some((b) => b.type === "tool_result"));
      if (main && isPrompt) into.prompts++;
    } else if (main && entry.type === "system") {
      if (entry.subtype === "compact_boundary") into.compactions++;
      else if (entry.subtype === "turn_duration") {
        turnDurations++;
        if (typeof entry.durationMs === "number") into.activeMs += entry.durationMs;
      } else if (entry.subtype === "stop_hook_summary") {
        stopSummaries++;
        let wall = 0;
        for (const info of Array.isArray(entry.hookInfos) ? entry.hookInfos : []) {
          const h = obj(info);
          if (typeof h?.command !== "string" || typeof h.durationMs !== "number") continue;
          into.stopHooks.push({ command: h.command, durationMs: h.durationMs });
          wall = Math.max(wall, h.durationMs);
        }
        into.stopWallMs.push(wall);
      }
    }
  }
  if (main) {
    into.turns = stopSummaries || turnDurations;
    if (last >= first) into.spanMs = last - first;
  }
}

// ── Firing counts ────────────────────────────────────────────────────────────

/** Firings of `entry` in one session, or null when the transcript has no
 *  record of the entry's event. A failed tool call fires PostToolUseFailure
 *  instead of PostToolUse. */
export function firingsFor(entry: HookEntry, s: SessionCounts): number | null {
  switch (entry.event) {
    case "PreToolUse":
    case "PostToolUse":
      return s.calls.filter(
        (c) =>
          (entry.event === "PreToolUse" || !c.failed) &&
          matchesTool(entry.matcher, c.tool) &&
          matchesFilter(entry.filter, c.tool, c.command),
      ).length;
    case "PostToolUseFailure":
      return s.calls.filter((c) => c.failed && matchesTool(entry.matcher, c.tool)).length;
    case "UserPromptSubmit":
      return s.prompts;
    case "Stop":
      return s.turns;
    case "PreCompact":
    case "PostCompact":
      return s.compactions;
    case "SessionStart":
    case "SessionEnd":
      return 1;
    case "SubagentStart":
    case "SubagentStop":
      return s.subagentSpawns;
    default:
      return null;
  }
}

// ── Statistics ───────────────────────────────────────────────────────────────

/** Nearest-rank percentile of `values` (p in 0..100); 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export const median = (values: number[]): number => percentile(values, 50);
