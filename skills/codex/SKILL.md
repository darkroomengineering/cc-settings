---
name: codex
argument-hint: "[exec|review|ask] [task]"
description: Claude-to-Codex bridge to delegate bulk mechanical work, get an independent cross-model diff review, or ask a read-only question. Triggers only when the user names Codex, as in "use codex", "have codex review", "cross-check with codex", "ask codex".
context: main
---

# Codex Bridge

## Standalone Codex

If the active host is already standalone Codex, stop before any bridge command.
Never recursively invoke `codex-run.ts` or launch the Codex CLI from inside
Codex; the script refuses when it detects a Codex session. Do the requested task
locally with native tools. When the user asks for an independent review, spawn
`claude-verifier` (a Claude model through the read-only `claude-run.ts` bridge)
or a fresh native `reviewer`; do not spawn `codex-verifier`.

Everything below is the Claude-only bridge workflow.

## Claude-only bridge

Invoke the OpenAI Codex CLI from inside a Claude session. Three subcommands map to three distinct use cases.

All subcommands are called via:

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" <subcommand> [args]
```

---

## Subcommands

### exec -- delegate mechanical or bulk work

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" exec "the full task description"
```

Runs Codex in a `workspace-write` sandbox. Use this when a task is:

- Mechanical (repetitive edits, file scaffolding, boilerplate generation)
- Bulk (touching many files at once where Claude's serial context would be slow)
- Parallelizable with Claude's own work (start Codex on one half while Claude handles the other)

**Quota routing**: Codex is metered by messages per ~5-hour window, not by tokens. Hand it one big complete task, not a sequence of small steps. A single `exec` call for a whole feature costs the same quota as one `exec` call for a single file.

**Write the task as an outcome, not a recipe.** The script wraps every `exec` task in a completion contract (run the repo's local checks, fix what the change broke, do not stop after a first implementation, leave changes uncommitted, report what was verified). GPT-6 Astra stops early when done is undefined and over-follows step lists, so the task itself must say:

- the end state that means done (which behavior holds, which files or surfaces are covered);
- where to stop exploring, if the task is open-ended;
- any decision Codex must bring back instead of making (leave everything else to its judgment).

Do not add "ask before X" language for reversible in-scope work; the sandbox already bounds the blast radius, and Astra reads such language as a reason to stop.

After `exec` returns, ALWAYS review Codex's diff before trusting it:

```bash
git diff
```

Then run the proof gate:

```bash
bun run proof
```

### review -- independent cross-model diff review

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" review
```

Runs in a `read-only` sandbox. The prompt names the diff under review and the review contract (behavior and risk only, findings by HIGH / MEDIUM / LOW with file, line range, and fix). Codex decides how to inspect the repository; the prompt no longer scripts `git status` and `git diff` steps.

Use this after you have finished a diff and want a second opinion from a different model family. Codex and Claude have different blind spots — cross-model review catches what Opus self-review misses. This is the primary reason to prefer `review` over asking Claude to review its own output.

**Scope presets** — mirrors Codex's own `/review` presets (base-branch / uncommitted / commit / custom). Default with no flags is the uncommitted working-tree diff, unchanged from before. Flags are mutually exclusive:

```bash
# Default: review the current uncommitted diff (git diff + git diff --cached)
bun "$HOME/.claude/src/scripts/codex-run.ts" review

# Only the staged diff
bun "$HOME/.claude/src/scripts/codex-run.ts" review --staged

# Diff against a base branch (merge-base...HEAD)
bun "$HOME/.claude/src/scripts/codex-run.ts" review --base main

# A single commit
bun "$HOME/.claude/src/scripts/codex-run.ts" review --commit abc1234
```

Codex's fourth preset ("custom instructions") is covered by `ask` above rather than a review flag.

**Model routing** — every subcommand pins a Codex model: `exec` defaults to `gpt-6-sol` (continues through long execution), `review` and `ask` to `gpt-6-astra` (judgment). Override per call with `--model <id>` before the task text, or per session with `CODEX_EXEC_MODEL`, `CODEX_REVIEW_MODEL`, `CODEX_ASK_MODEL`.

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" review --model gpt-6-sol --base main
bun "$HOME/.claude/src/scripts/codex-run.ts" exec --model gpt-6-astra "..."
```

### ask -- read-only second opinion

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" ask "your question here"
```

Runs in a `read-only` sandbox. Use for quick factual questions, architecture opinions, or anything where you want a fast external perspective without making any changes.

---

## Quota and cost guidance

- Codex is on a Pro-class plan metered by messages per ~5-hour window (not by tokens). Prefer FEW LARGE calls over many small ones.
- Batch work: give `exec` a whole feature or module, not one function at a time.
- `review` and `ask` are read-only and cheap — use them freely as a cross-check.
- If the script reports the bridge is unavailable (not installed, not logged in, or rate-limited), continue Claude-only. Do not block the session.
- Sessions get automatic steering: the `quota-steer` hook injects a routing reminder when Claude usage crosses 60% (5-hour) or 65% (weekly). If you see that reminder, prefer `exec`/`review` here over spawning Claude subagents.
- The `codex-verify` SessionStart hook also injects a batched routing policy whenever the bridge is available: `exec` is the default for bulk/mechanical work, and one cross-model `review` runs per PR, `/ship`, or direct push to the default branch (or on a risky commit), not on every diff-producing turn.

---

## Availability states

The script handles all availability states gracefully. On failure it prints guidance to stderr and exits 1. Possible states:

- `not-installed` -- install Codex CLI and run `codex login`
- `unauthenticated` -- run `codex login`
- `no-access` -- plan entitlement issue; try `codex logout && codex login`
- `rate-limited` -- usage window exhausted; retry after the ~5-hour reset
- `unknown` -- one-off error; safe to retry
