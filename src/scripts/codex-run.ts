#!/usr/bin/env bun

// CLI for the /codex skill — delegates tasks, reviews diffs, or asks questions
// using the OpenAI Codex CLI as a second model in the Claude x Codex pairing.
//
// Usage:
//   codex-run.ts exec [--force] [--model <id>] "<task>"     — delegate mechanical/bulk work
//     (the task is wrapped in a completion contract: run checks, fix, finish, report)
//   codex-run.ts review [--force] [--model <id>] [scope]    — independent review, default: uncommitted diff
//   codex-run.ts ask [--force] [--model <id>] "<question>"  — read-only second opinion
//
// Model routing (flag > env > default): exec → gpt-6-sol (CODEX_EXEC_MODEL),
//   review → gpt-6-astra (CODEX_REVIEW_MODEL), ask → gpt-6-astra (CODEX_ASK_MODEL).
//   Sol continues through long execution; Astra holds the judgment calls.
//
// review scope flags (mutually exclusive, default: uncommitted working-tree diff):
//   --staged           review only the staged diff (`git diff --cached`)
//   --base <branch>    review the diff against a base branch (merge-base...HEAD)
//   --commit <sha>     review a single commit
//
//
// --force: bypass a sticky rate-limited or no-access verdict and re-probe with a
//   real call. Useful when the quota message was a false positive (e.g. auth mismatch).
//   Does NOT bypass not-installed or unauthenticated — those can't succeed regardless.

import {
  buildExecPrompt,
  buildReviewPrompt,
  parseLeadingFlags,
  parseReviewArgs,
  resolveCodexModel,
  runCodexExec,
  sanitizeOutput,
} from "../lib/codex.ts";
import { runGit } from "../lib/git.ts";

function usage(): void {
  console.error(
    [
      "Usage: codex-run.ts <subcommand> [--force] [args]",
      "",
      "  exec [--force] [--model <id>] <task>      Delegate mechanical/bulk work (workspace-write sandbox)",
      "  review [--force] [--model <id>] [scope]   Review a diff for bugs, security issues, and quality",
      "  ask [--force] [--model <id>] <question>   Read-only second opinion from Codex",
      "",
      "  --force  Bypass a sticky rate-limited/no-access verdict and re-probe.",
      "           Useful when the quota error is a false positive (e.g. auth mismatch).",
      "  --model  Pin the Codex model for this call. Defaults: exec gpt-6-sol,",
      "           review and ask gpt-6-astra; env CODEX_EXEC_MODEL / CODEX_REVIEW_MODEL /",
      "           CODEX_ASK_MODEL override the defaults.",
      "",
      "review scope (mutually exclusive, default: uncommitted working-tree diff):",
      "  --staged           review only the staged diff (git diff --cached)",
      "  --base <branch>    review the diff against a base branch",
      "  --commit <sha>     review a single commit",
      "",
    ].join("\n"),
  );
}

// Codex -> Claude -> Codex would loop quota and context. The Claude-to-Codex
// bridge only runs from a Claude session (or a plain shell), never from inside a
// Codex thread; standalone Codex uses native agents and the claude-run.ts bridge.
if (process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX) {
  console.error(
    "codex-run.ts: refusing to run inside a Codex session. Use native Codex agents, or `claude-run.ts` for a Claude opinion.",
  );
  process.exit(2);
}

const [, , subcommand, ...rest] = process.argv;

if (!subcommand) {
  usage();
  process.exit(2);
}

switch (subcommand) {
  case "exec": {
    const flags = parseLeadingFlags(rest);
    if (!flags.ok) {
      console.error(`Error: exec: ${flags.error}\n`);
      usage();
      process.exit(2);
    }
    const task = flags.rest.join(" ").trim();
    if (!task) {
      console.error("Error: exec requires a task argument.\n");
      usage();
      process.exit(2);
    }
    const model = resolveCodexModel("exec", flags.model);
    if (!model.ok) {
      console.error(`Error: ${model.error}`);
      process.exit(2);
    }
    const result = await runCodexExec({
      prompt: buildExecPrompt(task),
      sandbox: "workspace-write",
      force: flags.force,
      model: model.model,
      modelPinned: model.pinned,
    });
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
    const model = resolveCodexModel("review", parsed.model);
    if (!model.ok) {
      console.error(`Error: ${model.error}`);
      process.exit(2);
    }
    const result = await runCodexExec({
      prompt: reviewPrompt,
      sandbox: "read-only",
      force: parsed.force,
      model: model.model,
      modelPinned: model.pinned,
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
    const flags = parseLeadingFlags(rest);
    if (!flags.ok) {
      console.error(`Error: ask: ${flags.error}\n`);
      usage();
      process.exit(2);
    }
    const question = flags.rest.join(" ").trim();
    if (!question) {
      console.error("Error: ask requires a question argument.\n");
      usage();
      process.exit(2);
    }
    const model = resolveCodexModel("ask", flags.model);
    if (!model.ok) {
      console.error(`Error: ${model.error}`);
      process.exit(2);
    }
    const result = await runCodexExec({
      prompt: question,
      sandbox: "read-only",
      force: flags.force,
      model: model.model,
      modelPinned: model.pinned,
    });
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
