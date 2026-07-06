// Bridge to the OpenAI Codex CLI (`codex exec`), the execution/verification
// half of the Codex×Claude pairing. All logic lives here; the thin consumers are
//   - src/hooks/codex-verify.ts  (SessionStart: cheap availability → statusline badge)
//   - src/scripts/codex-run.ts   (the /codex skill's CLI: exec / review / ask)
//
// Detection ladder (cheap → definitive):
//   L0  `codex` on PATH?                      — hasCommand, free
//   L1  `codex login status` exit 0?          — reads cached creds, no model call
//   L2  a real `codex exec` succeeds?         — the first real call IS the probe;
//                                               its failure is classified + cached
// There is no OpenAI endpoint for "does this account have Codex" — entitlement and
// quota are only observable by attempting a call, so L2 is call-based by necessity.

import { z } from "zod";
import { readState, writeState } from "./hook-runtime.ts";
import { hasCommand } from "./platform.ts";

const VERDICT_FILE = "codex-verdict.json";

// `codex login status` only reads cached creds, but it runs in the preflight that
// gates every /codex call — ahead of the bounded exec path — so a hung CLI here
// would stall the whole bridge. Cap it; a timeout fails open as unauthenticated.
const LOGIN_STATUS_TIMEOUT_MS = 5000;

// A sticky negative is re-confirmed after this long, in case the user fixes it.
const NO_ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // entitlement: re-check daily
const RATE_LIMIT_TTL_MS = 5 * 60 * 60 * 1000; // Codex meters per ~5-hour window
const DEFAULT_EXEC_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_EXEC_TIMEOUT_MS = 15 * 60 * 1000; // hard cap so a hung call can't run unbounded
// Skip the up-to-5s `codex login status` spawn when a recent "available" verdict
// is still fresh. 60s is safe: the badge poll and exec preflight share this cache.
const AVAILABLE_TTL_MS = 60_000;

// Terminal-control stripping. All patterns are built from charCode() rather than
// literal control chars so the regexes don't trip biome's noControlCharactersInRegex
// rule. We strip the full ANSI/control surface — not just SGR colors — so a buggy or
// hostile Codex can't smuggle a cursor-move, screen-clear, hyperlink, or title-set
// payload into a cached verdict detail, the statusline, or echoed CLI output.
const ESC = String.fromCharCode(27); // \x1b
const BEL = String.fromCharCode(7); // \x07
// CSI: ESC [ <params 0x30-0x3F> <intermediates 0x20-0x2F> <final 0x40-0x7E>.
// Superset of the old SGR-only `ESC[…m` — also covers cursor moves, erases, etc.
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
// OSC: ESC ] … terminated by BEL or ST (ESC \). Covers hyperlinks (ESC]8;;…) and
// window-title sets (ESC]0;…). Non-greedy so adjacent sequences don't merge.
const OSC_RE = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`, "g");
// Remaining C0 controls (except tab/newline/CR) + DEL + any solitary ESC left by an
// incomplete sequence. Run AFTER CSI/OSC so full sequences are removed as units.
const CONTROL_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

/**
 * Codex usability, worst-to-usable. The cheap L0/L1 check only distinguishes the
 * first three; `no-access` and `rate-limited` come only from a real L2 call.
 */
export type CodexState =
  | "available"
  | "not-installed"
  | "unauthenticated"
  | "no-access"
  | "rate-limited"
  | "unknown";

const CodexVerdictSchema = z.object({
  state: z.enum([
    "available",
    "not-installed",
    "unauthenticated",
    "no-access",
    "rate-limited",
    "unknown",
  ]),
  /** ISO timestamp this verdict was recorded. */
  checkedAt: z.string(),
  /** True when the verdict came from a real `codex exec` (no-access / rate-limited).
   *  The cheap login-status check can't observe entitlement or quota, so it must
   *  not silently overwrite a fresh sticky verdict with "available". */
  sticky: z.boolean(),
  /** Short human note (an error snippet, usually) for the statusline / logs. */
  detail: z.string().optional(),
});

export type CodexVerdict = z.infer<typeof CodexVerdictSchema>;

// "unknown" = an inconclusive L1 result (CLI drift, keychain hiccup, unrecognized
// failure) that should NOT block L2 — the real exec probe gets to classify it.
export type LiveAvailability = "available" | "not-installed" | "unauthenticated" | "unknown";
export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

// Runtime allowlist — TypeScript already constrains CodexSandbox, but this guards
// against an untyped/JS caller or a future refactor feeding `--sandbox` an
// unexpected value. danger-full-access stays in the type but is never a default.
const ALLOWED_SANDBOXES: readonly CodexSandbox[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];

export interface CodexRunOptions {
  prompt: string;
  /** Defaults to "workspace-write" for exec. Never defaults to danger-full-access;
   *  the caller must pass it explicitly. */
  sandbox?: CodexSandbox;
  cwd?: string;
  timeoutMs?: number;
  /** When true, bypass a sticky rate-limited or no-access verdict and re-probe
   *  with a real call. Useful when the quota message was a false positive (auth
   *  mismatch). Does NOT bypass not-installed or unauthenticated — those can't
   *  succeed regardless. */
  force?: boolean;
}

export interface CodexRunResult {
  ok: boolean;
  /** Codex's final message (plain stdout). Empty when the preflight gate blocked. */
  output: string;
  state: CodexState;
  /** On block/failure: human-readable guidance. On success: undefined. */
  detail?: string;
}

// ── L0 + L1: cheap, no model call ──────────────────────────────────────────────

/** PATH presence + `codex login status` exit code. `login status` only reads
 *  cached credentials (no network model call), so this is free to run often.
 *  Spawned directly (not via runProcessFull) so the call can be bounded — a hung
 *  CLI must not stall the preflight gate. A timeout kill → "unknown" (distinct
 *  from "unauthenticated" — a hung status check is not a positive logged-out
 *  signal). A synchronous spawn error → fail open as unauthenticated (continue
 *  Claude-only), never throw into the hot path. */
export async function checkCodexAvailability(): Promise<LiveAvailability> {
  if (!hasCommand("codex")) return "not-installed";
  try {
    const proc = Bun.spawn(["codex", "login", "status"], {
      stdout: "ignore",
      stderr: "pipe",
      timeout: LOGIN_STATUS_TIMEOUT_MS,
    });
    const stderr = await new Response(proc.stderr).text();
    const exit = await proc.exited; // on timeout Bun kills the process → non-zero
    if (exit === 0) return "available";
    // A timeout kill is surfaced via proc.signalCode (Bun sets it when it kills
    // the process for exceeding `timeout`). That is NOT a "not logged in"
    // signal — classify it as "unknown" (inconclusive, let L2 decide) rather
    // than "unauthenticated", which would wrongly tell the user to `codex login`
    // when the real problem was a hung/slow status check.
    if (proc.signalCode !== null) return "unknown";
    // Non-zero: a positive "not logged in" signal blocks L2 (re-login fixes it).
    // But CLI version drift, an unrecognized subcommand, or a keychain error must
    // NOT be misread as "unauthenticated" — that would block L2 forever. Classify
    // those as "unknown" so the real exec probe can decide.
    const s = stderr.toLowerCase();
    if (
      /not logged in|logged out|run .*codex login|no credentials|please (?:log|sign)[ -]?in|not authenticated|unauthenticated/.test(
        s,
      )
    ) {
      return "unauthenticated";
    }
    if (
      /error|unrecognized|unknown (?:sub)?command|unexpected|usage:|invalid|panic|not found/.test(s)
    ) {
      return "unknown";
    }
    return "unauthenticated";
  } catch {
    return "unauthenticated";
  }
}

// ── Verdict cache (the statusline badge + preflight gate read this) ─────────────

export async function readCodexVerdict(): Promise<CodexVerdict> {
  const raw = await readState<unknown>(VERDICT_FILE, null);
  const parsed = CodexVerdictSchema.safeParse(raw);
  return parsed.success
    ? parsed.data
    : { state: "unknown", checkedAt: new Date(0).toISOString(), sticky: false };
}

export async function writeCodexVerdict(v: CodexVerdict): Promise<void> {
  await writeState(VERDICT_FILE, v);
}

function ageMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Date.now() - t;
}

/** A sticky negative is honored only until its TTL; past that we let a fresh call
 *  re-probe, so an upgraded plan or reset window is picked up automatically. */
function isStickyVerdictFresh(v: CodexVerdict): boolean {
  if (!v.sticky) return false;
  if (v.state === "no-access") return ageMs(v.checkedAt) < NO_ACCESS_TTL_MS;
  if (v.state === "rate-limited") return ageMs(v.checkedAt) < RATE_LIMIT_TTL_MS;
  return false;
}

/** Merge a fresh cheap check with the cached verdict. A worse live state
 *  (not-installed / unauthenticated) always wins — it overrides any stale sticky.
 *  When live is "available", a still-fresh sticky negative wins, because
 *  login-status cannot see entitlement (no-access) or quota (rate-limited). */
export function reconcile(live: LiveAvailability, cached: CodexVerdict): CodexVerdict {
  const now = new Date().toISOString();
  // Definitive negatives (binary gone / logged out) always win — they override any
  // stale sticky, because the cache can't express "the user just removed access".
  if (live === "not-installed" || live === "unauthenticated") {
    return { state: live, checkedAt: now, sticky: false };
  }
  // "available" or inconclusive "unknown": a still-fresh sticky L2 negative wins,
  // since the cheap check can't observe entitlement (no-access) or quota (rate-limited).
  if (isStickyVerdictFresh(cached)) return cached;
  if (live === "available") return { state: "available", checkedAt: now, sticky: false };
  // Inconclusive L1 with no fresh sticky → let the real exec probe classify it.
  return { state: "unknown", checkedAt: now, sticky: false };
}

/** Persist a reconciled verdict, guarding the cross-process read-check-write race:
 *  a non-sticky "available"/"unknown" verdict is computed from a *cheap* or
 *  *inconclusive* signal that can't see entitlement or quota, so it must not clobber
 *  a newer fresh sticky L2 negative (rate-limited / no-access) that a concurrent
 *  `runCodexExec` may have written after we read the cache. Definitive negatives and
 *  real L2 verdicts always win. Re-reads immediately before writing to shrink the
 *  TOCTOU window (there is no cross-process file lock). Returns the verdict that
 *  ended up authoritative so callers reflect a concurrent L2 result. */
async function commitReconciled(v: CodexVerdict): Promise<CodexVerdict> {
  if (!v.sticky && (v.state === "available" || v.state === "unknown")) {
    const current = await readCodexVerdict();
    if (isStickyVerdictFresh(current)) return current;
  }
  await writeCodexVerdict(v);
  return v;
}

/** Run the cheap check, reconcile with the cache, persist, and return the verdict.
 *  Shared by the SessionStart hook (for the badge) and the preflight gate.
 *  When the cached verdict is "available" and still within AVAILABLE_TTL_MS, the
 *  up-to-5s `codex login status` spawn is skipped entirely to avoid latency. */
export async function refreshCodexVerdict(): Promise<CodexVerdict> {
  const cached = await readCodexVerdict();
  // Short-circuit: a recent "available" verdict doesn't need a fresh login-status
  // spawn. Negative verdicts always go through the full reconcile path.
  if (cached.state === "available" && ageMs(cached.checkedAt) < AVAILABLE_TTL_MS) {
    return cached;
  }
  const live = await checkCodexAvailability();
  return commitReconciled(reconcile(live, cached));
}

// ── L2: classify a real call's failure ─────────────────────────────────────────

/**
 * Strip ANSI escape codes and redact credentials from any string. Operates on
 * the full text (no line capping, no length limit). Used by both `firstLine`
 * (for cached detail snippets) and `sanitizeOutput` (for full output surfaces).
 */
export function sanitizeOutput(s: string): string {
  return s
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(CONTROL_RE, "")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(/Bearer[\s:]+\S+/gi, "Bearer [redacted]")
    .replace(/(Authorization:\s*)\S+/gi, "$1[redacted]")
    .replace(/\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET))=\S+/gi, "$1=[redacted]");
}

/** First non-empty line of a subprocess stderr, sanitized before it's cached to
 *  ~/.claude/tmp or echoed to the terminal: strip ANSI escapes, redact
 *  token-shaped substrings, and cap length. Defense-in-depth against a future or
 *  misconfigured Codex echoing a credential into the verdict file / statusline. */
function firstLine(s: string): string {
  const line =
    s
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim() ?? "";
  return sanitizeOutput(line).slice(0, 200);
}

/** Map a failed `codex exec` to a verdict state. Codex's "Quota exceeded / you've
 *  hit your usage limit" message is famously *also* emitted on auth/workspace
 *  mismatch, so we classify it as transient (rate-limited) and let the gate
 *  surface a re-login hint, rather than concluding the account has no plan. */
export function classifyCodexError(
  exit: number,
  stderr: string,
): { state: "no-access" | "rate-limited" | "unknown"; detail: string } {
  const s = stderr.toLowerCase();
  if (/quota|usage limit|rate.?limit|too many requests|\b429\b/.test(s)) {
    return { state: "rate-limited", detail: firstLine(stderr) };
  }
  if (
    /unauthorized|\b401\b|forbidden|\b403\b|no access|not entitled|does not have access/.test(s)
  ) {
    return { state: "no-access", detail: firstLine(stderr) };
  }
  return { state: "unknown", detail: firstLine(stderr) || `exit ${exit}` };
}

// ── Preflight gate + exec ──────────────────────────────────────────────────────

function blocked(state: CodexState, message: string): CodexRunResult {
  return { ok: false, output: "", state, detail: message };
}

/** Is it worth attempting a Codex call right now? Returns a blocking result with
 *  guidance when not, or null when clear to proceed (including "unknown" — there
 *  the call itself is the probe).
 *
 *  When `force` is true, sticky rate-limited and no-access verdicts are bypassed
 *  so the real call can re-probe. not-installed and unauthenticated are never
 *  bypassed — a call cannot succeed in those states regardless. */
export async function codexPreflight(force = false): Promise<CodexRunResult | null> {
  const v = await refreshCodexVerdict();
  switch (v.state) {
    case "available":
      return null;
    case "not-installed":
      return blocked(
        v.state,
        "Codex CLI not on PATH. Install it and run `codex login` to enable the /codex bridge. Continuing Claude-only.",
      );
    case "unauthenticated":
      return blocked(
        v.state,
        "Codex is installed but not logged in. Run `codex login` (use your ChatGPT/Codex subscription) to enable the bridge. Continuing Claude-only.",
      );
    case "no-access":
      if (force) return null; // re-probe: the sticky may be a false positive
      return blocked(
        v.state,
        `This account showed no Codex access on its plan (checked ${v.checkedAt}). If that's wrong, run \`codex logout && codex login\` — the entitlement error is sometimes a stale/cross-workspace credential. Or pass --force to re-probe. Continuing Claude-only.`,
      );
    case "rate-limited":
      if (force) return null; // re-probe: quota message is also emitted on auth mismatch
      return blocked(
        v.state,
        `Codex hit its usage limit for this ~5-hour window (since ${v.checkedAt}). Failing over to Claude-only; retry after the window resets, or pass --force to re-probe.`,
      );
    default:
      return null;
  }
}

/** Run `codex exec` with the gate in front. On success the plain final message is
 *  returned (no --json, so stdout is the answer, not an event stream). On failure
 *  the error is classified and cached so repeated entitlement failures stop
 *  retrying while one-off errors don't poison the cache.
 *
 *  Timeout: if the process is still running at the effective timeout limit, the
 *  partial stdout is surfaced with a human-readable detail message. Timeouts are
 *  NOT cached as sticky failures — the bridge stays "available" for the next call.
 *
 *  Output sanitization: both success and failure output paths run sanitizeOutput
 *  before returning, so callers never need to strip credentials themselves. */
export async function runCodexExec(opts: CodexRunOptions): Promise<CodexRunResult> {
  const gate = await codexPreflight(opts.force ?? false);
  if (gate) return gate;

  const sandbox = opts.sandbox ?? "workspace-write";
  if (!ALLOWED_SANDBOXES.includes(sandbox)) {
    return blocked("unknown", `Refusing to run Codex: unknown sandbox "${sandbox}".`);
  }
  // Clamp to a hard ceiling, and treat 0/negative (which Bun reads as "no
  // timeout") as the default so a hung call can never run unbounded.
  const requested = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_EXEC_TIMEOUT_MS;
  const timeout = Math.min(requested, MAX_EXEC_TIMEOUT_MS);
  // `--` ends Codex's option parsing: a prompt beginning with `-` can't be
  // re-read by its arg parser as a flag (e.g. a sandbox override). Security: H1.
  const startedAt = Date.now();
  let stdout: string;
  let stderr: string;
  let exit: number;
  let signalCode: string | null;
  try {
    const proc = Bun.spawn(["codex", "exec", "--sandbox", sandbox, "--", opts.prompt], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      // Hard kill on the timeout: a child that ignores SIGTERM (Bun's default) could
      // otherwise outrun the ceiling. SIGKILL guarantees the bound is real.
      killSignal: "SIGKILL",
    });
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    exit = await proc.exited;
    signalCode = proc.signalCode; // set when the process was killed by a signal
  } catch (err) {
    // Bun.spawn throws synchronously on ENOENT (codex vanished from PATH inside the
    // AVAILABLE_TTL_MS window that skips the L0 check), on an invalid `cwd`, and on
    // permission errors. Fail open with a classified verdict instead of letting the
    // exception crash the /codex script.
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    const now2 = new Date().toISOString();
    if (code === "ENOENT" || /\benoent\b|not found|no such file/i.test(msg)) {
      await writeCodexVerdict({ state: "not-installed", checkedAt: now2, sticky: false });
      return blocked(
        "not-installed",
        "Codex CLI could not be launched (not on PATH). Reinstall it and run `codex login`. Continuing Claude-only.",
      );
    }
    // Any other launch failure is a one-off: don't sticky-disable the bridge.
    await commitReconciled({ state: "available", checkedAt: now2, sticky: false });
    return {
      ok: false,
      output: "",
      state: "unknown",
      detail: `Codex failed to launch: ${firstLine(msg)}`,
    };
  }
  const elapsed = Date.now() - startedAt;
  const now = new Date().toISOString();

  if (exit === 0) {
    await writeCodexVerdict({ state: "available", checkedAt: now, sticky: false });
    return { ok: true, output: sanitizeOutput(stdout.trim()), state: "available" };
  }

  // Detect timeout: the process was killed by a signal (our SIGKILL hard cap), or —
  // as a fallback if the runtime didn't surface a signal — a non-zero exit at/after
  // the effective limit. The partial stdout (captured before the kill) is surfaced
  // so the caller has context. Timeouts are not sticky-cached — the bridge stays open.
  if (signalCode !== null || (exit !== 0 && elapsed >= timeout)) {
    await writeCodexVerdict({ state: "available", checkedAt: now, sticky: false });
    const minutes = Math.round(timeout / 60_000);
    return {
      ok: false,
      output: sanitizeOutput(stdout.trim()),
      state: "unknown",
      detail: `Codex timed out after ${minutes}m — split the task into smaller pieces or raise the timeout.`,
    };
  }

  const cls = classifyCodexError(exit, stderr);
  // An unclassified one-off failure must not sticky-disable the bridge: leave the
  // cache reading "available" but report the failure to the caller. Guarded so it
  // can't clobber a fresher sticky L2 verdict a concurrent exec just wrote.
  if (cls.state === "unknown") {
    await commitReconciled({ state: "available", checkedAt: now, sticky: false });
  } else {
    await writeCodexVerdict({ state: cls.state, checkedAt: now, sticky: true, detail: cls.detail });
  }
  return { ok: false, output: sanitizeOutput(stdout.trim()), state: cls.state, detail: cls.detail };
}
