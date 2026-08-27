// Settings.json merger — strategy-based merge of team + user settings.json.
//
// Extracted from src/lib/mcp.ts (was responsibility #4 of 5 in that file).
// The orchestrator `mergeSettings` and its 5 strategies are now individually
// exported so they can be unit-tested in isolation.
//
// `mcpServers` never reaches mergeSettings: installSettings (src/setup.ts)
// destructures it out of the composed settings before calling this function.
// MCP itself is owned by src/lib/mcp.ts, which writes ~/.claude.json directly
// (installMcpToClaudeJson) and prunes any legacy settings.json copy
// (pruneSettingsMcpServers) — it never touches settings.json's merge path.
// Keeps this file free of MCP knowledge.
//
// For the full merge algorithm and invariant documentation see the
// JSDoc on `mergeSettings` below.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Settings } from "../schemas/settings.ts";
import { debug, info, success } from "./colors.ts";
import { isManagedHookCommand, parseHookCommand } from "./hook-command.ts";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";
import { asRecord, canonicalKey, subtractByKey, unionByKey, uniqueByKey } from "./merge-keyed.ts";
import { promptYn } from "./prompts.ts";

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
  /** Absolute path to the source tree being installed (cc-settings' own repo
   *  root — the same `source`/`args.sourceDir` setup.ts threads everywhere
   *  else). Used by hooksStrategy to prune stale managed-hook references (see
   *  `isStaleManagedHookCommand`/`pruneStaleManagedHooks` below) — undefined
   *  in contexts with no source tree to check against (e.g. a strategy called
   *  directly in a unit test), which fails open and skips that prune. */
  sourceDir?: string;
  /** The full settings object the PREVIOUS install's baseline recorded
   *  (~/.claude/.cc-settings-baseline.json, written since v13.1.0). Enables
   *  three-way decisions: a live value that still equals what that install
   *  wrote is cc-settings' own old default, not a user choice, so a retired
   *  env key is pruned and a changed default is updated instead of the
   *  user-wins rule freezing it forever. A value the user changed since
   *  always wins, exactly as before. Undefined (pre-baseline install, or a
   *  unit test) fails open: registry-only prune, plain user-wins. */
  baselineSettings?: Record<string, unknown>;
}

export interface MergeAccounting {
  permissionsAdded: number;
  permissionsDeclined: number;
  permissionsAdoptedScalars: number;
  permissionsPruned: number;
  hooksAdded: number;
  hooksDeclined: number;
  hooksPruned: number;
  hooksSuperseded: number;
  envUserWins: number;
  envAdoptedScalars: number;
  envPruned: number;
  /** Values still equal to the previous install's baseline that were moved to
   *  the new team default (three-way: our old default, not a user choice). */
  defaultsUpdated: number;
  scalarsAdopted: number;
  defaultsAdded: number;
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
// passed the Settings schema). `asRecord` (merge-keyed.ts) coerces a non-object
// to an empty record; `stringArrayField` resolves a non-array field to
// undefined. unionPermissionArray treats undefined as "no rules", so a corrupt
// settings.json degrades to empty instead of throwing on a bad shape — these
// replace scattered `as UnknownRecord` / `as StringArray` casts that used to
// assert those shapes without checking them.
function stringArrayField(rec: UnknownRecord, key: string): StringArray {
  const v = rec[key];
  return Array.isArray(v) ? v : undefined;
}

// Permission rules naming tools Claude Code has removed. The union merge
// otherwise preserves these forever as "user extras" once the team config
// drops them, and Claude Code warns `Permission rule "..." matches no known
// tool` at every session start — the permissions counterpart of
// DEPRECATED_COMMAND_PATTERNS for hooks. Same removal policy as that list:
// droppable ~6 minor releases after the tool retired.
export const DEPRECATED_PERMISSION_PATTERNS: RegExp[] = [
  // Claude Code removed the MultiEdit tool (batch edits folded into Edit).
  // Rules naming it were removed from config/ in v12.2.6; prune the
  // stragglers that the union merge kept alive on existing installs.
  /^MultiEdit\(/,
  // Claude Code 2.1.210 deprecated Write(path)/NotebookEdit(path)/Glob(path)
  // rules (Edit/Read rules now govern those tools; the old forms warn at
  // startup). Only the exact rules cc-settings shipped are pruned — v12.4.0
  // replaced them with Edit(...) equivalents in config/30-permissions.json.
  // User-authored Write/Glob/NotebookEdit rules are left alone: pruning a
  // custom deny rule without rewriting it would silently drop protection.
  /^Write\(\*\)$/,
  /^Glob\(\*\)$/,
  /^NotebookEdit\(\*\)$/,
  /^Write\(~\/\.ssh\/\*\)$/,
  /^Write\(~\/\.aws\/\*\)$/,
  /^Write\(~\/\.gnupg\/\*\)$/,
  /^Write\(~\/\.bashrc\)$/,
  /^Write\(~\/\.zshrc\)$/,
  /^Write\(~\/\.bash_profile\)$/,
  /^Write\(~\/\.claude\/settings\.json\)$/,
  /^Write\(~\/\.claude\.json\)$/,
];

export function permissionRuleIsDeprecated(rule: string): boolean {
  return DEPRECATED_PERMISSION_PATTERNS.some((re) => re.test(rule));
}

// env keys cc-settings used to ship and has since dropped. envStrategy is a
// union with the user winning every conflict, so without this a retired key
// survives on every existing install forever — new installs get upstream's
// behavior while older ones stay frozen on a value we no longer set. The env
// counterpart of DEPRECATED_PERMISSION_PATTERNS, same removal policy.
//
// Only exact keys cc-settings itself shipped belong here. A user who set the
// same variable by hand loses their value, which is the same tradeoff the two
// registries above already make — worth it for a key we chose for them, wrong
// for anything we never wrote.
export const DEPRECATED_ENV_KEYS = new Set<string>([
  // Pinned to "2" in v12.6.0 to LOOSEN Claude Code's then-default of 1, so
  // maestro/deslopper could still fan out when invoked as subagents. Upstream
  // 2.1.219 raised its own default to 3, which turned the identical pin into a
  // restriction — capping nesting below stock. Dropped in v13.2.1; installs
  // now inherit whatever upstream defaults to.
  "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH",
  // Shipped v2.1.108-era to force the 1-hour prompt cache on every request.
  // Replaced in v15.2.0 by the typed promptCacheTtl ("1h") +
  // subagentPromptCacheTtl ("5m") settings keys, which sit above this var in
  // upstream precedence AND stop paying the 1h cache-write rate on subagent
  // fan-outs. Registry entry covers pre-baseline installs; baseline-recorded
  // installs are pruned by the three-way check in envStrategy either way.
  "ENABLE_PROMPT_CACHING_1H",
]);

// Union two string arrays, preserving team order. Team-only entries can be
// declined in interactive mode (they're the ones team added since last install).
// Rules naming removed tools (DEPRECATED_PERMISSION_PATTERNS) are pruned from
// BOTH inputs — filtering only user extras would let a deprecated rule survive
// via the team side, or via presence in both arrays. `pruneDeprecated=false`
// exempts arrays that hold non-rule strings (additionalDirectories is paths,
// and a path starting with `MultiEdit(` must not be reinterpreted as a rule).
export async function unionPermissionArray(
  team: StringArray,
  user: StringArray,
  opts: MergeOptions,
  label: string,
  alwaysAccept = false,
  pruneDeprecated = true,
): Promise<{ merged: string[] | undefined; added: number; declined: number; pruned: number }> {
  const rawTeam = team ?? [];
  const rawUser = user ?? [];
  if (rawTeam.length === 0 && rawUser.length === 0)
    return { merged: undefined, added: 0, declined: 0, pruned: 0 };

  const teamArr = pruneDeprecated ? rawTeam.filter((r) => !permissionRuleIsDeprecated(r)) : rawTeam;
  const userArr = pruneDeprecated ? rawUser.filter((r) => !permissionRuleIsDeprecated(r)) : rawUser;
  const pruned = rawTeam.length - teamArr.length + (rawUser.length - userArr.length);
  // Post-filter emptiness must return [] rather than undefined: the strategy's
  // `{ ...t, ...u }` spread would otherwise carry the raw (deprecated) array
  // through to the merged output untouched.
  if (teamArr.length === 0 && userArr.length === 0)
    return { merged: [], added: 0, declined: 0, pruned };

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
  return { merged, added: userExtras.length, declined, pruned };
}

// Prompt for a scalar conflict: user has X, team has Y, values differ.
/** Navigate a dotted path ("attribution.sessionUrl") into the baseline
 *  settings. Returns undefined when there is no baseline or the path is
 *  absent — callers treat that as "no three-way evidence" and fall back to
 *  plain user-wins. */
export function baselineValueAt(opts: MergeOptions, path: string): unknown {
  let cursor: unknown = opts.baselineSettings;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as UnknownRecord)[segment];
  }
  return cursor;
}

/** True when the user's live value is byte-for-byte what the previous install
 *  wrote at this path — i.e. cc-settings' own old default, safe to update to
 *  the new team value without overriding a user choice. */
export function userMatchesBaseline(opts: MergeOptions, path: string, userVal: unknown): boolean {
  const baseline = baselineValueAt(opts, path);
  return baseline !== undefined && Bun.deepEquals(userVal, baseline, true);
}

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
    false,
    false, // paths, not rules — never prune
  );

  const merged: UnknownRecord = { ...t, ...u };
  if (allow.merged !== undefined) merged.allow = allow.merged;
  if (deny.merged !== undefined) merged.deny = deny.merged;
  if (ask.merged !== undefined) merged.ask = ask.merged;
  if (dirs.merged !== undefined) merged.additionalDirectories = dirs.merged;

  // Scalar conflicts within permissions (defaultMode, autoMode).
  for (const k of ["defaultMode", "autoMode"]) {
    if (k in t && k in u && JSON.stringify(t[k]) !== JSON.stringify(u[k])) {
      if (userMatchesBaseline(opts, `permissions.${k}`, u[k])) {
        merged[k] = t[k];
        ctx.accounting.defaultsUpdated++;
        continue;
      }
      const { value, adopted } = await resolveScalarConflict(`permissions.${k}`, t[k], u[k], opts);
      merged[k] = value;
      if (adopted) ctx.accounting.permissionsAdoptedScalars++;
    }
  }

  ctx.accounting.permissionsAdded += allow.added + deny.added + ask.added + dirs.added;
  ctx.accounting.permissionsDeclined +=
    allow.declined + deny.declined + ask.declined + dirs.declined;
  ctx.accounting.permissionsPruned += allow.pruned + deny.pruned + ask.pruned;

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
  // nuclear-review (June 2026) merged parallelmax-nudge.ts + review-queue-nudge.ts
  // into a single tool-cadence.ts to halve the PostToolUse Bun spawn cost.
  // Prune any lingering references so upgraders don't fire the dead scripts.
  /parallelmax-nudge\.ts\b/,
  /review-queue-nudge\.ts\b/,
  // cc-settings v11.17.0 removed track-tldr.ts and tldr-stats.ts (dead telemetry
  // that only emitted when tldr-cheatsheet was used — never wired in shipped
  // config). Prune so upgraders stop seeing "No such file or directory".
  /track-tldr\.ts\b/,
  /tldr-stats\.ts\b/,
  // cc-settings v13.0.0 gave the PreCompact/SessionEnd handoff hooks a
  // --from-hook flag, which is what carries session_id + trigger through to
  // PostCompact. The command string changed, so the union merge would
  // otherwise keep the OLD flagless invocation alongside the new one and fire
  // both — and the flagless one writes a handoff with no session provenance,
  // which PostCompact then cannot match. Matches only the exact bare form:
  // anchored at the end, so `create --from-hook` is untouched, and a user's
  // own `create --summary "..."` hook is left alone.
  /handoff\.ts["']?\s+create\s*$/,
];

export function commandIsDeprecated(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return DEPRECATED_COMMAND_PATTERNS.some((re) => re.test(value));
}

export function isDeprecatedHook(hook: unknown): boolean {
  if (!hook || typeof hook !== "object") return false;
  return commandIsDeprecated((hook as { command?: unknown }).command);
}

// Commands of every hook in a group, for the supersede check below.
function commandsOf(group: unknown): string[] {
  if (!group || typeof group !== "object") return [];
  const hooks = (group as { hooks?: unknown[] }).hooks;
  if (!Array.isArray(hooks)) return [];
  return hooks
    .map((h) => (h && typeof h === "object" ? (h as { command?: unknown }).command : undefined))
    .filter((c): c is string => typeof c === "string");
}

// cc-settings-managed hook implementations live under ~/.claude/src/{scripts,hooks}/.
// Delegates to the single source of truth in hook-command.ts (scripts|hooks only,
// lib/ excluded — tightened in nuclear-review).
function isManagedCommand(command: string): boolean {
  return isManagedHookCommand(command);
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

// True if `command` is a cc-settings-managed hook invocation (a `bun
// "$HOME/.claude/src/{scripts,hooks}/<name>.ts"` shape — see hook-command.ts)
// whose target file is absent from `sourceDir` — the source tree currently
// being installed, e.g. cc-settings' own repo root (`args.sourceDir` in
// setup.ts). `sourceDir` undefined (a strategy exercised directly, with no
// source tree to check against) fails open: never treat anything as stale.
//
// Generalizes DEPRECATED_COMMAND_PATTERNS: instead of hand-maintaining a
// regex per renamed/removed script, ask the filesystem whether cc-settings
// still ships the file. This is what the sonor → sondeo → farolero rename
// churn needed — each rename left the PREVIOUS hook's settings.json entry an
// "unrecognized" user extra (the merge doesn't know the old and new commands
// are "the same hook, renamed"), which then survived every subsequent
// install forever, each pointing at a `.ts` file that no longer exists
// ("Module not found" on every `git commit`). See CHANGELOG 13.4.3.
export function isStaleManagedHookCommand(command: string, sourceDir: string | undefined): boolean {
  if (!sourceDir) return false;
  const parsed = parseHookCommand(command);
  if (!parsed.managed || !parsed.relPath) return false;
  return !existsSync(join(sourceDir, "src", parsed.relPath));
}

// Same shape as pruneDeprecatedHooks, but the removal test is "does the
// referenced managed script still exist in the source tree" rather than a
// hand-maintained regex list. Complements pruneDeprecatedHooks (both run over
// the same user-extra group in hooksStrategy) rather than replacing it — a
// command that never matched the managed-hook shape at all (a raw shell
// command, or a script that lives elsewhere on disk, e.g. `~/bin/*`) is
// untouched by either and is a genuine customization, never pruned.
export function pruneStaleManagedHooks(
  group: unknown,
  sourceDir: string | undefined,
): unknown | null {
  if (!sourceDir) return group;
  if (!group || typeof group !== "object") return group;
  const g = group as { hooks?: unknown[] };
  if (!Array.isArray(g.hooks)) return group;
  const kept = g.hooks.filter((h) => {
    if (!h || typeof h !== "object") return true;
    const command = (h as { command?: unknown }).command;
    return typeof command !== "string" || !isStaleManagedHookCommand(command, sourceDir);
  });
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

  // canonicalKey, not JSON.stringify: Claude Code rewrites hook entries in its
  // own field order, and a key-order-sensitive identity made every rewritten
  // group look user-added — one fresh duplicate per setup run. uniqueByKey on
  // both inputs also collapses duplicates already accumulated by past installs.
  const keyOf = canonicalKey;
  const events = new Set([...Object.keys(t), ...Object.keys(u)]);
  const merged: UnknownRecord = {};

  for (const ev of events) {
    const teamGroups = uniqueByKey(Array.isArray(t[ev]) ? (t[ev] as unknown[]) : [], keyOf);
    const userGroups = uniqueByKey(Array.isArray(u[ev]) ? (u[ev] as unknown[]) : [], keyOf);
    const teamJson = new Set(teamGroups.map(keyOf));
    const teamCommands = new Set(teamGroups.flatMap(commandsOf));
    const teamOnly = subtractByKey(teamGroups, userGroups, keyOf);
    const rawUserExtras = subtractByKey(userGroups, teamGroups, keyOf);

    // Drop user extras whose commands point at scripts cc-settings has removed
    // — either a hand-listed DEPRECATED_COMMAND_PATTERNS match, or (more
    // generally) a managed-hook command whose target file the source tree no
    // longer ships at all (renamed or deleted; see pruneStaleManagedHooks).
    const userExtras: unknown[] = [];
    for (const g of rawUserExtras) {
      const afterDeprecated = pruneDeprecatedHooks(g);
      const cleaned =
        afterDeprecated === null ? null : pruneStaleManagedHooks(afterDeprecated, opts.sourceDir);
      const pruned = cleaned !== g;
      if (cleaned === null) {
        ctx.accounting.hooksPruned++;
        continue;
      }
      if (pruned) {
        ctx.accounting.hooksPruned++; // partial prune (either mechanism, or both)
        // A partial prune can collapse a user group into one the team already
        // provides (e.g. [stop-summary, removed-hook] → [stop-summary]). Drop it
        // rather than emit a duplicate of the team-provided group.
        if (teamJson.has(keyOf(cleaned))) continue;
      }
      // Supersede stale variants: when the team evolves a hook group (adds a
      // timeout, an `if` filter, …), the old shape survives the union as a
      // "user extra" forever. A user extra whose hooks are all cc-settings-
      // managed scripts the team already wires for this event is that stale
      // old shape, not a customization — the team definition supersedes it.
      const cmds = commandsOf(cleaned);
      if (cmds.length > 0 && cmds.every((c) => isManagedCommand(c) && teamCommands.has(c))) {
        ctx.accounting.hooksSuperseded++;
        continue;
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

  // Drop keys cc-settings retired. Guarded on `!(k in t)` so a key that is
  // BOTH listed here and still shipped stays — the team config always wins
  // that argument, and it makes re-adding a retired key a one-line config
  // change rather than a two-file one.
  for (const k of DEPRECATED_ENV_KEYS) {
    if (k in merged && !(k in t)) {
      delete merged[k];
      ctx.accounting.envPruned++;
    }
  }

  // Three-way prune (the registry's data-driven successor): the previous
  // install's baseline wrote this key, the incoming team config no longer
  // sets it, and the live value still equals what that install wrote — so
  // removing the key removes only what cc-settings itself put there. A value
  // the user changed since is a user edit and stays, which is exactly the
  // discrimination the hand-maintained registry above cannot make.
  const baselineEnvRaw = baselineValueAt(ctx.opts, "env");
  const baselineEnv = isPlainObject(baselineEnvRaw) ? baselineEnvRaw : undefined;
  if (baselineEnv) {
    for (const k of Object.keys(baselineEnv)) {
      if (k in merged && !(k in t) && merged[k] === baselineEnv[k]) {
        delete merged[k];
        ctx.accounting.envPruned++;
      }
    }
  }

  for (const k of Object.keys(u)) {
    if (k in t && u[k] !== t[k]) {
      // Three-way: the user's value is still what the previous install wrote,
      // so the difference is cc-settings changing its own default — adopt the
      // new one instead of freezing the old default as a "user" value.
      if (baselineEnv && k in baselineEnv && u[k] === baselineEnv[k]) {
        merged[k] = t[k];
        ctx.accounting.defaultsUpdated++;
        continue;
      }
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
  // Three-way: the user's block is still exactly what the previous install
  // wrote — not a custom statusline — so it follows the team block, including
  // new sub-keys user-wins-whole would otherwise silently drop.
  if (
    team !== undefined &&
    user !== undefined &&
    userMatchesBaseline(ctx.opts, "statusLine", user) &&
    !Bun.deepEquals(user, team, true)
  ) {
    ctx.accounting.defaultsUpdated++;
    return { keep: true, value: team };
  }
  // Default object overlay: user wins when declared.
  if (user !== undefined) return { keep: true, value: user };
  return { keep: true, value: team };
};

function isPlainObject(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Recursive deep-merge for the default strategy, user winning on every conflict.
//
// The both-objects case recurses so that team-only sub-keys (new config defaults
// added by a sync — e.g. `attribution.sessionUrl` in v11.27.0) land *inside* a
// block the user already has, instead of the user's whole block shadowing them.
// Before this, `{ ...teamRaw, ...userRaw }` semantics meant a user's existing
// `attribution: { commit, pr }` replaced the team's `{ commit, pr, sessionUrl }`
// wholesale and the new default silently never reached the install.
//
// Arrays and object↔scalar shape mismatches keep user-wins-whole: an array or a
// retyped field is a deliberate user replacement, not a partial override, so we
// don't try to merge into it. Scalar conflicts use the shared interactive prompt.
async function deepMergeUserWins(
  key: string,
  team: unknown,
  user: unknown,
  ctx: StrategyContext,
): Promise<unknown> {
  if (user === undefined) return team;
  if (team === undefined) return user;

  if (isPlainObject(team) && isPlainObject(user)) {
    const out: UnknownRecord = {};
    for (const k of new Set([...Object.keys(team), ...Object.keys(user)])) {
      // A key the team provides but the user's block lacks is a new default
      // landing into an existing block — count it so the install reports it.
      if (!(k in user) && k in team) ctx.accounting.defaultsAdded++;
      out[k] = await deepMergeUserWins(`${key}.${k}`, team[k], user[k], ctx);
    }
    return out;
  }

  // Arrays or mismatched shapes: user wins silently (preserves prior behavior).
  const tIsScalar = !(Array.isArray(team) || (team !== null && typeof team === "object"));
  const uIsScalar = !(Array.isArray(user) || (user !== null && typeof user === "object"));
  if (!tIsScalar || !uIsScalar) return user;
  if (team === user) return user;

  // Three-way first: the user's value is still what the previous install
  // wrote at this path, so the conflict is cc-settings changing its own
  // default (e.g. attribution.sessionUrl false → true) — take the new one
  // silently rather than prompting or freezing the stale default.
  if (userMatchesBaseline(ctx.opts, key, user)) {
    ctx.accounting.defaultsUpdated++;
    return team;
  }

  // Scalar conflict: prompt or silent user-wins. The path (e.g. "model",
  // "spinnerVerbs.mode") names the field in the interactive prompt.
  const { value, adopted } = await resolveScalarConflict(key, team, user, ctx.opts);
  if (adopted) ctx.accounting.scalarsAdopted++;
  return value;
}

// Default fallback for any key not in STRATEGIES. Deep-merges objects so team
// defaults land per-key (user wins on conflict); team-only and user-only keys
// pass through; arrays and scalars are user-wins, with scalar conflicts able to
// prompt in interactive mode.
export const userWinsScalarStrategy: Strategy = async (key, team, user, ctx) => {
  if (team === undefined && user === undefined) return { keep: false };
  return { keep: true, value: await deepMergeUserWins(key, team, user, ctx) };
};

// --- Strategy registry ---------------------------------------------------

export const STRATEGIES: Record<string, Strategy> = {
  permissions: permissionsStrategy,
  hooks: hooksStrategy,
  env: envStrategy,
  statusLine: statusLineStrategy,
  // mcpServers is destructured out by installSettings (src/setup.ts) before
  // this function is invoked — it is excluded from the per-key strategy loop.
};

// --- Pure orchestrator ---------------------------------------------------

/**
 * Pure settings merge: reads existingPath, merges with teamSettings using the
 * per-key strategy table, writes the result to outputPath.
 *
 * `mcpServers` is not special-cased at all: cc-settings never writes it to
 * settings.json (Claude Code reads user-scope MCP servers from ~/.claude.json —
 * see src/lib/mcp.ts). A block a user put there themselves is preserved by the
 * userWinsScalar fallback like any other unknown key.
 *
 * Non-interactive policy (default):
 *   - User-declared keys win for top-level scalars (model, theme, …).
 *   - Object-valued keys with no dedicated strategy (attribution, sandbox, …)
 *     deep-merge: team-only sub-keys (new defaults from a sync) land while the
 *     user's customized sub-keys win. Arrays stay user-wins-whole.
 *   - `permissions.{allow,deny,ask,additionalDirectories}` are unioned so the
 *     team baseline (guardrails, common tool access) survives while user
 *     additions are preserved.
 *   - `hooks` is per-event union of groups, with deprecation prune for
 *     user-only groups pointing at removed cc-settings scripts.
 *   - `env` shallow-merges with user values winning.
 *   - `statusLine` user wins, except when the user's command targets a
 *     removed cc-settings script (then reset to team).
 *
 * Interactive policy (`opts.interactive`):
 *   - Scalar conflicts prompt "keep your value / take team's".
 *   - Team-added permission rules (allow/ask) and hook groups prompt "adopt / skip".
 *   - `deny` rules and user-only entries stay automatic (guardrails / additive).
 */
export async function mergeSettings(
  existingPath: string,
  teamSettings: Record<string, unknown>,
  outputPath: string,
  opts: MergeOptions = {},
): Promise<MergeAccounting | null> {
  const userRaw = (await readJsonOrNull(existingPath)) as UnknownRecord | null;

  // No existing file → write team as-is (atomic).
  if (!userRaw) {
    await atomicWriteJson(outputPath, teamSettings);
    return null;
  }

  // Validate userRaw against the Settings schema. On failure we log a debug
  // message and proceed with the raw object — forward-compat safety: a new
  // Claude Code settings key not yet in the schema must not block the merger.
  // teamSettings needs no validation here: composeSettings already
  // schema-checked the composed config/ fragments and throws on failure.
  const userValidation = Settings.safeParse(userRaw);
  if (!userValidation.success) {
    const issues = userValidation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    debug(`User settings.json failed schema validation (proceeding with raw): ${issues}`);
  }

  const ctx: StrategyContext = {
    opts,
    accounting: {
      permissionsAdded: 0,
      permissionsDeclined: 0,
      permissionsAdoptedScalars: 0,
      permissionsPruned: 0,
      hooksAdded: 0,
      hooksDeclined: 0,
      hooksPruned: 0,
      hooksSuperseded: 0,
      envUserWins: 0,
      envAdoptedScalars: 0,
      envPruned: 0,
      defaultsUpdated: 0,
      scalarsAdopted: 0,
      defaultsAdded: 0,
      statusLineReset: false,
    },
  };

  // Walk every key in (team ∪ user). Strategy table picks the merge logic;
  // unknown keys fall through to user-wins-scalar.
  const merged: UnknownRecord = {};
  const allKeys = new Set([...Object.keys(teamSettings), ...Object.keys(userRaw)]);

  for (const key of allKeys) {
    const strategy = STRATEGIES[key] ?? userWinsScalarStrategy;
    const result = await strategy(key, teamSettings[key], userRaw[key], ctx);
    if (result.keep) merged[key] = result.value;
  }

  await atomicWriteJson(outputPath, merged);
  // Return accounting so the caller (installSettings in setup.ts) can print
  // the user-facing summary — §3.4: mergeSettings is a pure orchestrator.
  return ctx.accounting;
}

/** Print the merge accounting summary. Called by installSettings after
 *  mergeSettings returns. Separated from mergeSettings so the orchestrator
 *  stays side-effect free (§3.4). */
export function printMergeAccounting(a: MergeAccounting, opts: MergeOptions = {}): void {
  const bits: string[] = [];
  if (a.permissionsAdded > 0) bits.push(`${a.permissionsAdded} permission rule(s)`);
  if (a.hooksAdded > 0) bits.push(`${a.hooksAdded} hook group(s)`);
  if (a.envUserWins > 0) bits.push(`${a.envUserWins} env override(s)`);
  if (bits.length > 0) success(`Preserved user customization: ${bits.join(", ")}`);

  if (a.defaultsAdded > 0) {
    info(`Added ${a.defaultsAdded} new team default(s) into existing settings block(s)`);
  }

  if (a.hooksPruned > 0) {
    info(`Pruned ${a.hooksPruned} stale hook reference(s) pointing at removed cc-settings scripts`);
  }
  if (a.permissionsPruned > 0) {
    info(`Pruned ${a.permissionsPruned} stale permission rule(s) naming removed tools`);
  }
  if (a.defaultsUpdated > 0) {
    info(`Updated ${a.defaultsUpdated} stale default(s) to the new team value`);
  }
  if (a.envPruned > 0) {
    info(`Pruned ${a.envPruned} env var(s) cc-settings no longer sets`);
  }
  if (a.hooksSuperseded > 0) {
    info(`Dropped ${a.hooksSuperseded} stale variant(s) of team-managed hook groups`);
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
}
