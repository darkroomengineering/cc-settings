// Settings.json merger — strategy-based merge of team + user settings.json.
//
// Extracted from src/lib/mcp.ts (was responsibility #4 of 5 in that file).
// The orchestrator `mergeSettingsWithMcpPreservation` and its 5 strategies are
// now individually exported so they can be unit-tested in isolation.
//
// For the full merge algorithm and invariant documentation see the
// JSDoc on `mergeSettingsWithMcpPreservation` below.

import type { z } from "zod";
import type { McpServers as McpServersSchema } from "../schemas/mcp.ts";
import { Settings } from "../schemas/settings.ts";
import { debug, info, success } from "./colors.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { findUserOnlyServers, promptPreserveUserServers } from "./mcp.ts";
import { subtractByKey, unionByKey } from "./merge-keyed.ts";
import { promptYn } from "./prompts.ts";

type StringArray = string[] | undefined;
type UnknownRecord = Record<string, unknown>;
type McpServer = z.infer<typeof McpServersSchema>[string];
type McpServers = Record<string, McpServer>;

/**
 * Merge policy options. Interactive mode only asks where auto-merge has a real
 * tradeoff: scalar conflicts (user vs team differ on same key) and team-added
 * rules/hooks (team baseline changed since last install). Deny rules and
 * additive merges stay automatic.
 */
export interface MergeOptions {
  interactive?: boolean;
}

export interface MergeAccounting {
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

export interface StrategyContext {
  opts: MergeOptions;
  accounting: MergeAccounting;
}

/**
 * A strategy returns either:
 *   - `{ keep: true, value }` — write `value` under the key in the merged result
 *   - `{ keep: false }` — omit the key entirely
 */
export type StrategyResult = { keep: false } | { keep: true; value: unknown };

export type Strategy = (
  key: string,
  team: unknown,
  user: unknown,
  ctx: StrategyContext,
) => Promise<StrategyResult>;

// --- Strategy helpers (shared) -------------------------------------------

// Read fields off unvalidated settings JSON (the team/user objects may not have
// passed the Settings schema). A non-object resolves to an empty record; a
// non-array field to undefined. unionPermissionArray treats undefined as "no
// rules", so a corrupt settings.json degrades to empty instead of throwing on a
// bad shape — these replace scattered `as UnknownRecord` / `as StringArray` casts
// that used to assert those shapes without checking them.
function asRecord(v: unknown): UnknownRecord {
  return typeof v === "object" && v !== null ? (v as UnknownRecord) : {};
}

function stringArrayField(rec: UnknownRecord, key: string): StringArray {
  const v = rec[key];
  return Array.isArray(v) ? v : undefined;
}

// Union two string arrays, preserving team order. Team-only entries can be
// declined in interactive mode (they're the ones team added since last install).
export async function unionPermissionArray(
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

  const id = (r: string) => r;
  const teamOnly = subtractByKey(teamArr, userArr, id);
  const userExtras = subtractByKey(userArr, teamArr, id);

  let teamKept = teamArr;
  let declined = 0;
  if (opts.interactive && !alwaysAccept && teamOnly.length > 0) {
    info(`Team added ${teamOnly.length} new ${label}(s) since your last install:`);
    for (const r of teamOnly) console.log(`  + ${r}`);
    const adopt = await promptYn("Adopt these?", true);
    if (!adopt) {
      // Drop declined team-only entries; entries the user already has survive.
      teamKept = subtractByKey(teamArr, teamOnly, id);
      declined = teamOnly.length;
    }
  }

  // Preserve team order, append user extras.
  const merged = unionByKey(teamKept, userExtras, id);
  return { merged, added: userExtras.length, declined };
}

// Prompt for a scalar conflict: user has X, team has Y, values differ.
export async function resolveScalarConflict(
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
export const permissionsStrategy: Strategy = async (_key, team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = asRecord(team);
  const u = asRecord(user);
  const { opts } = ctx;

  const allow = await unionPermissionArray(
    stringArrayField(t, "allow"),
    stringArrayField(u, "allow"),
    opts,
    "allow rule",
  );
  const deny = await unionPermissionArray(
    stringArrayField(t, "deny"),
    stringArrayField(u, "deny"),
    opts,
    "deny rule",
    true, // deny always accepts team additions — guardrail
  );
  const ask = await unionPermissionArray(
    stringArrayField(t, "ask"),
    stringArrayField(u, "ask"),
    opts,
    "ask rule",
  );
  const dirs = await unionPermissionArray(
    stringArrayField(t, "additionalDirectories"),
    stringArrayField(u, "additionalDirectories"),
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
//
// Removal policy — this list is append-only by necessity but not permanent. A
// pattern may be dropped once it's implausible any active install still carries
// the dangling reference: as a rule of thumb, ~6 minor releases after the script
// it targets was removed (anyone who skipped that many upgrades re-pins on their
// next install anyway). Delete the pattern together with its dated comment. The
// v10.0.0 `scripts/*.sh` sweep is load-bearing for the bash→TS migration and
// should outlive the per-script entries below it.
export const DEPRECATED_COMMAND_PATTERNS: RegExp[] = [
  /[/\\]\.claude[/\\]scripts[/\\][^"'\s]*\.sh\b/,
  // cc-settings v11.5.1 removed the parallelmax-judge Stop hook: it spawned a
  // nested `claude -p` session whose prompt + SessionStart banner leaked into
  // the user's terminal. Prune any lingering reference so upgraders stop firing
  // it. As a shared `Stop` group with stop-summary.ts, this is a partial prune.
  /parallelmax-judge\.ts\b/,
  // cc-settings v11.6.1 removed the WorktreeCreate/WorktreeRemove hooks added in
  // v11.6.0. In this harness WorktreeCreate is a *provisioning* hook expected to
  // return the new worktree path; our logging-only script returned nothing, so
  // worktree creation failed ("hook succeeded but returned no worktree path").
  // Prune both so upgraders don't keep a broken worktree hook wired.
  /worktree-create\.ts\b/,
  /worktree-remove\.ts\b/,
];

export function commandIsDeprecated(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(value));
}

export function isDeprecatedHook(hook: unknown): boolean {
  if (!hook || typeof hook !== "object") return false;
  return commandIsDeprecated((hook as { command?: unknown }).command);
}

// A group is deprecated only if every hook inside it is deprecated. Mixed
// groups keep their non-deprecated hooks (we filter the inner array).
export function pruneDeprecatedHooks(group: unknown): unknown | null {
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
export const hooksStrategy: Strategy = async (_key, team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = asRecord(team);
  const u = asRecord(user);
  const { opts } = ctx;

  const keyOf = (g: unknown) => JSON.stringify(g);
  const events = new Set([...Object.keys(t), ...Object.keys(u)]);
  const merged: UnknownRecord = {};

  for (const ev of events) {
    const teamGroups = Array.isArray(t[ev]) ? (t[ev] as unknown[]) : [];
    const userGroups = Array.isArray(u[ev]) ? (u[ev] as unknown[]) : [];
    const teamJson = new Set(teamGroups.map(keyOf));
    const teamOnly = subtractByKey(teamGroups, userGroups, keyOf);
    const rawUserExtras = subtractByKey(userGroups, teamGroups, keyOf);

    // Drop user extras whose commands point at scripts cc-settings has removed.
    const userExtras: unknown[] = [];
    for (const g of rawUserExtras) {
      const cleaned = pruneDeprecatedHooks(g);
      if (cleaned === null) {
        ctx.accounting.hooksPruned++;
        continue;
      }
      if (cleaned !== g) {
        ctx.accounting.hooksPruned++; // partial prune
        // A partial prune can collapse a user group into one the team already
        // provides (e.g. [stop-summary, removed-hook] → [stop-summary]). Drop it
        // rather than emit a duplicate of the team-provided group.
        if (teamJson.has(keyOf(cleaned))) continue;
      }
      userExtras.push(cleaned);
    }

    let teamKept = teamGroups;
    if (opts.interactive && teamOnly.length > 0) {
      info(`Team added ${teamOnly.length} hook group(s) for ${ev}:`);
      for (const g of teamOnly) console.log(`  + ${JSON.stringify(g)}`);
      const adopt = await promptYn("Adopt these?", true);
      if (!adopt) {
        // Drop declined team-only groups; groups the user already has survive.
        teamKept = subtractByKey(teamGroups, teamOnly, keyOf);
        ctx.accounting.hooksDeclined += teamOnly.length;
      }
    }

    ctx.accounting.hooksAdded += userExtras.length;
    merged[ev] = unionByKey(teamKept, userExtras, keyOf);
  }

  return { keep: true, value: merged };
};

// env: shallow merge, user wins on key conflict (cache flags, debug toggles
// stick across re-installs). Interactive prompts on each conflict.
export const envStrategy: Strategy = async (_key, team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  const t = asRecord(team);
  const u = asRecord(user);
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
export const statusLineStrategy: Strategy = async (_key, team, user, ctx) => {
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
export const userWinsScalarStrategy: Strategy = async (key, team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  if (user === undefined) return { keep: true, value: team };
  if (team === undefined) return { keep: true, value: user };

  // Both present. For non-scalar values (objects/arrays), user wins silently
  // — matches pre-refactor behavior of `{ ...teamRaw, ...userRaw }`.
  const tIsScalar = !(Array.isArray(team) || (team !== null && typeof team === "object"));
  const uIsScalar = !(Array.isArray(user) || (user !== null && typeof user === "object"));
  if (!tIsScalar || !uIsScalar) return { keep: true, value: user };
  if (team === user) return { keep: true, value: user };

  // Scalar conflict: prompt or silent user-wins. The orchestrator passes the
  // real key (e.g. "model", "theme") so the interactive prompt can name it.
  const { value, adopted } = await resolveScalarConflict(key, team, user, ctx.opts);
  if (adopted) ctx.accounting.scalarsAdopted++;
  return { keep: true, value };
};

// --- Strategy registry ---------------------------------------------------

export const STRATEGIES: Record<string, Strategy> = {
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
 * Merge user's existing settings.json with the in-memory team settings object
 * (the composed config/ fragments — already schema-validated by composeSettings,
 * so there is no team-side file read or re-validation here).
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
  teamSettings: Record<string, unknown>,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<void> {
  const teamRaw: UnknownRecord = teamSettings;

  const userRaw = (await readJsonOrNull(existingPath)) as UnknownRecord | null;

  // No existing file → write team as-is (atomic).
  if (!userRaw) {
    await atomicWriteJson(outputPath, teamRaw);
    return;
  }

  // Validate userRaw and teamRaw against the Settings schema. On failure we
  // log a debug message and proceed with the raw objects — forward-compat
  // safety: a new Claude Code settings key not yet in the schema must not
  // block the merger. This mirrors the pattern in readMcpFromSettings
  // (src/lib/mcp.ts) which returns {} + debug-logs on schema failure.
  const teamValidation = Settings.safeParse(teamRaw);
  if (!teamValidation.success) {
    const issues = teamValidation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    debug(`Team settings.json failed schema validation (proceeding with raw): ${issues}`);
  }
  const userValidation = Settings.safeParse(userRaw);
  if (!userValidation.success) {
    const issues = userValidation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    debug(`User settings.json failed schema validation (proceeding with raw): ${issues}`);
  }

  // mcpServers needs the preservation prompt to run BEFORE the per-key loop —
  // the prompt is shared across the whole merge, not scoped to one strategy.
  // asRecord: a corrupt string-valued mcpServers degrades to {} instead of
  // leaking a string into the server merge.
  const userServers = asRecord(userRaw.mcpServers) as McpServers;
  const teamServers = asRecord(teamRaw.mcpServers) as McpServers;
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
    const result = await strategy(key, teamRaw[key], userRaw[key], ctx);
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
