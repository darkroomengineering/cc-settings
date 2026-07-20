// Single source of truth for "is this string a cc-settings-managed hook command?"
//
// Consolidated from three prior implementations that disagreed on lib/:
//   - settings-merge.ts:262-282 (accepted ~/.claude/src/)
//   - light-profile.ts:169 (accepted /.claude/src/hooks/ | /.claude/src/scripts/)
//   - audit-hooks.ts:100 (accepted scripts|hooks|lib)
//
// The canonical definition is (scripts|hooks) ONLY. lib/ files are support
// modules, not hooks — tightened to reduce the trusted surface.

import { HooksBlock } from "../schemas/hooks.ts";

// `bun "$HOME/.claude/src/<dir>/<name>.ts"` — accept quoted and unquoted
// `$HOME` and `${HOME}` forms. Allow an optional trailing arg list (some
// hooks invoke a script with positional args, e.g. `handoff.ts create`),
// but ONLY simple word-like tokens separated by [ \t] (spaces/tabs): shell
// metacharacters (`;`, `|`, `&`, `$(`, backticks, redirects) are rejected,
// and so are newlines — `\s` would treat `\n` as an arg separator while the
// shell treats it as a command separator, letting a payload on the next line
// (`bun .../x.ts\n/path/to/evilbin`) ride the shipped-pattern match.
// NOTE: [ \t] (not \s) arg-separation is a deliberate security property —
// do NOT widen to \s; that would allow newline-chained payloads to match.
// Capture group 1 is the path relative to ~/.claude/src — the install-manifest key.
export const MANAGED_HOOK_CMD: RegExp =
  /^bun[ \t]+"?\$\{?HOME\}?\/\.claude\/src\/((?:scripts|hooks)\/[a-zA-Z0-9_-]+\.ts)"?(?:[ \t]+[A-Za-z0-9_.:=/-]+)*[ \t]*$/;

// Shell-segment separator: splits a compound command on ; && || and newline
// variants including U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR.
// The \uNNNN escapes stay as explicit codepoints in the source text rather
// than invisible literal characters (encoding-safe).
// Shared by audit-hooks.ts's compound-command classifier and safety-net.ts's
// destructive-command segment splitter — the two legitimately differ in what
// they DO with each segment, but must agree on where a command splits.
export const SHELL_SEGMENT_SEP_RE = /\s*(?:;|&&|\|\||\r?\n|\r|\u2028|\u2029)\s*/;

export interface ParsedHookCommand {
  raw: string;
  /** true iff a bun invocation of ~/.claude/src/{scripts,hooks}/<name>.ts */
  managed: boolean;
  dir: "scripts" | "hooks" | null;
  /** e.g. "hooks/safety-net.ts", or null when not managed */
  relPath: string | null;
}

/** Parse a hook command string against the managed pattern. */
export function parseHookCommand(command: string): ParsedHookCommand {
  const m = command.match(MANAGED_HOOK_CMD);
  if (!m?.[1]) {
    return { raw: command, managed: false, dir: null, relPath: null };
  }
  const relPath = m[1];
  const dir = relPath.startsWith("scripts/") ? "scripts" : "hooks";
  return { raw: command, managed: true, dir, relPath };
}

/** Shorthand predicate — equivalent to parseHookCommand(command).managed */
export function isManagedHookCommand(command: string): boolean {
  return MANAGED_HOOK_CMD.test(command);
}

// ---------------------------------------------------------------------------
// Schema-driven hook traversal — replaces three hand-rolled walks
// ---------------------------------------------------------------------------

/**
 * Tolerantly iterate every command-hook in a settings object or a hooks block.
 *
 * Uses the HooksBlock zod schema: safeParse on success → iterate the typed
 * result. On schema failure falls back to a defensive walk (fail-open — this
 * runs in tamper-detection code and must never throw).
 *
 * The input may be a full settings object (with a `.hooks` sub-key) or a
 * bare hooks block. Both shapes are handled.
 */
export function* iterCommandHooks(
  settingsOrHooks: unknown,
): Generator<{ event: string; command: string }, void, unknown> {
  if (!settingsOrHooks || typeof settingsOrHooks !== "object") return;

  // Unwrap the hooks sub-key if the caller passed a full settings object.
  const hooksCandidate =
    "hooks" in (settingsOrHooks as Record<string, unknown>)
      ? (settingsOrHooks as Record<string, unknown>).hooks
      : settingsOrHooks;

  // --- Schema-driven path ---
  const parsed = HooksBlock.safeParse(hooksCandidate);
  if (parsed.success) {
    for (const [event, groups] of Object.entries(parsed.data)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const hook of group.hooks) {
          if (hook.type === "command") {
            yield { event, command: hook.command };
          }
        }
      }
    }
    return;
  }

  // --- Defensive fallback (fail-open) ---
  // Schema parse failed — walk the raw object defensively so we still surface
  // hooks from settings that use a newer (forward-compat) shape.
  if (!hooksCandidate || typeof hooksCandidate !== "object") return;
  for (const [event, groups] of Object.entries(hooksCandidate as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      const hooks = (group as Record<string, unknown>).hooks;
      if (!Array.isArray(hooks)) continue;
      for (const hook of hooks) {
        if (!hook || typeof hook !== "object") continue;
        const h = hook as Record<string, unknown>;
        if (h.type === "command" && typeof h.command === "string") {
          yield { event, command: h.command };
        }
      }
    }
  }
}
