// Builder for the hook wiring tables in docs/hooks-reference.md.
//
// Rows come from config/40-hooks.json, with each `dispatch.ts <Event>` entry
// expanded into the handlers it runs (HANDLER_META in src/hooks/dispatch-handlers.ts,
// which imports nothing, so this file ships to Codex without the handlers). Each table sits
// between `<!-- BEGIN AUTOGEN:hooks <selectors> -->` and
// `<!-- END AUTOGEN:hooks <selectors> -->`, the same selectors on both, so a lost
// or edited marker fails instead of swallowing the prose up to the next one. A
// selector is `Event` (hooks with no matcher)
// or `Event:matcher` (the handler's own matcher for a dispatched handler, the
// tool names of an `if` filter for an entry that has only that), and
// `dispatcher` renders the dispatcher table. The prose between regions is hand
// written. src/scripts/gen-hooks-doc.ts writes the doc; tests/docs-hooks.test.ts
// asserts freshness.

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type DispatchEvent, HANDLER_META, type HandlerMeta } from "../hooks/dispatch-handlers.ts";
import { flattenHooks, type HookEntry } from "./hook-frequency.ts";

const begin = (spec: string) => `<!-- BEGIN AUTOGEN:hooks ${spec} -->`;
const end = (spec: string) => `<!-- END AUTOGEN:hooks ${spec} -->`;
const MARKER = /<!-- (BEGIN|END) AUTOGEN:hooks(?: (.*?))? -->/g;

interface Region {
  spec: string;
  /** Offset just past the BEGIN marker. */
  from: number;
  /** Offset of the END marker. */
  to: number;
}

/** The marked regions of `doc`, or the reasons its markers do not pair up. */
function findRegions(doc: string): { regions: Region[]; problems: string[] } {
  const regions: Region[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let open: { spec: string; from: number; line: number } | undefined;
  const lineAt = (offset: number) => doc.slice(0, offset).split("\n").length;
  for (const m of doc.matchAll(MARKER)) {
    const spec = (m[2] ?? "").trim();
    const at = m.index;
    const line = lineAt(at);
    if (spec === "") {
      problems.push(`line ${line}: ${m[1]} marker names no selectors`);
    } else if (m[1] === "BEGIN") {
      if (open)
        problems.push(`line ${line}: BEGIN "${spec}" inside "${open.spec}" (line ${open.line})`);
      else if (seen.has(spec)) problems.push(`line ${line}: a second region "${spec}"`);
      else open = { spec, from: at + m[0].length, line };
      seen.add(spec);
    } else if (!open) {
      problems.push(`line ${line}: END "${spec}" with no open region`);
    } else if (spec !== open.spec) {
      problems.push(`line ${line}: END "${spec}" closes "${open.spec}" (line ${open.line})`);
      open = undefined;
    } else {
      regions.push({ spec, from: open.from, to: at });
      open = undefined;
    }
  }
  if (open) problems.push(`line ${open.line}: region "${open.spec}" has no END marker`);
  return { regions, problems };
}

export interface HookRow {
  event: string;
  matcher: string | null;
  /** Script basename plus any trailing argument, e.g. "swarm-log start". */
  id: string;
  async: boolean;
}

export function loadHookConfig(repoRoot: string): HookEntry[] {
  const path = resolve(repoRoot, "config", "40-hooks.json");
  return flattenHooks(JSON.parse(readFileSync(path, "utf8")));
}

const isDispatch = (e: HookEntry) => e.id === "dispatch" || e.id.startsWith("dispatch ");

function filterTools(filter: string | null): string | null {
  if (filter === null) return null;
  const tools = [...new Set([...filter.matchAll(/(\w+)\(/g)].map((m) => m[1]))];
  return tools.length > 0 ? tools.join("|") : null;
}

function handlersOf(event: string): readonly HandlerMeta[] {
  if (!Object.hasOwn(HANDLER_META, event)) {
    throw new Error(`config wires dispatch.ts for ${event}, which has no HANDLER_META entry`);
  }
  return HANDLER_META[event as DispatchEvent];
}

/** One row per hook that runs: config entries in file order, each event's
 *  dispatcher expanded once into its handlers. */
export function hookRows(entries: readonly HookEntry[]): HookRow[] {
  const rows: HookRow[] = [];
  const expanded = new Set<string>();
  for (const e of entries) {
    if (!isDispatch(e)) {
      const matcher = e.matcher ?? filterTools(e.filter);
      rows.push({ event: e.event, matcher, id: e.id, async: e.async });
      continue;
    }
    if (expanded.has(e.event)) continue;
    expanded.add(e.event);
    for (const h of handlersOf(e.event)) {
      rows.push({ event: e.event, matcher: h.matcher ?? null, id: h.name, async: false });
    }
  }
  return rows;
}

const selectorOf = (r: HookRow) => (r.matcher === null ? r.event : `${r.event}:${r.matcher}`);
const keyOf = (r: HookRow) => `${r.event} ${r.id}`;
const cell = (s: string) => s.replaceAll("|", "\\|");
const code = (s: string) => `\`${cell(s)}\``;

function listJoin(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function hookTable(rows: HookRow[], descriptions: Record<string, string>): string {
  const lines = ["| Script | Purpose | Async |", "|--------|---------|-------|"];
  for (const r of rows) {
    const script = r.id.replace(/^[\w-]+/, (name) => `${name}.ts`);
    const purpose = descriptions[keyOf(r)] ?? "";
    lines.push(`| \`${script}\` | ${purpose} | ${r.async ? "Yes" : "No"} |`);
  }
  return lines.join("\n");
}

function dispatcherTable(entries: readonly HookEntry[]): string {
  const lines = [
    "| Event | Entry matcher | Entry timeout | Handlers, in order (each handler's own matcher) |",
    "|-------|---------------|---------------|--------------------------------------------------|",
  ];
  const events = [...new Set(entries.filter(isDispatch).map((e) => e.event))];
  for (const event of events) {
    const own = entries.filter((e) => isDispatch(e) && e.event === event);
    const matchers = own.map((e) => (e.matcher === null ? "none" : code(e.matcher)));
    const matcherCell =
      own.length > 1 ? `${listJoin(matchers)} (${own.length} entries, one command)` : matchers[0];
    const timeouts = [...new Set(own.map((e) => e.timeout))];
    let timeoutCell =
      timeouts.length === 1
        ? timeouts[0] === null
          ? "none (the default)"
          : `${timeouts[0]} s${own.length > 1 ? " each" : ""}`
        : own
            .map(
              (e) => `${e.timeout === null ? "none" : `${e.timeout} s`} on ${e.matcher ?? "none"}`,
            )
            .map(cell)
            .join(", ");
    const blocking = own.filter((e) => e.onFailure !== null);
    if (blocking.length > 0) {
      const which = blocking.map((e) => e.matcher ?? "none").join(", ");
      const failure = [...new Set(blocking.map((e) => e.onFailure))].join(", ");
      timeoutCell += `; \`onFailure: "${failure}"\``;
      if (blocking.length < own.length) timeoutCell += ` on the ${cell(which)} entry only`;
    }
    const handlers = handlersOf(event)
      .map((h) => `\`${h.name}\`${h.matcher ? ` (${cell(h.matcher)})` : ""}`)
      .join(", ");
    lines.push(`| \`${event}\` | ${matcherCell} | ${timeoutCell} | ${handlers} |`);
  }
  return lines.join("\n");
}

export interface RenderResult {
  text: string;
  /** Wiring the doc cannot show as configured; any entry fails the check. */
  problems: string[];
}

/** Regenerate every AUTOGEN:hooks region of `doc` from the config entries. When
 *  the markers do not pair up, `text` is `doc` unchanged. */
export function renderHooksDoc(
  doc: string,
  entries: readonly HookEntry[],
  descriptions: Record<string, string> = HOOK_DESCRIPTIONS,
): RenderResult {
  const { regions, problems } = findRegions(doc);
  if (problems.length > 0) return { text: doc, problems };
  const rows = hookRows(entries);
  const dispatcherRegions = regions.filter((r) => r.spec === "dispatcher").length;
  if (entries.some(isDispatch) && dispatcherRegions !== 1) {
    problems.push(
      `the config routes hooks through dispatch.ts, so the doc needs exactly one "dispatcher" region; found ${dispatcherRegions}`,
    );
  }
  const placed = new Map<string, string>();
  let text = "";
  let last = 0;
  for (const { spec, from, to } of regions) {
    const selectors = spec.split(/\s+/);
    let table: string;
    if (selectors.length === 1 && selectors[0] === "dispatcher") {
      table = dispatcherTable(entries);
    } else {
      const chosen = rows.filter((r) => selectors.includes(selectorOf(r)));
      for (const s of selectors) {
        if (!chosen.some((r) => selectorOf(r) === s)) {
          problems.push(`region "${spec}": selector ${s} matches no wired hook`);
        }
      }
      for (const r of chosen) {
        const prior = placed.get(keyOf(r));
        if (prior !== undefined)
          problems.push(`${keyOf(r)} is in two regions: "${prior}" and "${spec}"`);
        placed.set(keyOf(r), spec);
      }
      table = hookTable(chosen, descriptions);
    }
    text += `${doc.slice(last, from)}\n\n${table}\n\n`;
    last = to;
  }
  text += doc.slice(last);
  for (const r of rows) {
    if (!placed.has(keyOf(r))) {
      const s = selectorOf(r);
      problems.push(
        `${keyOf(r)} (selector ${s}) is in no region; add \`${begin(s)}\` … \`${end(s)}\``,
      );
    }
    if (!descriptions[keyOf(r)]) {
      problems.push(`${keyOf(r)} has no description in HOOK_DESCRIPTIONS (src/lib/hooks-doc.ts)`);
    }
  }
  const wired = new Set(rows.map(keyOf));
  for (const key of Object.keys(descriptions)) {
    if (!wired.has(key)) problems.push(`HOOK_DESCRIPTIONS["${key}"] names no wired hook`);
  }
  return { text, problems };
}

export interface DocUpdate {
  problems: string[];
  /** The file differs from what the config renders. */
  stale: boolean;
  wrote: boolean;
}

/** Render `docPath` and, unless `check` is set, write it back. Every check runs
 *  first: with any problem the file is left byte for byte as it was. */
export async function updateHooksDoc(
  docPath: string,
  entries: readonly HookEntry[],
  opts: { check: boolean; extraProblems?: readonly string[] },
): Promise<DocUpdate> {
  const original = await readFile(docPath, "utf8");
  const { text, problems } = renderHooksDoc(original, entries);
  problems.push(...(opts.extraProblems ?? []));
  const stale = text !== original;
  const wrote = !opts.check && stale && problems.length === 0;
  if (wrote) await writeFile(docPath, text, "utf8");
  return { problems, stale, wrote };
}

// Purpose column, keyed by "<event> <id>". A table cell: escape `|` as `\|`.
export const HOOK_DESCRIPTIONS: Record<string, string> = {
  "SessionStart verify-hooks":
    "Validates the hooks-block fingerprint on session start; warns on tampering",
  "SessionStart session-start":
    "Surfaces auto-memory pointer, auto-warms TLDR index, and prints one `Git push:` line for a GitHub origin: SSH when an agent has a key loaded, the gh login (git over HTTPS with gh's token) otherwise, or a request to log in. It reads exit codes of `ssh-add -l` and `gh auth token` only, never a credential, and mentions 1Password only on macOS when its agent socket exists. `bun ~/.claude/src/scripts/git-transport.ts` prints the same line for the current directory.",
  "SessionStart codex-verify":
    "Cheap Codex CLI availability check (`codex login status`) for the statusline badge; persists the verdict to `~/.claude/tmp/codex-verdict.json`. Silent on success and error, fail-open",
  "SessionStart cache-cold":
    "Warns the user on a resume or fork: when Claude Code marks the resume `prompt_cache_likely_expired` with `context_tokens` of at least 100K, it shows the user the idle gap (`seconds_since_last_response`), the size and Claude Code's `estimated_cache_write_usd` before the first message, and leaves a marker in `~/.claude/tmp` (`cache-cold-resume-<sha256>.flag`, pruned after 7 days) so the first prompt does not warn about the same gap again. Never blocks. Fail-open",
  "UserPromptSubmit cache-cold":
    'Warns the user, before the message goes out, when the prompt cache has expired and the context is at least 100K tokens (`COLD_RESEND_MIN_TOKENS`), so the message re-sends the whole context uncached. The payload carries no cache state, so it reads the last 4 MiB of `transcript_path` and takes the newest main-thread assistant entry: its timestamp is the last cache use, `input + cache_read + cache_creation` tokens its context size. The TTL is 1 hour, or 5 minutes when that request wrote only 5-minute cache entries. The warning gives the idle gap, the size, an API-list-price estimate of the cache write from `src/lib/token-usage.ts` (tokens only for an unpriced model) and a pointer to `/handoff` then `/clear`. It goes to the user as `systemMessage` (Claude Code 2.1.306 output schema: "Warning message shown to the user"); the model does not see it. Fires once per cold gap: the warned message writes the cache again, so the next prompt finds a fresh entry. Silent on slash commands (hooks run before `/clear` or `/handoff` expand), after a compaction newer than the last usage, and when the transcript is missing or its last assistant entry is outside the window. Never blocks. Fail-open',
  "UserPromptSubmit delegation-detector":
    'Flags prompts that look like multi-file work before the model plans. With `TYPESAFE_API_KEY` set (settings `env` block or shell) and the project opted in with `CC_TYPESAFE_PROJECT=1`, it sends the prompt to TypeSafe\'s Jev model with one statement ("this would touch 3+ files, need 12+ tool calls, or run several workstreams") and fires when the probability is ≥ 0.7; the prompt text leaves the machine for that call (2 s timeout, p50 ~320 ms measured, ~$0.00002 per prompt). Without a key, without the opt-in, or on any failure or timeout, the pre-15.23.0 regex score decides (breadth phrases, path-shaped tokens, list items; fires at ≥ 2). Either way it injects `additionalContext` naming the signal and deferring to the delegation rule in CLAUDE.md. Measured on 1,102 real prompts: regex 21 fires / 10 correct; Jev at 0.7 83 fires / 53 correct.',
  "UserPromptSubmit quota-steer":
    "Reads the statusline's cached rate-limit percentages; injects quota-aware model-routing guidance (Codex bridge / Sonnet downshift) once usage crosses elevated/critical/exhausted thresholds; at exhausted (≥95%) it re-injects every prompt and directs a full funnel to Codex plus a user-facing notice. Fail-open",
  "UserPromptSubmit escalate-model":
    "Suggests escalating to a Fable-model subagent when the same problem signature repeats `CC_ESCALATE_THRESHOLD`+ times. Quota-gated, fail-open",
  "PreModelSwitch model-switch-guard":
    "Reads the same cached rate-limit percentages as `quota-steer.ts` at the moment of a switch to a fable/mythos model. At ≥95% (5h or weekly) it asks for confirmation, naming the percentage — Fable draws the weekly pool at ~2x the Opus rate and is capped at 50% of it. At the critical band below that it allows the switch and annotates it with a scoping reminder. Below critical it stays silent. Never denies the switch. Fail-open",
  "PreToolUse safety-net":
    "Blocks destructive shell commands (rm -rf /, force push, etc.), content reads of secret files (`~/.ssh`, `~/.aws`, `.env`, ...), git hook skips (`--no-verify`, `HUSKY=0`, `-c core.hooksPath`), and `gh` writes outside `darkroomengineering` and the user's own account. An update of `main` or `master` returns `permissionDecision: \"ask\"`, so the user approves it in the permission prompt; a block elsewhere in the command wins. Updates are `git push` (an explicit refspec, including `heads/main` and wildcards such as `refs/*`, `--all`, `--mirror`, or a bare push, `origin` or `HEAD` whose target, read from the current branch and the push settings in git config, is main or master), `git subtree push`, `git send-pack`, and `gh api` writes to the branch (its ref, `branches/main/...`, a merge into it, a contents commit to it; any of repeated fields, and `-X=`/`-f=` spellings). It also asks when it cannot read where a push goes: a variable not assigned earlier on the line, a command substitution, `xargs` input, a checkout or switch it cannot read, or an earlier `git worktree` or `git clone`, a repository it cannot read (`git -C`/`env -C`/`cd` to an unreadable or not-yet-existing directory, `--git-dir`, `--work-tree`, `GIT_DIR`, `GIT_WORK_TREE`), or push routing set by `-c`, `--config-env` or `GIT_CONFIG_*` on any push; and for `--recurse-submodules=on-demand`. A forced update of main or master (`--force`, `--force-with-lease`, a `+` refspec, `gh api` with `force=true`) blocks. A push to a remote on the local disk (a path or `file://` URL) is not checked, unless git config could not be read or the command line or environment sets a URL rewrite. The rule reads HEAD from disk (asking git, with a 1 s limit, for a reftable or bare repository, `GIT_DIR` in the hook's environment, or a `.git` or HEAD that is not a small regular file) and makes at most one git config call per directory, only for a push. SECURITY.md lists the known limits. Deletes are not checked: GitHub org rulesets already block deleting and force-pushing main on org repos. An unexpected internal error exits 1 and blocks when it runs alone; the dispatcher blocks with the same reason",
  "PreToolUse visual-proof":
    'Blocks (reason prefixed `[Visual Proof]`, exit 2) `gh pr create`, and `gh pr edit` with `--body`/`-b` or `--body-file`/`-F`, when the branch changes a design file (`.css`, `.scss`, `.sass`, `.less`, `.html`, `.vue`, `.svelte`, `.astro`, `.tsx`, `.jsx`) and the body has no proof. Proof is a markdown image or `<img>` tag with an absolute URL hosted anywhere but `raw.githubusercontent.com` (those URLs 404 until the branch is merged), or the "Screenshots: before/after needed" line from `rules/git.md`, in any case, bold or list item. Changed files come from `git diff --name-only <base>...HEAD` in the payload `cwd` (or the directory a literal `cd` earlier in the command moved to); `--base X`/`-B X` is tried as `origin/X`, then `X`, and without it the base is `origin/HEAD`, then `origin/main`. The body is checked before git runs, and git gets 1 s per call. Not checked: bodies from `--fill`, `--fill-first`, `--web`, the editor, stdin (`-F -`), variables or `$(...)`; a `--body-file` it cannot read; a `gh pr edit` that names a PR by number, URL or branch (the local diff says nothing about that PR); `--head` (the diff always ends at the local `HEAD`). A `.tsx`/`.jsx` change that only touches tests or logic still counts as a design change. Blocks rather than asks, since the agent fixes it by editing the body. Fail-open on any error or git failure',
  "PreToolUse config-guard":
    'Asks for approval (`permissionDecision: "ask"`, reason prefixed `[Config Guard]`) before a shell command writes `.mcp.json` or anything under a `.claude-plugin` directory in a way a permission rule cannot match: an output redirect (`>`, `>>`, `>\\|`, `&>`, `<>`, `>&` onto a file), `tee`, or `sed -i`/`--in-place`/`perl -i`. Substitution bodies (`$(...)`) are checked too. Edit/Write, `cp`/`mv`/`ln`, `claude mcp add`/`add-json`/`add-from-claude-desktop`/`remove` and `claude plugin install`/`marketplace add` are `ask` rules in `config/30-permissions.json`, not this hook. Not seen: paths built from variables, `dd of=`, `rsync`, `install`, writes from inside a script. Asks rather than blocks, since setting up an MCP server or plugin is legitimate. Fail-open',
  "PreToolUse linear-gate":
    "Blocks (reason prefixed `[Linear Gate]`, exit 2) `gh pr create`/`gh pr new`, and `gh pr edit` with `--title`/`-t`, when the repo maps to a Linear team and no `<TEAM>-<number>` of a known team appears in the title, `--body`/`-b`, the `--body-file`/`-F` contents, or the branch (`--head`/`-H`, else the current branch). The repo is `--repo`/`-R`, else the payload `cwd`'s `origin`. The mapping is read like the land skill's \"Linear issue\" step: `~/.claude/linear-teams.json` first, then the `~/.claude/tmp/linear-map.json` cache. Passes: unmapped repos, repos mapped to `null`, a map cache older than a week, and any command with `CC_SKIP_LINEAR=1` in front (for when Linear is unreachable). An ID passes when its key is the mapped team or any other team the teams file or the map names, so a `darkroom-os` PR for a `DR-` issue passes while `UTF-8` or `GPT-6` never counts as an ID; an issue of a team no repo maps to is blocked. `--fill` without an ID blocks. A `git commit` (past git's global options) on a branch that names no issue of a known team gets a reminder through `additionalContext` to spawn `linear` with `start`; it never blocks, and `main`, `master` and a detached HEAD are skipped. Fail-open",
  "PreToolUse check-docs-before-install": "Reminds to fetch docs before installing new packages",
  "PreToolUse pre-edit-validate":
    "Validates edit strategy (file recently read, edit size appropriate)",
  "PreToolUse freeze-guard":
    "When the current session's `/freeze` boundary is active, blocks Edit/Write calls targeting any file outside the locked directory. Session records are independent; legacy untagged state remains a fallback",
  "PreToolUse test-protect":
    'Asks for approval (`permissionDecision: "ask"`, reason prefixed `[Test Guard]`) before a call disables or deletes a test: an Edit that adds a skip marker (`.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(`, `xtest(`, `describe.skip`, `it.skip`, `test.skip`, `@Disabled`, `t.Skip(`, `@pytest.mark.skip`, `pytest.skip(`) to a test file, a Write that leaves an existing test file with more of them, `rm`/`unlink`/`git rm` of a test file or test directory, `find … -delete` or `-exec rm` over a test directory or test-name filter, or `mv`/`git mv` of one to a name no runner picks up (`.bak`, `.disabled`, dropped `.test.`, out of a test directory or out of the project). It does not see an edit that deletes assertions without adding a marker, nor deletes through `xargs`, `cd … &&`, or paths built from variables. A test file is `*.test.*`, `*.spec.*`, `*_test.go`, `*_test.py`, `test_*.py`, or anything under `__tests__/`, `tests/`, `test/` or `e2e/`. Asks rather than blocks, since deleting the tests of removed code is legitimate. A Write that creates a new test file passes silently. Fail-open',
  "PreToolUse knowledge-hint":
    "Surfaces up to 3 team-knowledge notes whose slug/tags match the Bash command or edited file, once per note per session; reads the 6h index cache, never the network",
  "PreToolUse spawn-cap":
    "Counts the Agent tool calls of each session and asks for approval (`permissionDecision: \"ask\"`, reason prefixed `[Spawn Cap]`) at the 30th, then every 15th after it (45, 60, …). Never blocks, since Workflows and ultracode legitimately start dozens of agents. Agents started by a Workflow script do not go through the Agent tool, so they are not counted. Each call appends one token line to `~/.claude/tmp/spawn-count-<sha256 of session id>.log` and takes its token's position as its count, so Agent calls sent in parallel each get a distinct count; a session's first spawn deletes such files older than 7 days. A payload without a session id is not counted. Fail-open",
  "PostToolUse post-edit": "Auto-formats edited files with Biome",
  "PostToolUse post-edit-tsc": "Runs TypeScript type check on edited files",
  "PostToolUse promote-memory":
    "Nudges (once per file) when a team-relevant auto-memory file is written under `.../memory/`, for `project`/`feedback` memory types",
  "PostToolUse escalate-acted":
    'Records that a model-escalation suggestion was acted on — the "acted" half of the `escalate-model.ts`/`delegation-detector.ts` fired-vs-acted telemetry pair',
  "PostToolUse log-bash": "Logs every Bash command to `~/.claude/logs/bash-YYYY-MM-DD.log`",
  "PostToolUse tool-cadence":
    "Tracks reviewable Agent spawns since the last successful commit or push, reconciles when HEAD changes, and nudges at `CC_MAX_UNREVIEWED`. State lives at `~/.claude/tmp/review-queue.json`. Delegation thresholds are instructions in CLAUDE-FULL.md.",
  "PostToolUse session-worktrees":
    "Records each worktree an `EnterWorktree` call or an isolated `Agent`/`Task` spawn creates, read from the structured `tool_response.worktreePath`, so the SessionEnd cleanup below knows which worktrees this session made",
  "PostToolBatch ledger-record":
    "Appends the file paths a batch read/changed to the session ledger at `~/.claude/tmp/session-ledger/<session_id>.jsonl`. Metadata only — never file contents. Silent, no stdout",
  "PostToolUseFailure post-failure":
    "Logs tool failures, keeps the per-tool and per-signature tallies that `escalate-model.ts` reads, and records the exact tool + bounded/redacted error in the session ledger. Injects nothing itself.",
  "PreCompact handoff create --from-hook":
    "Saves task state before compaction. `--from-hook` reads the hook payload from stdin for `session_id` + `trigger`, which is what lets PostCompact find this exact handoff afterwards",
  "PostCompact post-compact":
    "Persists the native `compact_summary` into the handoff the preceding PreCompact wrote (matched on `sessionId`)",
  "WorktreeCreate worktree-cow create":
    'Creates the worktree for `claude -w`, `EnterWorktree` and Agent `isolation: "worktree"` with `git cow add`, a copy-on-write clone of a spare checkout, so `node_modules` and build output are already there. Timeout 180 s',
  "WorktreeRemove worktree-cow remove":
    "Removes a worktree Claude Code is discarding with `git cow remove --warm --force`, which first hands its build output to the spare checkout. Timeout 60 s",
  "Stop ask-gate":
    "Blocks a turn that ends in a prose question with no `AskUserQuestion` call; tells Claude to ask through the tool",
  "SubagentStart swarm-log start":
    "Logs a subagent spawn with its agent type and ID to `~/.claude/swarm.log`",
  "SubagentStop swarm-log stop":
    "Logs a subagent stop with its agent type and ID to `~/.claude/swarm.log`",
  "TaskCreated swarm-log task": "Logs a task creation with its subject to `~/.claude/swarm.log`",
  "TaskCompleted swarm-log complete":
    "Logs a task completion with its subject to `~/.claude/swarm.log`",
  "Notification notify": "Sends desktop notification (macOS/Linux) when tasks complete",
  "SessionEnd handoff create --from-hook": "Saves final handoff state at session end",
  "SessionEnd session-worktrees":
    "Rechecks the recorded roots and calls Programa once to remove only eligible worktrees created in this session. Deletes the session record even when cleanup is skipped or fails",
};
