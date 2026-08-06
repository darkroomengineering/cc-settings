// Light install profile manifest + settings transform.
//
// The light profile is RAW Claude Code with exactly two cc-settings additions:
//   1. The statusLine hook
//   2. The share-learning skill
//
// Everything else is stripped: no CLAUDE.md, no AGENTS.md, no agents, no rules,
// no profiles, no docs, no MCP servers, no hooks (except statusLine),
// no effort override, no permission rules.
//
// Callers:
//   - src/lib/install-fs.ts — filters file copies, prunes full-only targets
//   - src/setup.ts           — applies the settings transform before staging
//   - tests/light-profile.test.ts — parity guard + transform units

import { isManagedHookCommand } from "./hook-command.ts";
import { MANAGED_SKILLS } from "./managed-skills.ts";
import { asRecord, canonicalKey, subtractByKey } from "./merge-keyed.ts";

export type Profile = "full" | "light";

/**
 * Full-only dirs that cc-settings SHARES with the user rather than owning
 * outright — mapped to the exact files it ships there. A full→light downgrade
 * prunes only those files, never the directory.
 *
 * `output-styles/` is the case this exists for: Claude Code's own /config
 * picker tells users to hand-write styles at that path, so the plain
 * `rm -rf <dir>` every other full-only dir gets would delete personal work on a
 * downgrade. Mirrors the scoping applied to the same dir in
 * MANAGED_TOP_LEVEL_PATHS (install-fs.ts) — both paths must stay narrow, or the
 * data loss just moves from one to the other. Pinned by
 * tests/output-style-preserve.test.ts, which covers both.
 */
const SHARED_DIR_OWNED_FILES: Record<string, string[]> = {
  "output-styles": ["darkroom.md"],
};

// The ONLY skill installed on light. No headline/dep split needed.
export const LIGHT_SKILLS: readonly string[] = ["share-learning"] as const;

// ---------------------------------------------------------------------------
// Profile manifest — single source of truth for the per-profile file footprint
// ---------------------------------------------------------------------------
//
// Consumed by src/lib/install-fs.ts:
//   - installConfigFiles      copies the profile's files; for light, also prunes
//                             every full-only target via lightProfilePruneTargets
//                             (full-minus-light)
// Consumed by src/lib/install-display.ts:
//   - cmdDryRun / showSummary render the install tables from it

export interface ProfileManifest {
  /** [sourceName, installedName] pairs copied to ~/.claude/<installedName>. */
  readonly rootFiles: ReadonlyArray<readonly [src: string, dest: string]>;
  /** Repo dirs whose contents are copied wholesale to ~/.claude/<dir>/. */
  readonly dirs: readonly string[];
  /**
   * Dirs from the FULL profile that this profile keeps on disk even though it
   * doesn't copy into them wholesale. Light retains:
   *   - skills: light installs the LIGHT_SKILLS subset; pruning of full-only
   *     skills is source-scoped code in setup.ts, never a blanket rm.
   *   - hooks: createDirectories provisions ~/.claude/hooks for every profile;
   *     cleanOldConfig already strips the managed *.md content.
   */
  readonly retainedDirs: readonly string[];
}

export const PROFILE_MANIFEST: Record<Profile, ProfileManifest> = {
  full: {
    rootFiles: [
      ["CLAUDE-FULL.md", "CLAUDE.md"],
      ["AGENTS.md", "AGENTS.md"],
    ],
    dirs: ["agents", "skills", "profiles", "rules", "hooks", "docs", "output-styles"],
    retainedDirs: [],
  },
  light: {
    rootFiles: [],
    dirs: [],
    retainedDirs: ["skills", "hooks"],
  },
} as const;

/**
 * Every path (relative to CLAUDE_DIR) a light install must prune from a prior
 * full install: full-only skills (MANAGED_SKILLS minus LIGHT_SKILLS) plus every
 * full-only rootFile/dir from PROFILE_MANIFEST (full-minus-light).
 *
 * Pure computation over MANAGED_SKILLS/LIGHT_SKILLS/PROFILE_MANIFEST — no disk
 * I/O. Callers pass the returned paths to a force-remove (rm force:true is a
 * no-op on a path that doesn't exist), so this never needs to check existence
 * itself.
 *
 * OVERLAP WITH cleanOldConfig — deliberate, and measured (nuclear-review F7).
 * cleanOldConfig runs first and already removes some of what this returns, so
 * two of the three categories below are no-ops in practice. Established by
 * deleting each category and running the full→light E2E:
 *
 *   - non-light skill dirs  → REDUNDANT. cleanOldConfig rm -rf's EVERY
 *                             MANAGED_SKILLS dir, and the light copy restores
 *                             only LIGHT_SKILLS. E2E passes without them.
 *   - CLAUDE.md / AGENTS.md → REDUNDANT. Both are `wipe: "recursive"` entries in
 *                             MANAGED_TOP_LEVEL_PATHS. E2E passes without them.
 *   - full-only dirs        → LOAD-BEARING. cleanOldConfig only glob-wipes
 *                             `*.md` INSIDE agents/profiles/rules/docs; the dirs
 *                             themselves (recreated by createDirectories) and
 *                             any non-.md content survive. E2E FAILS without
 *                             them.
 *
 * The redundant categories are kept on purpose. This function's contract is
 * "the complete full-minus-light footprint" — a self-contained question with a
 * checkable answer. Narrowing it to only the load-bearing third would trade
 * that for an implicit dependency on cleanOldConfig's internals: light
 * correctness would silently rest on its MANAGED_SKILLS loop continuing to wipe
 * ALL managed skills rather than just the ones about to be re-copied. Incident
 * H7 came from exactly that class of cross-list coupling. The cost of keeping
 * them is ~40 force-removes of absent paths, issued in parallel.
 *
 * SHARED DIRS are the one exception to "full-only dir → rm -rf": see
 * SHARED_DIR_OWNED_FILES directly below.
 */
export function lightProfilePruneTargets(): string[] {
  const targets: string[] = [];

  // Prune skills from a prior full install that are not in the light set.
  // Scoped to MANAGED_SKILLS so user-authored skills are never touched.
  const lightSkillSet = new Set(LIGHT_SKILLS);
  for (const skill of MANAGED_SKILLS) {
    if (!lightSkillSet.has(skill)) targets.push(`skills/${skill}`);
  }

  // Prune full-only rootFiles and dirs (CLAUDE.md, AGENTS.md, agents/, …).
  const { full, light } = PROFILE_MANIFEST;
  const lightFiles = new Set(light.rootFiles.map(([, dest]) => dest));
  const lightDirs = new Set([...light.dirs, ...light.retainedDirs]);
  for (const [, dest] of full.rootFiles) {
    if (!lightFiles.has(dest)) targets.push(dest);
  }
  for (const d of full.dirs) {
    if (lightDirs.has(d)) continue;
    const owned = SHARED_DIR_OWNED_FILES[d];
    // Shared dir: prune only the files cc-settings ships, never the directory.
    if (owned) targets.push(...owned.map((f) => `${d}/${f}`));
    else targets.push(d);
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Settings transforms
// ---------------------------------------------------------------------------

/**
 * Apply the light profile transform to a composed settings object.
 *
 * Pure function — does NOT mutate the input. Returns a new object with ONLY
 * `$schema` and `statusLine`. Everything else (mcpServers, hooks, env,
 * permissions, model, …) is dropped — light is raw Claude Code.
 */
export function applyLightProfile(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("$schema" in settings) out.$schema = settings.$schema;
  if ("statusLine" in settings) out.statusLine = settings.statusLine;
  return out;
}

/**
 * Strip all cc-settings managed entries from a user's settings.json, preserving
 * only genuinely user-authored content.
 *
 * Pure function — does NOT mutate either input. Returns a deep clone of `user`
 * with the cc-settings full footprint removed:
 *
 *   env          — delete any key whose value equals full.env[key]. Drop the
 *                  `env` key if it becomes empty.
 *   permissions  — for each sub-key (allow/deny/ask/additionalDirectories),
 *                  remove entries present in full.permissions[that]. Drop empty
 *                  arrays; drop `permissions` if it becomes empty.
 *   mcpServers   — delete any server key present in full.mcpServers. Drop if empty.
 *   hooks        — for each event, drop any group whose canonical JSON matches
 *                  a group in full.hooks[event]; otherwise filter OUT the
 *                  individual hook commands that reference cc-settings script
 *                  paths (/.claude/src/hooks/ or /.claude/src/scripts/) and
 *                  keep the rest of the group (mixed user+cc-settings groups
 *                  survive minus the managed commands). Drop a group only once
 *                  it has no hooks left. Drop empty events; drop `hooks` if empty.
 *   model        — delete if equal to full.model.
 *   statusLine   — left untouched (will be overlaid from applyLightProfile anyway).
 *   unknown keys — left untouched.
 */
export function stripManagedSettings(
  user: Record<string, unknown>,
  full: Record<string, unknown>,
): Record<string, unknown> {
  // Deep clone user so we never mutate the input.
  const out = structuredClone(user) as Record<string, unknown>;

  // --- env ---
  const fullEnv = asRecord(full.env);
  if (out.env !== null && typeof out.env === "object") {
    const userEnv = out.env as Record<string, unknown>;
    for (const key of Object.keys(userEnv)) {
      if (key in fullEnv && userEnv[key] === fullEnv[key]) {
        delete userEnv[key];
      }
    }
    if (Object.keys(userEnv).length === 0) {
      delete out.env;
    }
  }

  // --- permissions ---
  const fullPerms = asRecord(full.permissions);
  if (out.permissions !== null && typeof out.permissions === "object") {
    const userPerms = out.permissions as Record<string, unknown>;
    for (const field of ["allow", "deny", "ask", "additionalDirectories"] as const) {
      const userList = userPerms[field];
      const fullList = fullPerms[field];
      if (Array.isArray(userList) && Array.isArray(fullList)) {
        const filtered = subtractByKey(userList as unknown[], fullList as unknown[], (v) =>
          JSON.stringify(v),
        );
        if (filtered.length === 0) {
          delete userPerms[field];
        } else {
          userPerms[field] = filtered;
        }
      }
    }
    if (Object.keys(userPerms).length === 0) {
      delete out.permissions;
    }
  }

  // --- mcpServers ---
  const fullMcp = asRecord(full.mcpServers);
  if (out.mcpServers !== null && typeof out.mcpServers === "object") {
    const userMcp = out.mcpServers as Record<string, unknown>;
    // Keyed subtraction on the server name: any key present in the full
    // baseline is cc-settings-managed and removed.
    const kept = subtractByKey(Object.entries(userMcp), Object.entries(fullMcp), ([key]) => key);
    if (kept.length === 0) {
      delete out.mcpServers;
    } else {
      out.mcpServers = Object.fromEntries(kept);
    }
  }

  // --- hooks ---
  // Light's promise is "no cc-settings hooks except statusLine", enforced per
  // COMMAND, not per group — a group is only as clean as its dirtiest survivor
  // would make it look. Two passes:
  //   a) Whole-group identity: canonicalKey (key-order-insensitive, matches
  //      settings-merge.ts's identity) against the full baseline. A byte-for-
  //      byte (order-insensitive) match is dropped outright.
  //   b) Otherwise, filter OUT individual hook commands that reference a
  //      cc-settings script path (isManagedHookCommand, hook-command.ts — the
  //      single source of truth: (scripts|hooks) only, lib/ excluded,
  //      tightened in nuclear-review). A mixed group (one user hook + one
  //      cc-settings hook sharing a matcher) keeps the user hook and loses
  //      only the managed one. The group itself is dropped only once every
  //      hook inside it is gone.
  const fullHooks = asRecord(full.hooks);
  if (out.hooks !== null && typeof out.hooks === "object") {
    const userHooks = out.hooks as Record<string, unknown>;
    for (const event of Object.keys(userHooks)) {
      if (!Array.isArray(userHooks[event])) continue;
      const fullGroups = Array.isArray(fullHooks[event]) ? (fullHooks[event] as unknown[]) : [];
      const fullGroupKeys = new Set(fullGroups.map(canonicalKey));
      const filtered: unknown[] = [];
      for (const group of userHooks[event] as unknown[]) {
        if (fullGroupKeys.has(canonicalKey(group))) continue;
        const g = group as { hooks?: Array<{ command?: unknown }> };
        if (!Array.isArray(g.hooks)) {
          filtered.push(group);
          continue;
        }
        const keptHooks = g.hooks.filter(
          (h) => !(typeof h.command === "string" && isManagedHookCommand(h.command)),
        );
        if (keptHooks.length === 0) continue;
        filtered.push(keptHooks.length === g.hooks.length ? group : { ...g, hooks: keptHooks });
      }
      if (filtered.length === 0) {
        delete userHooks[event];
      } else {
        userHooks[event] = filtered;
      }
    }
    if (Object.keys(userHooks).length === 0) {
      delete out.hooks;
    }
  }

  // --- other top-level managed keys (model, sandbox, teammateMode, spinnerVerbs,
  // attribution, …) ---
  // env/permissions/mcpServers/hooks are handled above at sub-key granularity so
  // user-only entries survive. $schema and statusLine are the light baseline —
  // keep them. Every other key cc-settings' full baseline sets is managed: strip
  // it when the user hasn't diverged (deep-equal to full), otherwise it's a
  // genuine user override and stays. Keys absent from `full` are user-only — kept.
  const HANDLED_KEYS = new Set([
    "env",
    "permissions",
    "mcpServers",
    "hooks",
    "$schema",
    "statusLine",
  ]);
  for (const key of Object.keys(full)) {
    if (HANDLED_KEYS.has(key)) continue;
    // canonicalKey (not raw JSON.stringify) so a Claude-Code field-order
    // rewrite of a managed block doesn't masquerade as a user override —
    // matches the identity settings-merge.ts uses for the same class of check.
    if (key in out && canonicalKey(out[key]) === canonicalKey(full[key])) {
      delete out[key];
    }
  }

  return out;
}
