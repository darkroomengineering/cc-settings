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

// ESC[…m built from charCode(27) rather than a literal control char, so the
// regex doesn't trip biome's noControlCharactersInRegex rule.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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

export type LiveAvailability = "available" | "not-installed" | "unauthenticated";
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
 *  CLI must not stall the preflight gate. Timeout/spawn error → fail open as
 *  unauthenticated (continue Claude-only), never throw into the hot path. */
export async function checkCodexAvailability(): Promise<LiveAvailability> {
  if (!hasCommand("codex")) return "not-installed";
  try {
    const proc = Bun.spawn(["codex", "login", "status"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: LOGIN_STATUS_TIMEOUT_MS,
    });
    const exit = await proc.exited; // on timeout Bun kills the process → non-zero
    return exit === 0 ? "available" : "unauthenticated";
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
  if (live !== "available") return { state: live, checkedAt: now, sticky: false };
  if (isStickyVerdictFresh(cached)) return cached;
  return { state: "available", checkedAt: now, sticky: false };
}

/** Run the cheap check, reconcile with the cache, persist, and return the verdict.
 *  Shared by the SessionStart hook (for the badge) and the preflight gate. */
export async function refreshCodexVerdict(): Promise<CodexVerdict> {
  const [live, cached] = await Promise.all([checkCodexAvailability(), readCodexVerdict()]);
  const v = reconcile(live, cached);
  await writeCodexVerdict(v);
  return v;
}

// ── L2: classify a real call's failure ─────────────────────────────────────────

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
  return line
    .replace(ANSI_RE, "")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(Authorization:\s*)\S+/gi, "$1[redacted]")
    .slice(0, 200);
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
 *  the call itself is the probe). */
export async function codexPreflight(): Promise<CodexRunResult | null> {
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
      return blocked(
        v.state,
        `This account showed no Codex access on its plan (checked ${v.checkedAt}). If that's wrong, run \`codex logout && codex login\` — the entitlement error is sometimes a stale/cross-workspace credential. Continuing Claude-only.`,
      );
    case "rate-limited":
      return blocked(
        v.state,
        `Codex hit its usage limit for this ~5-hour window (since ${v.checkedAt}). Failing over to Claude-only; retry after the window resets.`,
      );
    default:
      return null;
  }
}

/** Run `codex exec` with the gate in front. On success the plain final message is
 *  returned (no --json, so stdout is the answer, not an event stream). On failure
 *  the error is classified and cached so repeated entitlement failures stop
 *  retrying while one-off errors don't poison the cache. */
export async function runCodexExec(opts: CodexRunOptions): Promise<CodexRunResult> {
  const gate = await codexPreflight();
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
  const proc = Bun.spawn(["codex", "exec", "--sandbox", sandbox, "--", opts.prompt], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  const now = new Date().toISOString();

  if (exit === 0) {
    await writeCodexVerdict({ state: "available", checkedAt: now, sticky: false });
    return { ok: true, output: stdout.trim(), state: "available" };
  }

  const cls = classifyCodexError(exit, stderr);
  // An unclassified one-off failure must not sticky-disable the bridge: leave the
  // cache reading "available" but report the failure to the caller.
  if (cls.state === "unknown") {
    await writeCodexVerdict({ state: "available", checkedAt: now, sticky: false });
  } else {
    await writeCodexVerdict({ state: cls.state, checkedAt: now, sticky: true, detail: cls.detail });
  }
  return { ok: false, output: stdout.trim(), state: cls.state, detail: cls.detail };
}
