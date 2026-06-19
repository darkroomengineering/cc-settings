#!/usr/bin/env bun

// CLI for the /codex skill — delegates tasks, reviews diffs, or asks questions
// using the OpenAI Codex CLI as a second model in the Claude x Codex pairing.
//
// Usage:
//   codex-run.ts exec [--force] "<task>"    — delegate mechanical/bulk work to Codex
//   codex-run.ts review [--force]           — independent review of the current uncommitted diff
//   codex-run.ts ask [--force] "<question>" — read-only second opinion from Codex
//
// --force: bypass a sticky rate-limited or no-access verdict and re-probe with a
//   real call. Useful when the quota message was a false positive (e.g. auth mismatch).
//   Does NOT bypass not-installed or unauthenticated — those can't succeed regardless.

import { runCodexExec } from "../lib/codex.ts";
import { runGit } from "../lib/git.ts";

function usage(): void {
  console.error(
    [
      "Usage: codex-run.ts <subcommand> [--force] [args]",
      "",
      "  exec [--force] <task>      Delegate mechanical/bulk work to Codex (workspace-write sandbox)",
      "  review [--force]           Review the current uncommitted diff for bugs, security issues, and quality",
      "  ask [--force] <question>   Read-only second opinion from Codex",
      "",
      "  --force  Bypass a sticky rate-limited/no-access verdict and re-probe.",
      "           Useful when the quota error is a false positive (e.g. auth mismatch).",
    ].join("\n"),
  );
}

/** Strip --force from an argv array and return {force, rest}. */
function parseForce(args: string[]): { force: boolean; rest: string[] } {
  const force = args.includes("--force");
  const rest = args.filter((a) => a !== "--force");
  return { force, rest };
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
          console.log("\n── git summary ──────────────────────────────");
          if (status) console.log(status);
          if (stat) console.log(stat);
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
    const { force } = parseForce(rest);
    const reviewPrompt = [
      "You are performing an independent code review of the current uncommitted diff in this repository.",
      "",
      "Steps:",
      "1. Run `git status` to see which files are modified.",
      "2. Run `git diff` to see the full uncommitted changes (also check `git diff --cached` for staged changes).",
      "3. Review the diff for: correctness bugs, security issues (injection, secrets, unsafe operations),",
      "   and obvious quality problems (logic errors, missing error handling, type unsafety).",
      "4. Report your findings grouped by severity: HIGH, MEDIUM, LOW.",
      "   For each finding include: file + line range, description, and suggested fix.",
      "5. If the diff is clean, say so explicitly.",
      "",
      "Be concise and precise. Focus on real problems, not style preferences.",
    ].join("\n");
    const result = await runCodexExec({ prompt: reviewPrompt, sandbox: "read-only", force });
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
