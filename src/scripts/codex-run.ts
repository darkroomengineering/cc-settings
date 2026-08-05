#!/usr/bin/env bun

// CLI for the /codex skill — delegates tasks, reviews diffs, or asks questions
// using the OpenAI Codex CLI as a second model in the Claude x Codex pairing.
//
// Usage:
//   codex-run.ts exec [--force] "<task>"     — delegate mechanical/bulk work to Codex
//   codex-run.ts review [--force] [scope]    — independent review, default: uncommitted diff
//   codex-run.ts ask [--force] "<question>"  — read-only second opinion from Codex
//
// review scope flags (mutually exclusive, default: uncommitted working-tree diff):
//   --staged           review only the staged diff (`git diff --cached`)
//   --base <branch>    review the diff against a base branch (merge-base...HEAD)
//   --commit <sha>     review a single commit
//
// CODEX_REVIEW_MODEL: when set, pins `review` to that model via `codex exec -m`
//   — mirrors Codex's own `review_model` config key. Unset uses codex's default.
//
// --force: bypass a sticky rate-limited or no-access verdict and re-probe with a
//   real call. Useful when the quota message was a false positive (e.g. auth mismatch).
//   Does NOT bypass not-installed or unauthenticated — those can't succeed regardless.

import { buildReviewPrompt, parseReviewArgs, runCodexExec, sanitizeOutput } from "../lib/codex.ts";
import { runGit } from "../lib/git.ts";

function usage(): void {
  console.error(
    [
      "Usage: codex-run.ts <subcommand> [--force] [args]",
      "",
      "  exec [--force] <task>      Delegate mechanical/bulk work to Codex (workspace-write sandbox)",
      "  review [--force] [scope]   Review a diff for bugs, security issues, and quality",
      "  ask [--force] <question>   Read-only second opinion from Codex",
      "",
      "  --force  Bypass a sticky rate-limited/no-access verdict and re-probe.",
      "           Useful when the quota error is a false positive (e.g. auth mismatch).",
      "",
      "review scope (mutually exclusive, default: uncommitted working-tree diff):",
      "  --staged           review only the staged diff (git diff --cached)",
      "  --base <branch>    review the diff against a base branch",
      "  --commit <sha>     review a single commit",
      "",
      "CODEX_REVIEW_MODEL env var pins review to a specific model (codex exec -m).",
    ].join("\n"),
  );
}

/** Consume a LEADING `--force` flag (and an optional `--` end-of-flags marker) from
 *  the front of argv, returning {force, rest}. Only tokens before the first
 *  positional (or before `--`) are treated as flags, so a literal `--force` inside
 *  the prompt text — e.g. `ask "what does --force do"` — is preserved verbatim. */
function parseForce(args: string[]): { force: boolean; rest: string[] } {
  let force = false;
  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === "--force") {
      force = true;
      continue;
    }
    if (args[i] === "--") {
      i++; // explicit end-of-flags; the prompt starts after it
      break;
    }
    break; // first positional → stop flag parsing
  }
  return { force, rest: args.slice(i) };
}

const [, , subcommand, ...rest] = process.argv;

if (!subcommand) {
  usage();
  process.exit(2);
}

switch (subcommand) {
  case "exec": {
    const { force, rest: execArgs } = parseForce(rest);
    const task = execArgs.join(" ").trim();
    if (!task) {
      console.error("Error: exec requires a task argument.\n");
      usage();
      process.exit(2);
    }
    const result = await runCodexExec({ prompt: task, sandbox: "workspace-write", force });
    if (result.ok) {
      console.log(result.output);
      // Surface the changed-file summary so callers always see what exec wrote.
      try {
        const status = await runGit(["status", "--porcelain"]);
        const stat = await runGit(["diff", "--stat"]);
        if (status || stat) {
          // Sanitize: filenames in a hostile repo can carry escape/control bytes,
          // and this is echoed straight to the terminal.
          console.log("\n── git summary ──────────────────────────────");
          if (status) console.log(sanitizeOutput(status));
          if (stat) console.log(sanitizeOutput(stat));
        }
      } catch {
        // Not a git repo or git unavailable — skip the summary gracefully.
      }
      process.exit(0);
    } else {
      console.error(result.detail ?? `Codex exec failed (state: ${result.state})`);
      process.exit(1);
    }
    break;
  }

  case "review": {
    const parsed = parseReviewArgs(rest);
    if (!parsed.ok) {
      console.error(`Error: ${parsed.error}\n`);
      usage();
      process.exit(2);
    }
    const reviewPrompt = buildReviewPrompt(parsed.scope);
    const model = process.env.CODEX_REVIEW_MODEL || undefined;
    const result = await runCodexExec({
      prompt: reviewPrompt,
      sandbox: "read-only",
      force: parsed.force,
      model,
    });
    if (result.ok) {
      console.log(result.output);
      process.exit(0);
    } else {
      console.error(result.detail ?? `Codex review failed (state: ${result.state})`);
      process.exit(1);
    }
    break;
  }

  case "ask": {
    const { force, rest: askArgs } = parseForce(rest);
    const question = askArgs.join(" ").trim();
    if (!question) {
      console.error("Error: ask requires a question argument.\n");
      usage();
      process.exit(2);
    }
    const result = await runCodexExec({ prompt: question, sandbox: "read-only", force });
    if (result.ok) {
      console.log(result.output);
      process.exit(0);
    } else {
      console.error(result.detail ?? `Codex ask failed (state: ${result.state})`);
      process.exit(1);
    }
    break;
  }

  default: {
    console.error(`Unknown subcommand: ${subcommand}\n`);
    usage();
    process.exit(2);
  }
}
