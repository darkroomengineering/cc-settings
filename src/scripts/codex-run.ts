#!/usr/bin/env bun

// CLI for the /codex skill — delegates tasks, reviews diffs, or asks questions
// using the OpenAI Codex CLI as a second model in the Claude x Codex pairing.
//
// Usage:
//   codex-run.ts exec [--force] [--model <id>] [--expected <min>] "<task>" — delegate mechanical/bulk work
//     (the task is wrapped in a completion contract: run checks, fix, finish, report;
//     the final message is a worker result JSON, checked against the tree and printed
//     under "worker result" with a `ready: yes|no` line. --expected kills a worker that
//     returns nothing within 3x the expected minutes and reports it as stalled.)
//   codex-run.ts review [--force] [--model <id>] [scope]    — independent review, default: uncommitted diff
//   codex-run.ts ask [--force] [--model <id>] "<question>"  — read-only second opinion
//
// Model (flag > env > Codex default): Codex's configured default model runs the call
//   unless --model or the env var (CODEX_EXEC_MODEL, CODEX_REVIEW_MODEL,
//   CODEX_ASK_MODEL) names one.
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

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessWorkerResult,
  buildExecPrompt,
  buildReviewPrompt,
  parseLeadingFlags,
  parseReviewArgs,
  parseWorkerResult,
  resolveCodexModel,
  runCodexExec,
  sanitizeOutput,
  stallDetail,
  stallTimeoutMs,
  workerResultJsonSchema,
} from "../lib/codex.ts";
import { runGit } from "../lib/git.ts";

const SHA_RE = /^[0-9a-f]{7,64}$/i;

const nulList = (out: string) => out.split("\0").filter(Boolean);

/** Read the worker's structured result and check it against the tree. Never
 *  throws: a missing or malformed result is reported as unstructured. */
async function workerResultSummary(lastMessage: string): Promise<string> {
  const header = "── worker result ──────────────────────────────";
  const parsed = parseWorkerResult(lastMessage);
  if (!parsed.ok) {
    return `${header}\nready: no (unstructured: ${parsed.error})`;
  }
  const r = parsed.result;
  let changed: string[] = [];
  let commitExists: boolean | null = null;
  try {
    const [diff, untracked] = await Promise.all([
      runGit(["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
      runGit(["ls-files", "-z", "--others", "--exclude-standard", "--full-name"]),
    ]);
    changed = [...new Set([...nulList(diff), ...nulList(untracked)])];
    if (r.commit) {
      commitExists =
        SHA_RE.test(r.commit) &&
        (await runGit(["rev-parse", "--verify", "--quiet", `${r.commit}^{commit}`])) !== "";
    }
  } catch {
    // Not a git repo: the claim cannot be checked against a tree.
  }
  const a = assessWorkerResult(r, { changed, commitExists });
  const lines = [
    header,
    `ready: ${a.ready ? "yes" : "no"}`,
    `status: ${r.status}`,
    `verify: ${r.verify_cmd || "(none)"} → ${r.verify_result.passed ? "passed" : "failed"}`,
    ...a.reasons.map((reason) => `not ready: ${reason}`),
    ...r.blockers.map((b) => `blocker: ${b}`),
    ...(a.undeclared.length ? [`changed but not listed: ${a.undeclared.join(", ")}`] : []),
  ];
  return sanitizeOutput(lines.join("\n"));
}

function usage(): void {
  console.error(
    [
      "Usage: codex-run.ts <subcommand> [--force] [args]",
      "",
      "  exec [--force] [--model <id>] [--expected <min>] <task>",
      "                                            Delegate mechanical/bulk work (workspace-write sandbox)",
      "  review [--force] [--model <id>] [scope]   Review a diff for bugs, security issues, and quality",
      "  ask [--force] [--model <id>] <question>   Read-only second opinion from Codex",
      "",
      "  --force  Bypass a sticky rate-limited/no-access verdict and re-probe.",
      "           Useful when the quota error is a false positive (e.g. auth mismatch).",
      "  --model  Pin the Codex model for this call. Without it, Codex's configured default",
      "           model runs; env CODEX_EXEC_MODEL / CODEX_REVIEW_MODEL / CODEX_ASK_MODEL",
      "           pin one per subcommand.",
      "  --expected  exec only: minutes the task should take. A worker with no output after",
      "           3x that is killed and reported as stalled (capped by the 15m exec ceiling).",
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
    const resultDir = await mkdtemp(join(tmpdir(), "codex-worker-"));
    const schemaPath = join(resultDir, "worker-result.schema.json");
    const lastMessagePath = join(resultDir, "last-message.json");
    let result: Awaited<ReturnType<typeof runCodexExec>>;
    let lastMessage = "";
    try {
      await writeFile(schemaPath, JSON.stringify(workerResultJsonSchema()));
      result = await runCodexExec({
        prompt: buildExecPrompt(task),
        sandbox: "workspace-write",
        force: flags.force,
        model: model.model,
        outputSchemaPath: schemaPath,
        outputLastMessagePath: lastMessagePath,
        ...(flags.expectedMinutes !== undefined && {
          timeoutMs: stallTimeoutMs(flags.expectedMinutes),
        }),
      });
      lastMessage = await readFile(lastMessagePath, "utf8").catch(() => "");
    } finally {
      await rm(resultDir, { recursive: true, force: true });
    }
    const stalled = stallDetail(result, flags.expectedMinutes, lastMessage);
    if (stalled) {
      console.error(stalled);
      process.exit(1);
    }
    if (result.ok) {
      console.log(result.output);
      console.log(`\n${await workerResultSummary(lastMessage)}`);
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
    if (flags.expectedMinutes !== undefined) {
      console.error("Error: ask: --expected applies to exec only.\n");
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
