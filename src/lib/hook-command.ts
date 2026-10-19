// Single source of truth for "is this string a cc-settings-managed hook command?"
//
// Consolidated from three prior implementations that disagreed on lib/:
//   - settings-merge.ts:262-282 (accepted ~/.claude/src/)
//   - light-profile.ts:169 (accepted /.claude/src/hooks/ | /.claude/src/scripts/)
//   - audit-hooks.ts:100 (accepted scripts|hooks|lib)
//
// The canonical definition is (scripts|hooks) ONLY. lib/ files are support
// modules, not hooks — tightened to reduce the trusted surface.

import { basename } from "node:path";
import { HooksBlock } from "../schemas/hooks.ts";

// `bun [--no-env-file] "$HOME/.claude/src/<dir>/<name>.ts"` — accept quoted and unquoted
// `$HOME` and `${HOME}` forms. Allow an optional trailing arg list (some
// hooks invoke a script with positional args, e.g. `handoff.ts create`),
// but ONLY simple word-like tokens separated by [ \t] (spaces/tabs): shell
// metacharacters (`;`, `|`, `&`, `$(`, backticks, redirects) are rejected,
// and so are newlines — `\s` would treat `\n` as an arg separator while the
// shell treats it as a command separator, letting a payload on the next line
// (`bun .../x.ts\n/path/to/evilbin`) ride the shipped-pattern match.
// NOTE: [ \t] (not \s) arg-separation is a deliberate security property —
// do NOT widen to \s; that would allow newline-chained payloads to match.
// The shipped form carries --no-env-file so a project's .env cannot inject
// variables into the hook, and `--config="$HOME/.claude/src/bunfig.toml"` (a
// comment-only file we ship) so a project's bunfig.toml `preload` cannot run
// code inside it. The file sits under src/ so the install manifest hashes it.
// `--config` is as powerful as `--preload`, so only that exact path is accepted,
// and only after --no-env-file. The flagless form is what older installs wrote.
// Capture group 1 is the path relative to ~/.claude/src — the install-manifest key.
export const MANAGED_HOOK_CMD: RegExp =
  /^bun(?:[ \t]+--no-env-file(?:[ \t]+--config="?\$\{?HOME\}?\/\.claude\/src\/bunfig\.toml"?)?)?[ \t]+"?\$\{?HOME\}?\/\.claude\/src\/((?:scripts|hooks)\/[a-zA-Z0-9_-]+\.ts)"?(?:[ \t]+[A-Za-z0-9_.:=/-]+)*[ \t]*$/;

/** The runtime prefix every shipped hook command starts with. */
export const MANAGED_BUN_PREFIX = 'bun --no-env-file --config="$HOME/.claude/src/bunfig.toml" ';

// Shell-segment separator: splits a compound command on ; && || and newline
// variants including U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR.
// The \uNNNN escapes stay as explicit codepoints in the source text rather
// than invisible literal characters (encoding-safe).
// Used by audit-hooks.ts's compound-command classifier. safety-net.ts has its own
// quote-aware scanner (scanShell, below) because it must not split inside
// quotes, substitutions, or heredocs.
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

/** Result of unwrapping + schema-validating a settings-or-hooks-block input.
 *  Exported so callers that need the schema-success/failure SIGNAL (not just
 *  the traversal) — e.g. audit-hooks.ts's schema-validation pseudo-finding —
 *  can share the exact same parse `iterCommandHooks` performs, rather than
 *  hand-rolling a second call to `HooksBlock.safeParse` that could silently
 *  drift from what the iterator tolerates. */
export interface HooksParseResult {
  /** True iff `settingsOrHooks` had an own `hooks` property that was unwrapped.
   *  False means `settingsOrHooks` itself was treated as the hooks candidate
   *  (bare-hooks-block callers, or a non-object/hooks-less input). */
  hadHooksKey: boolean;
  /** The value actually validated: `settingsOrHooks.hooks` when present, else
   *  `settingsOrHooks` itself. */
  hooksCandidate: unknown;
  /** safeParse result of `hooksCandidate` against the HooksBlock schema. */
  result: ReturnType<typeof HooksBlock.safeParse>;
}

/** Unwrap the `hooks` sub-key (if the input is a full settings object) and
 *  safeParse the result against HooksBlock. Single source of truth for
 *  "what does a hooks block look like" — shared by `iterCommandHooks`
 *  (traversal) and any caller that needs the raw schema-success/failure
 *  signal instead of (or in addition to) the traversal. */
export function parseHooksBlock(settingsOrHooks: unknown): HooksParseResult {
  const isObj = !!settingsOrHooks && typeof settingsOrHooks === "object";
  const hadHooksKey = isObj && "hooks" in (settingsOrHooks as Record<string, unknown>);
  const hooksCandidate = hadHooksKey
    ? (settingsOrHooks as Record<string, unknown>).hooks
    : settingsOrHooks;
  return { hadHooksKey, hooksCandidate, result: HooksBlock.safeParse(hooksCandidate) };
}

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
): Generator<
  { event: string; groupIndex: number; hookIndex: number; command: string },
  void,
  unknown
> {
  const { hooksCandidate, result: parsed } = parseHooksBlock(settingsOrHooks);

  // --- Schema-driven path ---
  if (parsed.success) {
    for (const [event, groups] of Object.entries(parsed.data)) {
      if (!Array.isArray(groups)) continue;
      for (const [groupIndex, group] of groups.entries()) {
        for (const [hookIndex, hook] of group.hooks.entries()) {
          if (hook.type === "command") {
            yield { event, groupIndex, hookIndex, command: hook.command };
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
    for (const [groupIndex, group] of groups.entries()) {
      if (!group || typeof group !== "object") continue;
      const hooks = (group as Record<string, unknown>).hooks;
      if (!Array.isArray(hooks)) continue;
      for (const [hookIndex, hook] of hooks.entries()) {
        if (!hook || typeof hook !== "object") continue;
        const h = hook as Record<string, unknown>;
        if (h.type === "command" && typeof h.command === "string") {
          yield { event, groupIndex, hookIndex, command: h.command };
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Quote-aware view of a shell command line (used by safety-net.ts)
//
// Not a shell parser: it knows enough to split a command into simple commands
// without splitting inside quotes, `$(...)`, backticks, or heredoc bodies, to
// skip comments, to keep track of subshell scopes, and to read one simple
// command into env assignments, a command word, arguments, and redirections.
// Where it cannot tell (an unterminated quote), it says so and the caller
// treats the command as unknown.
// ---------------------------------------------------------------------------

/** Stands in for a `$(...)` or backtick substitution inside a segment. It keeps
 *  a `$` so rules that refuse unresolved expansions still see one. */
export const SUBSTITUTION = "$(SUB)";

/** Stands in for a `<(...)` / `>(...)` process substitution; the digits index
 *  into the segment's `subs`. */
export const PROCESS_SUBSTITUTION_RE = /^\$\(PSUB(\d+)\)$/;

export interface ShellSegment {
  /** The simple command text: quotes kept, substitutions replaced by
   *  SUBSTITUTION, heredoc bodies removed. Pipes (`|`) stay inside. */
  clean: string;
  /** Raw text of the `$(...)` / backtick / `<(...)` substitutions in this
   *  segment, in the order their placeholders appear. */
  subs: string[];
  /** Heredocs whose `<<WORD` marker is in this segment, with their bodies. */
  heredocs: Array<{ word: string; body: string }>;
  /** Subshell scope the segment runs in; 0 is the top level. */
  scope: number;
}

export interface ShellScan {
  /** Every simple command, substitution bodies included, in source order. */
  segments: ShellSegment[];
  /** `scopeParents[s]` is the scope that contains scope `s` (-1 for 0). */
  scopeParents: number[];
  /** A quote or substitution never closed. */
  unterminated: boolean;
}

interface Heredoc {
  word: string;
  strip: boolean;
  expand: boolean;
  owner?: ShellSegment;
}

interface Shared {
  segments: ShellSegment[];
  scopeParents: number[];
  unterminated: boolean;
}

/** Bash deletes a backslash-newline pair before it splits words. */
function joinContinuations(text: string): string {
  return text.replace(/\\\r?\n/g, "");
}

export function scanShell(cmd: string): ShellScan {
  const shared: Shared = { segments: [], scopeParents: [-1], unterminated: false };
  run(joinContinuations(cmd), shared, 0);
  return {
    segments: shared.segments,
    scopeParents: shared.scopeParents,
    unterminated: shared.unterminated,
  };
}

// Scans `cmd` into shared.segments, starting in scope `startScope`.
function run(cmd: string, shared: Shared, startScope: number): void {
  let i = 0;
  const n = cmd.length;
  let curScope = startScope;

  const enterScope = (): void => {
    shared.scopeParents.push(curScope);
    curScope = shared.scopeParents.length - 1;
  };
  const leaveScope = (): void => {
    curScope = shared.scopeParents[curScope] as number;
  };

  // Reads a `$(...)` / `<(...)` starting at its first character; returns the
  // raw inner text.
  function readSubstitution(): string {
    i += 2;
    const start = i;
    enterScope();
    const end = scan(true);
    leaveScope();
    return cmd.slice(start, end);
  }

  // Reads a backtick substitution starting at the opening backtick.
  function readBacktick(): string {
    const start = i + 1;
    let j = start;
    while (j < n && cmd[j] !== "`") j += cmd[j] === "\\" ? 2 : 1;
    if (j >= n) shared.unterminated = true;
    const inner = cmd.slice(start, Math.min(j, n)).replace(/\\`/g, "`");
    i = Math.min(j + 1, n);
    enterScope();
    run(inner, shared, curScope);
    leaveScope();
    return inner;
  }

  // `$((...))` is arithmetic, not a command.
  function skipArithmetic(): string {
    let depth = 0;
    const start = i;
    while (i < n) {
      if (cmd[i] === "(") depth++;
      else if (cmd[i] === ")" && --depth === 0) {
        i++;
        break;
      }
      i++;
    }
    return cmd.slice(start, i);
  }

  // `$'...'`: backslash escapes can include `\'`.
  function readAnsiC(): string {
    const start = i;
    i += 2;
    while (i < n && cmd[i] !== "'") i += cmd[i] === "\\" ? 2 : 1;
    if (i >= n) shared.unterminated = true;
    i = Math.min(i + 1, n);
    return cmd.slice(start, i);
  }

  // The body of an unquoted-delimiter heredoc is expanded by the shell, so a
  // `$(...)` in it runs. Scan it as the inside of a double-quoted string.
  function expansionsIn(body: string): void {
    if (!body.includes("$(") && !body.includes("`")) return;
    const quoted = `"${body.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    run(quoted, shared, curScope);
    shared.segments.pop(); // the wrapper itself, not a command
  }

  function readHeredocBodies(pending: Heredoc[]): void {
    for (const { word, strip, expand, owner } of pending) {
      let body = "";
      while (i < n) {
        let end = cmd.indexOf("\n", i);
        if (end < 0) end = n;
        const line = cmd.slice(i, end).replace(/\r$/, "");
        i = Math.min(end + 1, n);
        if ((strip ? line.replace(/^\t+/, "") : line) === word) break;
        body += `${line}\n`;
      }
      owner?.heredocs.push({ word, body });
      if (expand) expansionsIn(body);
    }
  }

  // Scans simple commands until the end of input or, when `nested`, the `)`
  // closing a `$(`. Returns the index of that `)` (or the end of input).
  function scan(nested: boolean): number {
    let cur = "";
    let subs: string[] = [];
    let depth = 0; // bare `(` groups opened in this scan
    const heredocs: Heredoc[] = [];
    const flush = (): void => {
      const clean = cur.trim();
      if (clean) {
        const seg: ShellSegment = { clean, subs, heredocs: [], scope: curScope };
        shared.segments.push(seg);
        for (const h of heredocs) h.owner ??= seg;
      }
      cur = "";
      subs = [];
    };

    while (i < n) {
      const ch = cmd[i] as string;

      if (ch === "\\") {
        cur += cmd.slice(i, i + 2);
        i += 2;
      } else if (ch === "'") {
        const end = cmd.indexOf("'", i + 1);
        if (end < 0) {
          shared.unterminated = true;
          cur += cmd.slice(i);
          i = n;
        } else {
          cur += cmd.slice(i, end + 1);
          i = end + 1;
        }
      } else if (ch === '"') {
        cur += ch;
        i++;
        let closed = false;
        while (i < n) {
          const c = cmd[i] as string;
          if (c === "\\") {
            cur += cmd.slice(i, i + 2);
            i += 2;
          } else if (c === '"') {
            cur += c;
            i++;
            closed = true;
            break;
          } else if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] === "(") {
            cur += skipArithmetic();
          } else if (c === "$" && cmd[i + 1] === "(") {
            cur += SUBSTITUTION;
            subs.push(readSubstitution());
          } else if (c === "`") {
            cur += SUBSTITUTION;
            subs.push(readBacktick());
          } else {
            cur += c;
            i++;
          }
        }
        if (!closed) shared.unterminated = true;
      } else if (ch === "$" && cmd[i + 1] === "'") {
        cur += readAnsiC();
      } else if (ch === "$" && cmd[i + 1] === "(" && cmd[i + 2] === "(") {
        cur += skipArithmetic();
      } else if (ch === "$" && cmd[i + 1] === "(") {
        cur += SUBSTITUTION;
        subs.push(readSubstitution());
      } else if ((ch === "<" || ch === ">") && cmd[i + 1] === "(") {
        cur += `$(PSUB${subs.length})`;
        subs.push(readSubstitution());
      } else if (ch === "`") {
        cur += SUBSTITUTION;
        subs.push(readBacktick());
      } else if (ch === "#" && (cur === "" || /\s$/.test(cur))) {
        // A comment runs to the end of the line.
        while (i < n && cmd[i] !== "\n" && cmd[i] !== "\r") i++;
      } else if (ch === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
        const marker = cmd
          .slice(i)
          .match(/^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|(\\?[^\s;&|()<>'"]+))/);
        if (marker) {
          const quotedWord = marker[2] ?? marker[3];
          const bareWord = marker[4] ?? "";
          heredocs.push({
            word: quotedWord ?? bareWord.replace(/^\\/, ""),
            strip: marker[1] === "-",
            expand: quotedWord === undefined && !bareWord.startsWith("\\"),
          });
          cur += marker[0];
          i += marker[0].length;
        } else {
          cur += "<<";
          i += 2;
        }
      } else if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
        flush();
        i += ch === "\r" && cmd[i + 1] === "\n" ? 2 : 1;
        if (heredocs.length > 0) readHeredocBodies(heredocs.splice(0));
      } else if (ch === ";") {
        flush();
        i++;
      } else if (ch === "&") {
        // `&&` and a lone `&` separate commands; `>&`, `<&`, `&>` do not.
        if (cmd[i + 1] === "&") {
          flush();
          i += 2;
        } else if (cmd[i - 1] === ">" || cmd[i - 1] === "<" || cmd[i + 1] === ">") {
          cur += ch;
          i++;
        } else {
          flush();
          i++;
        }
      } else if (ch === "|" && cmd[i + 1] === "|") {
        flush();
        i += 2;
      } else if (ch === "(") {
        flush();
        depth++;
        enterScope();
        i++;
      } else if (ch === ")") {
        flush();
        if (depth > 0) {
          depth--;
          leaveScope();
        } else if (nested) {
          const close = i;
          i++;
          return close;
        }
        i++;
      } else {
        cur += ch;
        i++;
      }
    }
    flush();
    while (depth-- > 0) leaveScope();
    if (nested) shared.unterminated = true;
    return n;
  }

  scan(false);
}

/** Splits one segment on unquoted `|`. */
export function splitPipes(clean: string): string[] {
  const stages: string[] = [];
  let cur = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] as string;
    if (ch === "\\") {
      cur += clean.slice(i, i + 2);
      i++;
    } else if (ch === "'" || ch === '"') {
      // In `$'...'` a backslash can escape the closing quote.
      const escapes = ch === '"' || clean[i - 1] === "$";
      let j = i + 1;
      while (j < clean.length && clean[j] !== ch) j += escapes && clean[j] === "\\" ? 2 : 1;
      cur += clean.slice(i, j + 1);
      i = j;
    } else if (ch === "|") {
      stages.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  stages.push(cur);
  return stages.map((s) => s.trim()).filter(Boolean);
}

/** Marks a redirection operator among the words (so a quoted "<" is not one). */
export const OP = "\u0000";

const ANSI_C_SIMPLE: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\u0007",
  b: "\b",
  e: "\u001b",
  E: "\u001b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?",
};

// Decodes the inside of `$'...'`.
function decodeAnsiC(body: string): string {
  return body.replace(
    /\\(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|(.))/gs,
    (_m, hex, u4, u8, oct, simple) => {
      if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
      if (u4 || u8) return String.fromCodePoint(Number.parseInt(u4 ?? u8, 16));
      if (oct) return String.fromCharCode(Number.parseInt(oct, 8));
      return ANSI_C_SIMPLE[simple] ?? simple;
    },
  );
}

/** Splits a simple command into words: quotes removed, redirection operators
 *  separated and prefixed with OP. */
export function shellWords(stage: string): string[] {
  const text = joinContinuations(stage);
  const words: string[] = [];
  let cur = "";
  let active = false; // a word is in progress (an empty quoted word counts)
  const push = (): void => {
    if (active) words.push(cur);
    cur = "";
    active = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      push();
    } else if (ch === "#" && !active) {
      break; // a comment: the rest of the line is not part of the command
    } else if (ch === "\\") {
      cur += text[i + 1] ?? "";
      active = true;
      i++;
    } else if (ch === "$" && text[i + 1] === "'") {
      let j = i + 2;
      while (j < text.length && text[j] !== "'") j += text[j] === "\\" ? 2 : 1;
      cur += decodeAnsiC(text.slice(i + 2, j));
      active = true;
      i = j;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      cur += text.slice(i + 1, end < 0 ? text.length : end);
      active = true;
      i = end < 0 ? text.length : end;
    } else if (ch === '"') {
      active = true;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && /["\\$`]/.test(text[i + 1] ?? "")) i++;
        cur += text[i] ?? "";
        i++;
      }
    } else if (ch === "<" || ch === ">") {
      // A leading fd (`2>`) or `&` (`&>`) belongs to the operator.
      const prefix = /^(?:\d+|&)$/.test(cur) ? cur : "";
      if (prefix) {
        cur = "";
        active = false;
      } else {
        push();
      }
      const op = text.slice(i).match(/^(?:<<<|<<-|<<|<>|<&|<|>>|>&|>\||>)/)?.[0] ?? ch;
      words.push(`${OP}${prefix}${op}`);
      i += op.length - 1;
    } else {
      cur += ch;
      active = true;
    }
  }
  push();
  return words;
}

export interface ParsedShellCommand {
  /** Leading `NAME=value` assignments, also through env/sudo/etc. */
  env: Record<string, string>;
  /** Basename of the command word; "" when the stage is only assignments. */
  word: string;
  args: string[];
  /** Operands of input redirections (`< file`). */
  reads: string[];
  /** Delimiter words of heredocs (`<<WORD`) attached to this command. */
  heredocWords: string[];
  /** Operands of here-strings (`<<< text`). */
  hereStrings: string[];
}

const KEYWORDS = new Set(["!", "{", "time", "then", "do", "else", "elif", "if", "while", "until"]);
// Wrapper commands and the options of theirs that take a separate value.
const WRAPPER_VALUE_FLAGS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"],
  env: ["-u", "-C", "-S"],
  command: [],
  exec: [],
  builtin: [],
  nohup: [],
  nice: ["-n"],
  ionice: ["-c", "-n", "-p"],
  stdbuf: ["-i", "-o", "-e"],
  timeout: ["-s", "-k"],
  xargs: ["-I", "-n", "-P", "-L", "-d", "-a", "-E", "-s", "-J", "-R", "-S"],
};
const ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** Reads one pipeline stage: assignments, wrappers and shell keywords in front
 *  of the command are skipped, and redirections can sit anywhere. */
export function parseShellCommand(stage: string): ParsedShellCommand {
  const words: string[] = [];
  const reads: string[] = [];
  const heredocWords: string[] = [];
  const hereStrings: string[] = [];
  const raw = shellWords(stage);
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i] as string;
    if (!w.startsWith(OP)) {
      words.push(w);
      continue;
    }
    const op = w.slice(1).replace(/^(?:\d+|&)/, "");
    const operand = raw[i + 1];
    const plain = operand !== undefined && !operand.startsWith(OP) ? operand : undefined;
    if (op === "<") {
      i++;
      if (plain !== undefined) reads.push(plain);
    } else if (op === "<<" || op === "<<-") {
      i++;
      if (plain !== undefined) heredocWords.push(plain);
    } else if (op === "<<<") {
      i++;
      if (plain !== undefined) hereStrings.push(plain);
    } else if (op !== "<>") {
      i++; // output redirection: not an argument
    }
  }

  const env: Record<string, string> = {};
  let i = 0;
  while (i < words.length) {
    const t = words[i] as string;
    if (KEYWORDS.has(t)) {
      i++;
      continue;
    }
    const assignment = t.match(ASSIGNMENT_RE);
    if (assignment) {
      env[assignment[1] as string] = assignment[2] ?? "";
      i++;
      continue;
    }
    const wrapper = basename(t);
    const valueFlags = WRAPPER_VALUE_FLAGS[wrapper];
    if (!valueFlags) break;
    i++;
    while (i < words.length && (words[i] as string).startsWith("-")) {
      const flag = words[i] as string;
      i += flag === "--" ? 1 : valueFlags.includes(flag) ? 2 : 1;
      if (flag === "--") break;
    }
    if (wrapper === "timeout") i++; // the duration
  }
  return {
    env,
    word: i < words.length ? basename(words[i] as string) : "",
    args: words.slice(i + 1),
    reads,
    heredocWords,
    hereStrings,
  };
}
