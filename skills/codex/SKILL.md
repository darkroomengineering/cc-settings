---
name: codex
argument-hint: "[exec|review|ask] [task]"
description: Claude x Codex bridge — delegate mechanical or bulk implementation to the OpenAI Codex CLI, get an independent cross-model review of the current uncommitted diff, or ask Codex a read-only second-opinion question. Triggers "use codex", "have codex do", "have codex review", "have codex check", "codex exec", "second opinion from codex", "cross-check with codex", "delegate to codex", "ask codex". Use when you want a different model family to verify your own diff, parallelize bulk work, or get a fast read-only opinion without spending Claude turns.
context: main
---

# Codex Bridge

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

Runs in a `read-only` sandbox. Codex reads the repo itself (`git diff`, `git status`) and reports findings by severity (HIGH / MEDIUM / LOW), covering correctness bugs, security issues, and obvious quality problems.

Use this after you have finished a diff and want a second opinion from a different model family. Codex and Claude have different blind spots — cross-model review catches what Opus self-review misses. This is the primary reason to prefer `review` over asking Claude to review its own output.

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

---

## Availability states

The script handles all availability states gracefully. On failure it prints guidance to stderr and exits 1. Possible states:

- `not-installed` -- install Codex CLI and run `codex login`
- `unauthenticated` -- run `codex login`
- `no-access` -- plan entitlement issue; try `codex logout && codex login`
- `rate-limited` -- usage window exhausted; retry after the ~5-hour reset
- `unknown` -- one-off error; safe to retry
