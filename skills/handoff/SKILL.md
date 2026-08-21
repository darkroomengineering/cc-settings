---
name: handoff
argument-hint: "[save|resume]"
description: End-of-session save and next-session resume. Triggers "ending session", "wrapping up", "context window", "running out of context", "done for today" (save mode); "continue where we left off", "pick up where", "last session", "previous work", "resume" (resume mode).
context: fork
---

# Session Handoff

Two-mode skill: **Save** state at end of session, **Resume** state at start of next session.

## Product-aware runner and state

Claude uses the installed runner and state under `~/.claude`:

```bash
HANDOFF_RUNNER="$HOME/.claude/src/scripts/handoff.ts"
CC_STATE_ROOT="$HOME/.claude"
```

Standalone Codex uses
`${CODEX_HOME:-$HOME/.codex}/darkroom/source/src/scripts/handoff.ts`, but the
plugin's stable handoff state is exposed only to hooks as `$PLUGIN_DATA`. In a
Codex plugin hook, set `HANDOFF_RUNNER` to that runner and
`CC_STATE_ROOT="$PLUGIN_DATA"`. Outside that environment, do not guess a cache
path or write into `~/.claude`: manual Codex create/resume/list/clean is
unavailable until the host exposes the same plugin-data path to the session.

## Mode: Save

Save current session state for later resumption. This is the **end-of-session boundary** skill — for mid-task rollback points before risky operations, use `/checkpoint`.

### Usage

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$HANDOFF_RUNNER" create
```

Or use the native command:
```
/handoff
```

### What Gets Saved

Every handoff — auto or manual — always captures real, git-derived data at
creation time:
- **Project**: name, path, current branch
- **Pending changes**: `git status --porcelain` (first 20 lines)
- **Key files**: uncommitted paths **union** the files the session ledger
  observed being changed (see below)
- **Recent commits**: subjects of the last 3 commits
- **Source**: `manual` or `auto` (see below)

In Claude, three additional sections are built purely from **observed** tool
activity, not inference:
- **Files Modified** — every path a `Write`/`Edit`/`NotebookEdit` touched
- **Files Read** — every path a `Read` touched
- **Tool Failures** — the exact tool name and error string, bounded and
  secret-redacted

These Claude-only sections come from the session ledger, a bounded JSONL at
`~/.claude/tmp/session-ledger/<session_id>.jsonl` written by the `PostToolBatch`
hook. It exists to fix a specific hole: **`git status` forgets everything you
committed.** A file edited at the start of a long session and committed an hour
later is invisible to a `git status`-only handoff, so the longer the session,
the more of its work disappears from the record. The ledger stores paths, tool
names, and error strings only — never file contents, prompts, or tool responses
— and never infers, so a `Bash` command's success is recorded as *nothing*
rather than as a guess.

Beyond that, what's actually filled in depends on how the handoff was created:

- **Manual** (`/handoff`, or `handoff.ts create --summary "text"`) — the
  `--summary` text becomes the Session Summary. Active Todos / Current Task /
  Notes for Next Session are placeholders (`<!-- ... -->`) for you (or the
  agent, before the turn ends) to fill in manually — the CLI has no way to
  know your in-progress todos, decisions, or learnings on its own.
- **Automatic** (PreCompact/SessionEnd hooks call `create --from-hook`,
  `source: "auto"`) — Active Todos, Current Task, and Notes for Next Session
  stay as unfilled placeholders, but **Session Summary is no longer blank on
  the compaction path**: the `PostCompact` hook writes Claude Code's own
  `compact_summary` into the handoff that the preceding `PreCompact` created,
  matched on session id. That summary is the one record of intent, decisions,
  and rationale; the ledger sections are the record of artifacts. They are
  stored separately and never merged, so nothing inferred is presented as
  observed.

Standalone Codex hooks capture the git-derived fields through the shared
runner, but Codex does not provide Claude's PostToolBatch session ledger or
PostCompact `compact_summary` backfill. Do not claim those sections were
observed in Codex.

On a Claude `SessionEnd` handoff (no compaction involved) Session Summary can still be
empty — pair it with the structured compaction template below, or run a manual
`/handoff` with `--summary` before ending a session.

### GitHub Issue Sync

If the current branch is linked to a GitHub Issue (e.g., `feat/123-description`):

1. **Post a progress comment** on the issue:
   ```bash
   gh issue comment 123 --body "## Session Update
   - Completed: [summary of work done]
   - Files modified: [list]
   - Next steps: [what remains]"
   ```

2. **Check off completed tasks** in the issue body if any task checkboxes were resolved during this session.

This ensures project progress is visible to the whole team, not just in local handoff files.

### Handoff Location

Handoffs are scoped per project (repo toplevel basename, or cwd basename
outside a git repo) — a handoff saved in one project never surfaces as
"latest" when you resume in another. Claude stores them below
`~/.claude/handoffs`; Codex plugin hooks store them below
`$PLUGIN_DATA/handoffs`:

```
~/.claude/handoffs/
└── <project-name>/
    ├── handoff_20260115_143000.md
    ├── handoff_20260115_143000.json
    ├── latest.md -> handoff_20260115_143000.md
    └── ...
```

Handoffs saved before this per-project scoping existed live under the flat
`~/.claude/handoffs/` directory; `resume`/`list` fall back to that legacy
directory exactly once, only when the current project has no scoped store of
its own yet.

### When to Create Handoff

1. **End of work session** - Before closing Claude Code
2. **Context at 65%+** - Before manual compaction or context quality degrades
3. **Taking a break** - Preserve state for later
4. **Switching tasks** - Save before context switch
5. **Before compacting** - Auto-triggered by PreCompact hook

### Auto-Handoff

Both products create git-derived handoffs before compaction and at session end.
Claude additionally provides the session-ledger and PostCompact behavior
described above. Codex does not provide Claude's SessionStart handoff display or
automatic pruning contract; do not promise either.

### Output

Confirms:
- Handoff file created (and GitHub Issue updated if linked)
- Location of file
- Key information saved

---

### Claude context-window runbook (folded in from former `/context` skill)

The statusline shows live context usage:

```
Opus 5 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 65–79% | Save a checkpoint and compact or prepare a handoff |
| 80–89% | Stop expanding scope and run `/handoff` |
| 90%+ | Run `/handoff` **now** |

#### Model degradation thresholds

Degradation is not gradual — it follows a step function. Place critical information at the beginning and end — see `AGENTS.md` "Context Hygiene". Avoid burying key facts in the middle.

| Model | Noticeable degradation | Severe degradation |
|-------|------------------------|--------------------|
| Claude Opus 5 | ~100K tokens | ~180K tokens |
| Claude Sonnet 5 | ~80K tokens | ~150K tokens |
| Claude Haiku 4.5 | ~50K tokens | ~90K tokens |

Sonnet 5's tokenizer is ~30% heavier than Sonnet 4.6's, so it reaches these thresholds on noticeably less actual text — the token counts above are unchanged, but the same conversation fills them faster.

**Key patterns:**
- **Lost-in-middle** — information in the center gets less attention
- **Context poisoning** — a single wrong fact can corrupt reasoning on related topics
- **Context distraction** — irrelevant info degrades performance on a step function, not proportionally

#### Structured compaction template

When compaction is unavoidable, populate this template — each section forces preservation of the dimensions most often lost:

```markdown
## Session Intent
[What the user is trying to accomplish — the "why"]

## Files Modified
- path/to/file.ts: What changed and why

## Files Read (Not Modified)
- path/to/reference.ts: Why it was consulted

## Decisions Made
- Decision 1: Rationale

## Errors Encountered
- Error message → Resolution applied (or "still unresolved")

## Current State
- Build status / test status / what works / what doesn't

## Next Steps
1. Immediate next action
2. Following action
```

The artifact trail (which files were touched, what changed) is universally the weakest dimension after compression. Dedicated sections force preservation of file paths, error messages, and decisions that would otherwise silently drift away.

#### Post-compaction validation

After compaction, probe 3–5 critical facts before continuing work:

1. "What files have I modified in this session?"
2. "What was the last error I encountered?"
3. "What approach did I decide on and why?"
4. "What are the remaining next steps?"

If any probe returns vague or incorrect answers, re-read the handoff file (`/handoff` resume mode) to restore critical context.

#### Reducing context proactively

1. **Use `context: fork`** — skills that fork don't bloat main context
2. **Delegate exploration** — let agents handle research
3. **Clean summaries** — agents return summaries, not raw output
4. **Avoid large file reads** — use TLDR for token-efficient analysis
5. **Offload large tool output** — write outputs >2000 tokens to scratch files; return summary + path
6. **Place critical info at edges** — beginning and end of context get more attention

---

## Mode: Resume

Load state from a previous session and continue work.

### Usage

```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$HANDOFF_RUNNER" resume
```

Or use:
```
/handoff resume
```

### What Gets Loaded

- **Previous task**: What you were working on
- **Progress**: What was completed
- **Decisions**: Key choices made
- **Files modified**: What was changed
- **Next steps**: What remains
- **Context**: Important information

### GitHub Issue Context

Before loading the local handoff, check for a linked GitHub Issue:

```bash
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)

if [[ -n "$ISSUE_NUM" ]]; then
  gh issue view "$ISSUE_NUM" --comments
fi
```

If an issue is found, **present it as the primary context** — it's the shared source of truth. The local handoff supplements it with session-specific details.

Present a combined summary:
- **From GitHub Issue**: Title, task progress (X/Y done), latest comments
- **From local handoff**: Session-specific notes, open files, debug state

### Available Handoffs

In Claude, list handoffs for the current project:
```bash
ls ~/.claude/handoffs/"$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"/
```

### Resume Options

#### Most Recent
```
/handoff
```
Loads the most recent handoff for current project.

#### Specific Handoff
```
/handoff project-name-2024-01-15-1430
```
Loads a specific handoff file.

#### List All
```
/handoff list
```
Shows available handoffs.

#### Clean Old Handoffs
```bash
CC_SETTINGS_HOME="$CC_STATE_ROOT" bun "$HANDOFF_RUNNER" clean [keep]
```
Removes old handoff files, keeping the most recent `keep` (default: 20) of
each type (`.json` and `.md`). SessionStart already prunes down to 20
automatically on every session, so this is only needed for on-demand cleanup
(e.g. `clean 0` to wipe all handoffs).

### Workflow

1. **Check GitHub Issue** - Read linked issue for shared project context
2. **Load local handoff** - Read session-specific state
3. **Review combined context** - Understand where we left off
4. **Verify files** - Check current state vs handoff
5. **Continue work** - Pick up next steps from the issue task list

### Claude automatic session start

When starting a new session, the setup automatically:
- Checks for linked GitHub Issue (reads context)
- Recalls project learnings
- Shows recent handoff if available
- Displays context from previous work
