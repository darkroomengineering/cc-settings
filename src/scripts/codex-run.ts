#!/usr/bin/env bun
// CLI for the /codex skill — delegates tasks, reviews diffs, or asks questions
// using the OpenAI Codex CLI as a second model in the Claude x Codex pairing.
//
// Usage:
//   codex-run.ts exec "<task>"    — delegate mechanical/bulk work to Codex
//   codex-run.ts review           — independent review of the current uncommitted diff
//   codex-run.ts ask "<question>" — read-only second opinion from Codex

import { runCodexExec } from "../lib/codex.ts";

function usage(): void {
  console.error(
    [
      "Usage: codex-run.ts <subcommand> [args]",
      "",
      "  exec <task>      Delegate mechanical/bulk work to Codex (workspace-write sandbox)",
      "  review           Review the current uncommitted diff for bugs, security issues, and quality",
      "  ask <question>   Read-only second opinion from Codex",
    ].join("\n"),
  );
}

const [, , subcommand, ...rest] = process.argv;

if (!subcommand) {
  usage();
  process.exit(2);
}

switch (subcommand) {
  case "exec": {
    const task = rest.join(" ").trim();
    if (!task) {
      console.error("Error: exec requires a task argument.\n");
      usage();
      process.exit(2);
    }
    const result = await runCodexExec({ prompt: task, sandbox: "workspace-write" });
    if (result.ok) {
      console.log(result.output);
      process.exit(0);
    } else {
      console.error(result.detail ?? `Codex exec failed (state: ${result.state})`);
      process.exit(1);
    }
    break;
  }

  case "review": {
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
    const result = await runCodexExec({ prompt: reviewPrompt, sandbox: "read-only" });
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
    const question = rest.join(" ").trim();
    if (!question) {
      console.error("Error: ask requires a question argument.\n");
      usage();
      process.exit(2);
    }
    const result = await runCodexExec({ prompt: question, sandbox: "read-only" });
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
