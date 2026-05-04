// MCP server detection, preservation, and merging — port of lib/mcp.sh.
//
// The critical invariants (inherited from the bash hardening pass):
//   1. Unparseable JSON → abort loudly. Never fall through to a cp that wipes
//      user-only MCPs.
//   2. All writes are atomic (tmp + rename, same directory).
//   3. CC_WIPE_CUSTOM_MCP=1 is the ONLY way to drop user-only servers without
//      an interactive confirmation.
//
// Validation uses zod schemas:
//   - McpServers shape from src/schemas/mcp.ts (discriminated stdio vs http).
//   - ~/.claude.json uses passthrough (Claude-Code-owned state we don't edit).

import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { ClaudeJson } from "../schemas/claude-json.ts";
import type { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { debug, error, info, success, warn } from "./colors.ts";
import { promptYn } from "./prompts.ts";

type McpServer = z.infer<typeof McpServersSchema>[string];
type McpServers = Record<string, McpServer>;

export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");

/** Raised when JSON is unparseable. Callers MUST treat this as a hard failure. */
export class McpParseError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`${path} is not valid JSON. Fix it or restore a backup before re-running setup.`);
    this.name = "McpParseError";
    if (cause instanceof Error) this.cause = cause;
  }
}

// --- Atomic IO helpers ----------------------------------------------------

/** Stage + rename in the same directory so crashes don't leave a half-written target. */
export async function atomicWriteString(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, `.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/** atomicWriteString helper that JSON-serializes (2-space indent, trailing newline). */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await atomicWriteString(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new McpParseError(path, err);
  }
}

// --- Settings.json MCP extraction -----------------------------------------

/** Read MCP servers from a settings.json. Throws McpParseError on bad JSON. */
export async function readMcpFromSettings(path: string): Promise<McpServers> {
  const data = (await readJsonOrNull(path)) as { mcpServers?: McpServers } | null;
  if (!data) return {};
  return data.mcpServers ?? {};
}

export function findUserOnlyServers(userServers: McpServers, teamServers: McpServers): string[] {
  return Object.keys(userServers).filter((name) => !(name in teamServers));
}

// --- Preservation workflow ------------------------------------------------

interface PreservationResult {
  preserved: McpServers;
  dropped: string[];
}

/**
 * Interactive prompt flow for user-only MCP servers. Honors CC_WIPE_CUSTOM_MCP=1
 * as the only mechanism that allows silent drop.
 */
export async function promptPreserveUserServers(
  userOnly: string[],
  userServers: McpServers,
): Promise<PreservationResult> {
  if (userOnly.length === 0) return { preserved: {}, dropped: [] };

  info(`You have ${userOnly.length} custom MCP server(s) not in the team config:`);
  console.log("");
  for (const name of userOnly) console.log(`  - ${name}`);
  console.log("");

  // Hard opt-out: explicit env var. Everything else defaults to preserve.
  if (process.env.CC_WIPE_CUSTOM_MCP === "1") {
    warn(`CC_WIPE_CUSTOM_MCP=1 — dropping ${userOnly.length} custom MCP server(s)`);
    return { preserved: {}, dropped: userOnly };
  }

  const keep = await promptYn("Keep these servers? (they'll be merged with team config)", true);
  if (keep) {
    success(`Keeping all ${userOnly.length} custom server(s)`);
    const preserved: McpServers = {};
    for (const name of userOnly) {
      const s = userServers[name];
      if (s) preserved[name] = s;
    }
    return { preserved, dropped: [] };
  }

  warn(`User chose not to preserve — ${userOnly.length} custom MCP server(s) will be dropped`);
  return { preserved: {}, dropped: userOnly };
}

// --- Settings.json merge --------------------------------------------------
//
// Strategy-based merge tree. Each top-level key in settings.json has a merge
// strategy registered in STRATEGIES below. The orchestrator walks every key
// in (team ∪ user), looks up the strategy (defaulting to user-wins-scalar),
// and assembles the result. Adding a new field-specific behavior = register
// a new strategy + key. No churn in the orchestrator.
//
// The accounting struct collects per-strategy counts (added, declined,
// pruned, etc.) so the orchestrator can build the user-facing summary at
// the end without each strategy needing its own return shape.

type StringArray = string[] | undefined;
type UnknownRecord = Record<string, unknown>;

/**
 * Merge policy options. Interactive mode only asks where auto-merge has a real
 * tradeoff: scalar conflicts (user vs team differ on same key) and team-added
 * rules/hooks (team baseline changed since last install). Deny rules and
 * additive merges stay automatic.
 */
export interface MergeOptions {
  interactive?: boolean;
}

interface MergeAccounting {
  permissionsAdded: number;
  permissionsDeclined: number;
  permissionsAdoptedScalars: number;
  hooksAdded: number;
  hooksDeclined: number;
  hooksPruned: number;
  envUserWins: number;
  envAdoptedScalars: number;
  scalarsAdopted: number;
  statusLineReset: boolean;
}

interface StrategyContext {
  opts: MergeOptions;
  accounting: MergeAccounting;
}

/**
 * A strategy returns either:
 *   - `{ keep: true, value }` — write `value` under the key in the merged result
 *   - `{ keep: false }` — omit the key entirely
 */
type StrategyResult = { keep: false } | { keep: true; value: unknown };

type Strategy = (team: unknown, user: unknown, ctx: StrategyContext) => Promise<StrategyResult>;

// --- Strategy helpers (shared) -------------------------------------------

// Union two string arrays, preserving team order. Team-only entries can be
// declined in interactive mode (they're the ones team added since last install).
async function unionPermissionArray(
  team: StringArray,
  user: StringArray,
  opts: MergeOptions,
  label: string,
  alwaysAccept = false,
): Promise<{ merged: string[] | undefined; added: number; declined: number }> {
  const teamArr = team ?? [];
  const userArr = user ?? [];
  if (teamArr.length === 0 && userArr.length === 0)
    return { merged: undefined, added: 0, declined: 0 };

  const userSet = new Set(userArr);
  const teamOnly = teamArr.filter((r) => !userSet.has(r));
  const teamSet = new Set(teamArr);
  const userExtras = userArr.filter((r) => !teamSet.has(r));

  let acceptedTeamOnly = new Set(teamOnly);
  let declined = 0;
  if (opts.interactive && !alwaysAccept && teamOnly.length > 0) {
    info(`Team added ${teamOnly.length} new ${label}(s) since your last install:`);
    for (const r of teamOnly) console.log(`  + ${r}`);
    const adopt = await promptYn("Adopt these?", true);
    if (!adopt) {
      acceptedTeamOnly = new Set<string>();
      declined = teamOnly.length;
    }
  }

  // Preserve team order, drop declined team-only entries, append user extras.
  const teamFiltered = teamArr.filter((r) => userSet.has(r) || acceptedTeamOnly.has(r));
  const merged = [...teamFiltered, ...userExtras];
  return { merged, added: userExtras.length, declined };
}

// Prompt for a scalar conflict: user has X, team has Y, values differ.
async function resolveScalarConflict(
  key: string,
  teamVal: unknown,
  userVal: unknown,
  opts: MergeOptions,
): Promise<{ value: unknown; adopted: boolean }> {
  if (!opts.interactive) return { value: userVal, adopted: false };
  info(`"${key}" differs between your settings and team:`);
  console.log(`  your value: ${JSON.stringify(userVal)}`);
  console.log(`  team value: ${JSON.stringify(teamVal)}`);
  const keepUser = await promptYn("Keep your value?", true);
  return { value: keepUser ? userVal : teamVal, adopted: !keepUser };
}

// --- Strategies ----------------------------------------------------------

// permissions: deep object with array unions (allow/deny/ask/additionalDirectories)
// + scalar fields (defaultMode/autoMode). deny is always additive (never prompts).
const permissionsStrategy: Strategy = async (team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = (team as UnknownRecord | undefined) ?? {};
  const u = (user as UnknownRecord | undefined) ?? {};
  const { opts } = ctx;

  const allow = await unionPermissionArray(
    t.allow as StringArray,
    u.allow as StringArray,
    opts,
    "allow rule",
  );
  const deny = await unionPermissionArray(
    t.deny as StringArray,
    u.deny as StringArray,
    opts,
    "deny rule",
    true, // deny always accepts team additions — guardrail
  );
  const ask = await unionPermissionArray(
    t.ask as StringArray,
    u.ask as StringArray,
    opts,
    "ask rule",
  );
  const dirs = await unionPermissionArray(
    t.additionalDirectories as StringArray,
    u.additionalDirectories as StringArray,
    opts,
    "additionalDirectory",
  );

  const merged: UnknownRecord = { ...t, ...u };
  if (allow.merged !== undefined) merged.allow = allow.merged;
  if (deny.merged !== undefined) merged.deny = deny.merged;
  if (ask.merged !== undefined) merged.ask = ask.merged;
  if (dirs.merged !== undefined) merged.additionalDirectories = dirs.merged;

  // Scalar conflicts within permissions (defaultMode, autoMode).
  for (const k of ["defaultMode", "autoMode"]) {
    if (k in t && k in u && JSON.stringify(t[k]) !== JSON.stringify(u[k])) {
      const { value, adopted } = await resolveScalarConflict(`permissions.${k}`, t[k], u[k], opts);
      merged[k] = value;
      if (adopted) ctx.accounting.permissionsAdoptedScalars++;
    }
  }

  ctx.accounting.permissionsAdded += allow.added + deny.added + ask.added + dirs.added;
  ctx.accounting.permissionsDeclined +=
    allow.declined + deny.declined + ask.declined + dirs.declined;

  return { keep: true, value: merged };
};

// Commands matching one of these patterns reference a script cc-settings has
// removed in a past release. The merger drops user-only hook groups whose
// command matches, and resets the top-level `statusLine` field to the team
// value when the user's value matches — without this, the merger preserves
// the dangling reference forever and Claude Code logs "No such file or
// directory" on every session (or for `statusLine`, the bar silently fails
// to render at all).
//
// When a future release removes a script, add its path here so upgraders
// don't end up with a broken settings.json. Patterns are matched against the
// `command` field of any object that has one — hooks and statusLine both go
// through this check.
//
// The first entry sweeps the entire `~/.claude/scripts/*.sh` directory because
// the bash → TypeScript migration (cc-settings v10.0.0, April 2026) deleted
// that directory wholesale; replacements live under `~/.claude/src/scripts/`
// or `~/.claude/src/hooks/` and are invoked via `bun ...`.
const DEPRECATED_COMMAND_PATTERNS: RegExp[] = [/[/\\]\.claude[/\\]scripts[/\\][^"'\s]*\.sh\b/];

function commandIsDeprecated(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(value));
}

function isDeprecatedHook(hook: unknown): boolean {
  if (!hook || typeof hook !== "object") return false;
  return commandIsDeprecated((hook as { command?: unknown }).command);
}

// A group is deprecated only if every hook inside it is deprecated. Mixed
// groups keep their non-deprecated hooks (we filter the inner array).
function pruneDeprecatedHooks(group: unknown): unknown | null {
  if (!group || typeof group !== "object") return group;
  const g = group as { hooks?: unknown[] };
  if (!Array.isArray(g.hooks)) return group;
  const kept = g.hooks.filter((h) => !isDeprecatedHook(h));
  if (kept.length === 0) return null;
  if (kept.length === g.hooks.length) return group;
  return { ...g, hooks: kept };
}

// hooks: per-event union of hook groups. Team-only groups can be declined in
// interactive mode; user-only groups survive UNLESS their command references
// a script in DEPRECATED_COMMAND_PATTERNS (see v10.3.2). Mixed groups keep
// their non-deprecated hooks.
const hooksStrategy: Strategy = async (team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = (team as UnknownRecord | undefined) ?? {};
  const u = (user as UnknownRecord | undefined) ?? {};
  const { opts } = ctx;

  const events = new Set([...Object.keys(t), ...Object.keys(u)]);
  const merged: UnknownRecord = {};

  for (const ev of events) {
    const teamGroups = Array.isArray(t[ev]) ? (t[ev] as unknown[]) : [];
    const userGroups = Array.isArray(u[ev]) ? (u[ev] as unknown[]) : [];
    const userJson = new Set(userGroups.map((g) => JSON.stringify(g)));
    const teamJson = new Set(teamGroups.map((g) => JSON.stringify(g)));
    const teamOnly = teamGroups.filter((g) => !userJson.has(JSON.stringify(g)));
    const rawUserExtras = userGroups.filter((g) => !teamJson.has(JSON.stringify(g)));

    // Drop user extras whose commands point at scripts cc-settings has removed.
    const userExtras: unknown[] = [];
    for (const g of rawUserExtras) {
      const cleaned = pruneDeprecatedHooks(g);
      if (cleaned === null) {
        ctx.accounting.hooksPruned++;
        continue;
      }
      if (cleaned !== g) ctx.accounting.hooksPruned++; // partial prune
      userExtras.push(cleaned);
    }

    let acceptedTeamOnly = new Set(teamOnly.map((g) => JSON.stringify(g)));
    if (opts.interactive && teamOnly.length > 0) {
      info(`Team added ${teamOnly.length} hook group(s) for ${ev}:`);
      for (const g of teamOnly) console.log(`  + ${JSON.stringify(g)}`);
      const adopt = await promptYn("Adopt these?", true);
      if (!adopt) {
        acceptedTeamOnly = new Set<string>();
        ctx.accounting.hooksDeclined += teamOnly.length;
      }
    }

    const teamFiltered = teamGroups.filter((g) => {
      const j = JSON.stringify(g);
      return userJson.has(j) || acceptedTeamOnly.has(j);
    });
    ctx.accounting.hooksAdded += userExtras.length;
    merged[ev] = [...teamFiltered, ...userExtras];
  }

  return { keep: true, value: merged };
};

// env: shallow merge, user wins on key conflict (cache flags, debug toggles
// stick across re-installs). Interactive prompts on each conflict.
const envStrategy: Strategy = async (team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = (team as UnknownRecord | undefined) ?? {};
  const u = (user as UnknownRecord | undefined) ?? {};
  const merged: UnknownRecord = { ...t, ...u };

  for (const k of Object.keys(u)) {
    if (k in t && u[k] !== t[k]) {
      ctx.accounting.envUserWins++;
      const { value, adopted } = await resolveScalarConflict(`env.${k}`, t[k], u[k], ctx.opts);
      merged[k] = value;
      if (adopted) {
        ctx.accounting.envAdoptedScalars++;
        ctx.accounting.envUserWins--;
      }
    }
  }
  return { keep: true, value: merged };
};

// statusLine: object — user's value normally wins. Exception: if user's
// command points at a removed cc-settings script (see DEPRECATED_COMMAND_PATTERNS),
// reset to team. Other custom statuslines (pointing at the user's own scripts)
// are preserved unchanged.
const statusLineStrategy: Strategy = async (team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const u = user as { command?: unknown } | undefined;
  if (u && commandIsDeprecated(u.command)) {
    ctx.accounting.statusLineReset = true;
    if (team === undefined) return { keep: false };
    return { keep: true, value: team };
  }
  // Default object overlay: user wins when declared.
  if (user !== undefined) return { keep: true, value: user };
  return { keep: true, value: team };
};

// Default fallback for any key not in STRATEGIES. User-wins on values
// declared in both; team-only and user-only keys pass through. Scalar
// conflicts can prompt in interactive mode.
const userWinsScalarStrategy: Strategy = async (team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  if (user === undefined) return { keep: true, value: team };
  if (team === undefined) return { keep: true, value: user };

  // Both present. For non-scalar values (objects/arrays), user wins silently
  // — matches pre-refactor behavior of `{ ...teamRaw, ...userRaw }`.
  const tIsScalar = !(Array.isArray(team) || (team !== null && typeof team === "object"));
  const uIsScalar = !(Array.isArray(user) || (user !== null && typeof user === "object"));
  if (!tIsScalar || !uIsScalar) return { keep: true, value: user };
  if (team === user) return { keep: true, value: user };

  // Scalar conflict: prompt or silent user-wins. We don't know the key here;
  // pass a placeholder. The strategy registry could be extended to inject the
  // key, but the prompt's framing ("differs between your settings and team")
  // doesn't strictly require it.
  const { value, adopted } = await resolveScalarConflict("<scalar>", team, user, ctx.opts);
  if (adopted) ctx.accounting.scalarsAdopted++;
  return { keep: true, value };
};

// --- Strategy registry ---------------------------------------------------

const STRATEGIES: Record<string, Strategy> = {
  permissions: permissionsStrategy,
  hooks: hooksStrategy,
  env: envStrategy,
  statusLine: statusLineStrategy,
  // mcpServers is handled separately — it needs the user-server preservation
  // prompt run BEFORE the per-key loop (the prompt is shared across the whole
  // settings.json merge, not just the mcpServers field).
};

// --- Orchestrator --------------------------------------------------------

/**
 * Merge user's existing settings.json with the team settings.json.
 *
 * Non-interactive policy (default):
 *   - User-declared keys win for top-level scalars (model, theme, …).
 *   - `permissions.{allow,deny,ask,additionalDirectories}` are unioned so the
 *     team baseline (guardrails, common tool access) survives while user
 *     additions are preserved.
 *   - `hooks` is per-event union of groups, with deprecation prune for
 *     user-only groups pointing at removed cc-settings scripts.
 *   - `env` shallow-merges with user values winning.
 *   - `statusLine` user wins, except when the user's command targets a
 *     removed cc-settings script (then reset to team).
 *   - `mcpServers` uses the interactive preservation prompt.
 *
 * Interactive policy (`opts.interactive`):
 *   - Scalar conflicts prompt "keep your value / take team's".
 *   - Team-added permission rules (allow/ask) and hook groups prompt "adopt / skip".
 *   - `deny` rules and user-only entries stay automatic (guardrails / additive).
 */
export async function mergeSettingsWithMcpPreservation(
  existingPath: string,
  teamPath: string,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<void> {
  const teamRaw = (await readJsonOrNull(teamPath)) as UnknownRecord | null;
  if (!teamRaw) throw new Error(`Team settings not found: ${teamPath}`);

  const userRaw = (await readJsonOrNull(existingPath)) as UnknownRecord | null;

  // No existing file → write team as-is (atomic).
  if (!userRaw) {
    await atomicWriteJson(outputPath, teamRaw);
    return;
  }

  // mcpServers needs the preservation prompt to run BEFORE the per-key loop —
  // the prompt is shared across the whole merge, not scoped to one strategy.
  const userServers = (userRaw.mcpServers as McpServers | undefined) ?? {};
  const teamServers = (teamRaw.mcpServers as McpServers | undefined) ?? {};
  const userOnly = findUserOnlyServers(userServers, teamServers);
  let preserved: McpServers = {};
  if (userOnly.length > 0) {
    ({ preserved } = await promptPreserveUserServers(userOnly, userServers));
  } else {
    debug("No user-only MCP servers");
  }

  const ctx: StrategyContext = {
    opts,
    accounting: {
      permissionsAdded: 0,
      permissionsDeclined: 0,
      permissionsAdoptedScalars: 0,
      hooksAdded: 0,
      hooksDeclined: 0,
      hooksPruned: 0,
      envUserWins: 0,
      envAdoptedScalars: 0,
      scalarsAdopted: 0,
      statusLineReset: false,
    },
  };

  // Walk every key in (team ∪ user). Strategy table picks the merge logic;
  // unknown keys fall through to user-wins-scalar.
  const merged: UnknownRecord = {};
  const allKeys = new Set([...Object.keys(teamRaw), ...Object.keys(userRaw)]);

  // mcpServers gets a fixed result based on the prompt outcome above.
  merged.mcpServers = { ...teamServers, ...preserved };
  allKeys.delete("mcpServers");

  for (const key of allKeys) {
    const strategy = STRATEGIES[key] ?? userWinsScalarStrategy;
    const result = await strategy(teamRaw[key], userRaw[key], ctx);
    if (result.keep) merged[key] = result.value;
  }

  // --- Build the user-facing summary ---
  const a = ctx.accounting;
  const bits: string[] = [];
  if (a.permissionsAdded > 0) bits.push(`${a.permissionsAdded} permission rule(s)`);
  if (a.hooksAdded > 0) bits.push(`${a.hooksAdded} hook group(s)`);
  if (a.envUserWins > 0) bits.push(`${a.envUserWins} env override(s)`);
  if (bits.length > 0) success(`Preserved user customization: ${bits.join(", ")}`);

  if (a.hooksPruned > 0) {
    info(`Pruned ${a.hooksPruned} stale hook reference(s) pointing at removed cc-settings scripts`);
  }
  if (a.statusLineReset) {
    info("Reset stale statusLine command (pointed at a removed cc-settings script)");
  }

  if (opts.interactive) {
    const ibits: string[] = [];
    const declined = a.permissionsDeclined + a.hooksDeclined;
    const adopted = a.permissionsAdoptedScalars + a.envAdoptedScalars + a.scalarsAdopted;
    if (declined > 0) ibits.push(`${declined} team addition(s) declined`);
    if (adopted > 0) ibits.push(`${adopted} team value(s) adopted over yours`);
    if (ibits.length > 0) info(`Interactive choices: ${ibits.join(", ")}`);
  }

  await atomicWriteJson(outputPath, merged);
}

// --- ~/.claude.json installer --------------------------------------------

/**
 * Install team MCP servers into `~/.claude.json`, preserving any user servers
 * already present. Conflicts: user servers win for existing keys, team
 * definitions fill in missing ones. Atomic.
 *
 * Uses ClaudeJson (passthrough) so fields we don't know about (Claude-Code-
 * owned state) round-trip untouched.
 */
export async function installMcpToClaudeJson(
  teamSettingsPath: string,
  claudeJsonPath: string = CLAUDE_JSON_PATH,
): Promise<void> {
  const team = (await readJsonOrNull(teamSettingsPath)) as {
    mcpServers?: McpServers;
  } | null;
  if (!team) {
    warn(`Team settings not found: ${teamSettingsPath}`);
    return;
  }
  const teamMcp = team.mcpServers ?? {};
  if (Object.keys(teamMcp).length === 0) {
    debug("No MCP servers in team config");
    return;
  }

  // Read existing claude.json — tolerate absence, but don't tolerate corruption.
  let current: Record<string, unknown> = {};
  const parsed = (await readJsonOrNull(claudeJsonPath)) ?? {};
  const validated = ClaudeJson.safeParse(parsed);
  if (!validated.success) {
    error(`${claudeJsonPath} failed schema check: ${validated.error.issues[0]?.message ?? ""}`);
    error("Refusing to write merged MCPs — fix the file before re-running setup.");
    return;
  }
  current = validated.data as Record<string, unknown>;

  const currentMcp = (current.mcpServers as McpServers | undefined) ?? {};
  // Team provides a baseline; user entries shadow on conflict (so the user's
  // local tweak to a shared server wins). Same semantics as the bash merge.
  const mergedMcp: McpServers = { ...teamMcp, ...currentMcp };
  const next = { ...current, mcpServers: mergedMcp };
  await atomicWriteJson(claudeJsonPath, next);
  debug(`Installed MCP servers to ${claudeJsonPath}`);
}
