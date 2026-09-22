// Codex-to-Claude bridge: lets a standalone Codex session (GPT-6 Astra) get an
// independent opinion from a Claude model, by default Opus 5.5, through headless
// `claude -p`. Review and ask only. It never edits: the Claude call runs with
// a read-only tool set and `--permission-mode dontAsk`, so any tool outside the
// allowlist is denied instead of prompting.
//
// This is the mirror of src/lib/codex.ts (Claude-to-Codex). Both refuse to run
// from inside the other product's session so the two bridges cannot chain.

import { whichCommand } from "./platform.ts";

export const CLAUDE_BRIDGE_DEFAULT_MODEL = "claude-opus-5-5";
export const CLAUDE_BRIDGE_MODEL_ENV = "CLAUDE_BRIDGE_MODEL";
export const SAFE_CLAUDE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]*$/;

/** Tools the headless review may use. Read-only inspection plus the git
 *  subcommands that show a diff. `dontAsk` denies everything else silently. */
export const CLAUDE_BRIDGE_TOOLS = ["Read", "Grep", "Glob", "Bash"] as const;
export const CLAUDE_BRIDGE_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git log:*)",
] as const;

export type ClaudeBridgeState =
  | "available"
  | "not-installed"
  | "inside-claude"
  | "network-disabled"
  | "unknown";

export interface ClaudeBridgeVerdict {
  state: ClaudeBridgeState;
  detail?: string;
}

/** Preflight without spending a model call. The two refusals are structural:
 *  running from inside a Claude session would make Claude -> Codex -> Claude a
 *  loop, and a Codex sandbox with network disabled cannot reach the API at all. */
export function preflightClaudeBridge(
  env: Record<string, string | undefined> = process.env,
  claudeOnPath: () => boolean = () => whichCommand("claude") !== null,
): ClaudeBridgeVerdict {
  if (env.CLAUDECODE) {
    return {
      state: "inside-claude",
      detail:
        "claude-run.ts: refusing to run inside a Claude Code session. Use the Agent tool with a model override, or the Claude-to-Codex bridge (codex-run.ts).",
    };
  }
  if (env.CODEX_SANDBOX_NETWORK_DISABLED === "1") {
    return {
      state: "network-disabled",
      detail:
        "claude-run.ts: the Codex sandbox has network disabled, so `claude -p` cannot reach the API. Rerun the command with escalated permissions (network), or set `[sandbox_workspace_write] network_access = true` in $CODEX_HOME/config.toml and use a workspace-write agent.",
    };
  }
  if (!claudeOnPath()) {
    return {
      state: "not-installed",
      detail:
        "claude-run.ts: `claude` is not on PATH. Install Claude Code and run `claude` once to log in.",
    };
  }
  return { state: "available" };
}

export type ResolveClaudeModelResult = { ok: true; model: string } | { ok: false; error: string };

export function resolveClaudeModel(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ResolveClaudeModelResult {
  const envValue = env[CLAUDE_BRIDGE_MODEL_ENV];
  const candidate =
    flag ?? (envValue?.trim() ? envValue.trim() : undefined) ?? CLAUDE_BRIDGE_DEFAULT_MODEL;
  if (!SAFE_CLAUDE_MODEL_RE.test(candidate)) {
    return {
      ok: false,
      error: `model "${candidate}" is not a valid Claude model id or alias (letters, digits, '.', '_', '-', '[', ']' only; must not start with '-').`,
    };
  }
  return { ok: true, model: candidate };
}

/** The argv for a headless, read-only Claude call. The prompt goes over stdin
 *  so a prompt beginning with `-` can never be read as a flag. */
export function buildClaudeArgs(model: string): string[] {
  return [
    "claude",
    "-p",
    "--model",
    model,
    "--permission-mode",
    "dontAsk",
    "--tools",
    CLAUDE_BRIDGE_TOOLS.join(","),
    "--allowedTools",
    CLAUDE_BRIDGE_ALLOWED_TOOLS.join(","),
    "--no-session-persistence",
    "--output-format",
    "text",
  ];
}

export interface ClaudeRunOptions {
  prompt: string;
  model: string;
  cwd?: string;
  timeoutMs?: number;
}

export type ClaudeRunResult =
  | { ok: true; output: string }
  | { ok: false; state: ClaudeBridgeState; detail: string };

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

export async function runClaudePrint(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const verdict = preflightClaudeBridge();
  if (verdict.state !== "available") {
    return { ok: false, state: verdict.state, detail: verdict.detail ?? verdict.state };
  }
  const requested = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeout = Math.min(requested, MAX_TIMEOUT_MS);
  try {
    const proc = Bun.spawn(buildClaudeArgs(opts.model), {
      cwd: opts.cwd,
      stdin: new Blob([opts.prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit = await proc.exited;
    if (exit !== 0) {
      return {
        ok: false,
        state: "unknown",
        detail: `claude exited ${exit}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      };
    }
    return { ok: true, output: stdout.trimEnd() };
  } catch (error) {
    return {
      ok: false,
      state: "unknown",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
