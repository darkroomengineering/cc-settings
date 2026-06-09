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
//   - src/setup.ts       — filters file copies, applies transform before staging
//   - tests/light-profile.test.ts — parity guard + transform units

export type Profile = "full" | "light";

// The ONLY skill installed on light. No headline/dep split needed.
export const LIGHT_SKILLS: readonly string[] = ["share-learning"] as const;

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
  if ("$schema" in settings) out["$schema"] = settings["$schema"];
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
 *   hooks        — for each event, drop any group whose JSON matches a group in
 *                  full.hooks[event], AND drop groups where all hook commands
 *                  reference cc-settings script paths (/.claude/src/hooks/ or
 *                  /.claude/src/scripts/). Keep genuinely user hook groups. Drop
 *                  empty events; drop `hooks` if empty.
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
  const fullEnv = (full.env !== null && typeof full.env === "object" ? full.env : {}) as Record<
    string,
    unknown
  >;
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
  const fullPerms = (
    full.permissions !== null && typeof full.permissions === "object" ? full.permissions : {}
  ) as Record<string, unknown>;
  if (out.permissions !== null && typeof out.permissions === "object") {
    const userPerms = out.permissions as Record<string, unknown>;
    for (const field of ["allow", "deny", "ask", "additionalDirectories"] as const) {
      const userList = userPerms[field];
      const fullList = fullPerms[field];
      if (Array.isArray(userList) && Array.isArray(fullList)) {
        const fullSet = new Set(fullList.map((v) => JSON.stringify(v)));
        const filtered = (userList as unknown[]).filter((v) => !fullSet.has(JSON.stringify(v)));
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
  const fullMcp = (
    full.mcpServers !== null && typeof full.mcpServers === "object" ? full.mcpServers : {}
  ) as Record<string, unknown>;
  if (out.mcpServers !== null && typeof out.mcpServers === "object") {
    const userMcp = out.mcpServers as Record<string, unknown>;
    for (const key of Object.keys(userMcp)) {
      if (key in fullMcp) {
        delete userMcp[key];
      }
    }
    if (Object.keys(userMcp).length === 0) {
      delete out.mcpServers;
    }
  }

  // --- hooks ---
  // A hook group is cc-settings-managed if:
  //   a) Its JSON string matches any group in the full baseline, OR
  //   b) ALL hook commands in the group reference a cc-settings script path.
  const CC_SCRIPT_PATHS = ["/.claude/src/hooks/", "/.claude/src/scripts/"];
  const isCcScriptCommand = (cmd: unknown): boolean =>
    typeof cmd === "string" && CC_SCRIPT_PATHS.some((p) => cmd.includes(p));
  const isCcManagedGroup = (group: unknown, fullGroupJsonSet: Set<string>): boolean => {
    const groupJson = JSON.stringify(group);
    if (fullGroupJsonSet.has(groupJson)) return true;
    // If the group has hooks and ALL commands are cc-settings paths, treat as managed.
    const g = group as { hooks?: Array<{ command?: unknown }> };
    if (Array.isArray(g.hooks) && g.hooks.length > 0) {
      return g.hooks.every((h) => isCcScriptCommand(h.command));
    }
    return false;
  };

  const fullHooks = (
    full.hooks !== null && typeof full.hooks === "object" ? full.hooks : {}
  ) as Record<string, unknown>;
  if (out.hooks !== null && typeof out.hooks === "object") {
    const userHooks = out.hooks as Record<string, unknown>;
    for (const event of Object.keys(userHooks)) {
      if (!Array.isArray(userHooks[event])) continue;
      const fullGroups = Array.isArray(fullHooks[event]) ? (fullHooks[event] as unknown[]) : [];
      const fullGroupJsonSet = new Set(fullGroups.map((g) => JSON.stringify(g)));
      const filtered = (userHooks[event] as unknown[]).filter(
        (g) => !isCcManagedGroup(g, fullGroupJsonSet),
      );
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
    if (key in out && JSON.stringify(out[key]) === JSON.stringify(full[key])) {
      delete out[key];
    }
  }

  return out;
}
