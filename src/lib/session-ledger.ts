// Session artifact ledger — a bounded, append-only record of what a session
// actually touched, so a handoff can report observed artifacts instead of
// inferring them from `git status` (which forgets everything already committed).
//
// Scope discipline, in priority order over convenience:
//   * Only metadata. Paths, tool names, and error strings — never file
//     contents, prompts, transcripts, or tool responses. PostToolBatch hands us
//     `tool_response` with the full body of every file read; we deliberately
//     drop it on the floor.
//   * Only observations. Nothing here is inferred. A Bash call's success is NOT
//     recorded, because the batch payload carries no reliable exit code for it
//     — unknown stays unknown rather than becoming a confident wrong answer.
//   * Bounded. Caps on entries, on error length, and on the file itself, so a
//     marathon session can't grow this without limit.
//
// Paths are stored ABSOLUTE and normalized to project-relative only at
// aggregation time (see toProjectRelative). Storing them pre-relativized would
// have to pick a root on the hot path, and the hook's `cwd` is not always the
// repo root — a session working in a subdirectory would then emit paths that
// could never be unioned with `git status` output, which is always
// repo-root-relative. Deferring the decision to the reader, which knows the git
// toplevel, keeps the two sources comparable.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { claudePath } from "./platform.ts";
import { redactSecrets } from "./redact.ts";

export const LEDGER_DIR = claudePath("tmp", "session-ledger");

/** Bounded-set sizes for an aggregated digest. Reads and changes are capped
 *  separately so a read-heavy session can't crowd out the (rarer, more
 *  valuable) record of what it changed. */
export const MAX_READS = 50;
export const MAX_CHANGES = 50;
export const MAX_FAILURES = 20;

/** Per-error cap. Matches post-failure.ts's existing 200-char bound so the two
 *  failure records can't disagree about how much of an error they kept. */
export const MAX_ERROR_CHARS = 200;

/** Hard ceiling on a single session's JSONL. On crossing it the file is
 *  rewritten keeping the newest LEDGER_TRIM_TO lines — the digest only ever
 *  surfaces bounded recent sets, so older lines have no reader. */
export const LEDGER_MAX_LINES = 4000;
export const LEDGER_TRIM_TO = 2000;

/** Tools whose invocation means "this file was modified". NotebookEdit carries
 *  its path as `notebook_path`, every other one as `file_path`. */
const CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read"]);

// `id` is the tool_use_id both PostToolBatch and PostToolUseFailure carry for
// the same call. It is the ONLY reliable way to tell a failed call apart from a
// successful one: PostToolBatch includes failed calls in its batch, and a
// failed Read's `tool_response` is a plain string exactly like a successful
// one's, so nothing about its shape distinguishes them. Correlating ids at
// aggregation time drops the failed call exactly, without inspecting response
// content and without guessing.
export type LedgerEntry =
  | { t: string; kind: "read"; path: string; tool: string; id?: string; cwd?: string }
  | { t: string; kind: "change"; path: string; tool: string; id?: string; cwd?: string }
  | { t: string; kind: "failure"; tool: string; error: string; id?: string; cwd?: string };

export interface LedgerDigest {
  reads: string[];
  changes: string[];
  failures: { t: string; tool: string; error: string }[];
}

export const EMPTY_DIGEST: LedgerDigest = { reads: [], changes: [], failures: [] };

/** A session id is used verbatim as a filename, so anything that could escape
 *  the ledger directory or collide across sessions is rejected outright rather
 *  than sanitized into a different session's file. */
export function isSafeSessionId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(id) && !id.startsWith(".");
}

export function ledgerPath(sessionId: string, dir: string = LEDGER_DIR): string {
  return join(dir, `${sessionId}.jsonl`);
}

/** Pull the file path a tool call operated on. Returns null for tool shapes we
 *  don't track — including Bash, whose "path" would be a guess. */
export function pathFromToolInput(toolName: string, toolInput: unknown): string | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const input = toolInput as Record<string, unknown>;
  const raw = toolName === "NotebookEdit" ? input.notebook_path : input.file_path;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw;
}

/** Map one tool call to a ledger entry, or null if it isn't an artifact event.
 *  Never reads `tool_response` — that field carries file contents. */
export function entryForToolCall(
  call: { tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown },
  now: string,
  cwd?: string,
): LedgerEntry | null {
  const toolName = typeof call.tool_name === "string" ? call.tool_name : "";
  if (!toolName) return null;
  const kind = CHANGE_TOOLS.has(toolName) ? "change" : READ_TOOLS.has(toolName) ? "read" : null;
  if (!kind) return null;
  const path = pathFromToolInput(toolName, call.tool_input);
  if (!path) return null;
  const abs = isAbsolute(path) ? path : cwd ? resolve(cwd, path) : path;
  const id = typeof call.tool_use_id === "string" ? call.tool_use_id : undefined;
  return {
    t: now,
    kind,
    path: redactSecrets(abs),
    tool: toolName,
    ...(id ? { id } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

/** Append entries for one tool batch. Fail-open: a missing/unsafe session id,
 *  an unwritable ledger dir, or any IO error is swallowed — a hook must never
 *  break the session it is observing. */
export async function appendEntries(
  sessionId: unknown,
  entries: LedgerEntry[],
  dir: string = LEDGER_DIR,
): Promise<void> {
  if (!isSafeSessionId(sessionId) || entries.length === 0) return;
  try {
    await mkdir(dir, { recursive: true });
    const file = ledgerPath(sessionId, dir);
    await appendFile(file, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
    await trimLedger(file);
  } catch {
    // Fail open.
  }
}

/** Rewrite the ledger to its newest LEDGER_TRIM_TO lines once it crosses
 *  LEDGER_MAX_LINES. Best-effort: if anything fails the oversized file is left
 *  alone, which still reads correctly — it is only ever bigger than needed. */
async function trimLedger(file: string): Promise<void> {
  try {
    const text = await readFile(file, "utf8");
    const lines = text.split("\n").filter(Boolean);
    if (lines.length <= LEDGER_MAX_LINES) return;
    await writeFile(file, `${lines.slice(-LEDGER_TRIM_TO).join("\n")}\n`);
  } catch {
    // Fail open.
  }
}

/** Keep the newest `max` items of a deduped sequence, preserving last-seen
 *  order. Dedupe is last-wins so a file touched repeatedly sorts by its most
 *  recent touch, which is what a "what was I working on" digest wants. */
function boundedUnique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = values.length - 1; i >= 0 && out.length < max; i--) {
    const v = values[i];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.reverse();
}

/** Read and aggregate one session's ledger into bounded, deduped sets.
 *  Corrupt lines are skipped individually — a single truncated write (the
 *  realistic failure, from a killed process mid-append) must not discard the
 *  session's whole artifact trail. Returns an empty digest on any read error. */
export async function readDigest(
  sessionId: unknown,
  dir: string = LEDGER_DIR,
): Promise<LedgerDigest> {
  if (!isSafeSessionId(sessionId)) return EMPTY_DIGEST;
  let text: string;
  try {
    text = await readFile(ledgerPath(sessionId, dir), "utf8");
  } catch {
    return EMPTY_DIGEST;
  }
  const entries: LedgerEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) continue;
      entries.push(parsed as LedgerEntry);
    } catch {}
  }

  // Calls that failed are recorded by PostToolUseFailure AND included in the
  // PostToolBatch sweep. Collect the failed ids first so the batch's optimistic
  // read/change entry for the same call can be dropped — a Read that errored is
  // not a file that was read.
  const failedIds = new Set<string>();
  for (const e of entries) {
    if (e.kind === "failure" && typeof e.id === "string") failedIds.add(e.id);
  }

  const reads: string[] = [];
  const changes: string[] = [];
  const failures: { t: string; tool: string; error: string }[] = [];
  for (const entry of entries) {
    if (entry.kind === "failure" && typeof entry.tool === "string") {
      failures.push({
        t: typeof entry.t === "string" ? entry.t : "",
        tool: entry.tool,
        error: typeof entry.error === "string" ? entry.error : "",
      });
      continue;
    }
    if (typeof entry.id === "string" && failedIds.has(entry.id)) continue;
    if (entry.kind === "read" && typeof entry.path === "string") reads.push(entry.path);
    else if (entry.kind === "change" && typeof entry.path === "string") changes.push(entry.path);
  }
  return {
    reads: boundedUnique(reads, MAX_READS),
    changes: boundedUnique(changes, MAX_CHANGES),
    failures: failures.slice(-MAX_FAILURES),
  };
}

/** Render absolute ledger paths as project-relative where they genuinely live
 *  under `root`. A path outside the project stays absolute rather than becoming
 *  a `../../..` string that no reader can match against git output.
 *
 *  Separators are normalized to `/` because the consumer is git output, and git
 *  emits forward slashes on every platform. `node:path.relative` returns `\` on
 *  Windows, so without this a Windows handoff listed `src\a.ts` while `git
 *  status` listed `src/a.ts` — the two never deduped against each other. No-op
 *  on POSIX, where `relative` already returns `/`. */
export function toProjectRelative(paths: string[], root: string): string[] {
  if (!root) return paths;
  return paths.map((p) => {
    if (!isAbsolute(p)) return p;
    const rel = relative(root, p);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return p;
    return rel.replaceAll("\\", "/");
  });
}

/** Build a failure entry with the error bounded and redacted. `toolUseId` is
 *  what lets readDigest drop the optimistic read/change entry PostToolBatch
 *  recorded for this same call. */
export function failureEntry(
  tool: string,
  error: string,
  now: string,
  cwd?: string,
  toolUseId?: string,
): LedgerEntry {
  const clean = redactSecrets(error).replace(/\s+/g, " ").trim();
  const bounded = clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean;
  return {
    t: now,
    kind: "failure",
    tool,
    error: bounded,
    ...(toolUseId ? { id: toolUseId } : {}),
    ...(cwd ? { cwd } : {}),
  };
}
