#!/usr/bin/env bun

// Codex-to-Claude bridge CLI. Standalone Codex (GPT-6 Astra) calls this for an
// independent Claude opinion, by default from Opus 5.5. Two subcommands, both
// read-only; there is deliberately no `exec`.
//
// Usage:
//   claude-run.ts review [--model <id>] [scope]   — independent review, default: uncommitted diff
//   claude-run.ts ask [--model <id>] "<question>" — read-only second opinion
//
// review scope flags (mutually exclusive): --staged | --base <branch> | --commit <sha>
// Model: --model > CLAUDE_BRIDGE_MODEL > claude-opus-5-5.
//
// Refuses to run inside a Claude Code session (CLAUDECODE set) so the two
// bridges cannot chain, and reports when the Codex sandbox has no network.

import { resolveClaudeModel, runClaudePrint } from "../lib/claude-bridge.ts";
import {
  buildReviewPrompt,
  parseLeadingFlags,
  parseReviewArgs,
  sanitizeOutput,
} from "../lib/codex.ts";

function usage(): void {
  console.error(
    [
      "Usage: claude-run.ts <subcommand> [--model <id>] [args]",
      "",
      "  review [scope]    Independent Claude review of a diff (read-only)",
      "  ask <question>    Read-only second opinion from Claude",
      "",
      "review scope (mutually exclusive, default: uncommitted working-tree diff):",
      "  --staged           review only the staged diff (git diff --cached)",
      "  --base <branch>    review the diff against a base branch",
      "  --commit <sha>     review a single commit",
      "",
      "  --model  Claude model id or alias. Default claude-opus-5-5; env CLAUDE_BRIDGE_MODEL overrides.",
    ].join("\n"),
  );
}

const [, , subcommand, ...rest] = process.argv;

if (!subcommand) {
  usage();
  process.exit(2);
}

switch (subcommand) {
  case "review": {
    const parsed = parseReviewArgs(rest.filter((arg) => arg !== "--force"));
    if (!parsed.ok) {
      console.error(`Error: ${parsed.error}\n`);
      usage();
      process.exit(2);
    }
    const model = resolveClaudeModel(parsed.model);
    if (!model.ok) {
      console.error(`Error: review: ${model.error}`);
      process.exit(2);
    }
    const result = await runClaudePrint({
      prompt: buildReviewPrompt(parsed.scope),
      model: model.model,
    });
    if (result.ok) {
      console.log(sanitizeOutput(result.output));
      process.exit(0);
    }
    console.error(result.detail);
    process.exit(1);
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
    const model = resolveClaudeModel(flags.model);
    if (!model.ok) {
      console.error(`Error: ask: ${model.error}`);
      process.exit(2);
    }
    const result = await runClaudePrint({ prompt: question, model: model.model });
    if (result.ok) {
      console.log(sanitizeOutput(result.output));
      process.exit(0);
    }
    console.error(result.detail);
    process.exit(1);
    break;
  }

  case "exec": {
    console.error(
      "claude-run.ts has no exec: the Codex-to-Claude bridge is review and ask only. Use a native Codex implementer for changes.",
    );
    process.exit(2);
    break;
  }

  default: {
    console.error(`Unknown subcommand: ${subcommand}\n`);
    usage();
    process.exit(2);
  }
}
