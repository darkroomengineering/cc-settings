---
name: create-handoff
description: End-of-session boundary marker — persist session state for later pickup before a break, compaction, or task switch. For mid-task rollback points before risky operations, use `/checkpoint` instead. Triggers "done for today", "ending session", "handoff", "pause work", "wrapping up", "context window", "running out of context", "save my work for later", context >80%.
---

# Create Session Handoff

Save current session state for later resumption. This is the **end-of-session boundary** skill — for mid-task rollback points before risky operations, use `/checkpoint`.

## Usage

```bash
bun ~/.claude/src/scripts/handoff.ts create
```

Or use the native command:
```
/create-handoff
```

## What Gets Saved

The handoff file includes:
- **Current task**: What you're working on
- **Progress**: What's been completed
- **Decisions made**: Key choices and rationale
- **Files modified**: List of changed files
- **Next steps**: What remains to be done
- **Context**: Important information to remember
- **Learnings**: Patterns discovered in session

## GitHub Issue Sync

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

## Handoff Location

```
~/.claude/handoffs/
├── project-name-2024-01-15-1430.md
├── project-name-2024-01-14-0900.md
└── ...
```

## When to Create Handoff

1. **End of work session** - Before closing Claude Code
2. **Context at 80%+** - Before auto-compaction
3. **Taking a break** - Preserve state for later
4. **Switching tasks** - Save before context switch
5. **Before compacting** - Auto-triggered by PreCompact hook

## Auto-Handoff

The setup automatically creates handoffs:
- Before context compaction (PreCompact hook)
- At session end (SessionEnd hook)

## Output

Confirms:
- Handoff file created (and GitHub Issue updated if linked)
- Location of file
- Key information saved

## Resume Later

To resume from a handoff:
```
/resume-handoff
```

This loads the most recent handoff for the current project.

---

## Context Window Runbook (folded in from former `/context` skill)

The statusline shows live context usage:

```
Opus 4.7 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 70–79% | Consider wrapping up or handing off |
| 80–89% | Start wrapping up — run `/create-handoff` |
| 90%+ | Run `/create-handoff` **now** |

### Model degradation thresholds

Degradation is not gradual — it follows a step function. Place critical information at the **beginning** and **end** of context (attention-favored positions). Avoid burying key facts in the middle.

| Model | Noticeable degradation | Severe degradation |
|-------|------------------------|--------------------|
| Claude Opus 4.7 | ~100K tokens | ~180K tokens |
| Claude Sonnet 4.7 | ~80K tokens | ~150K tokens |
| Claude Haiku 4.5 | ~50K tokens | ~90K tokens |

**Key patterns:**
- **Lost-in-middle** — information in the center gets less attention
- **Context poisoning** — a single wrong fact can corrupt reasoning on related topics
- **Context distraction** — irrelevant info degrades performance on a step function, not proportionally

### Structured compaction template

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

### Post-compaction validation

After compaction, probe 3–5 critical facts before continuing work:

1. "What files have I modified in this session?"
2. "What was the last error I encountered?"
3. "What approach did I decide on and why?"
4. "What are the remaining next steps?"

If any probe returns vague or incorrect answers, re-read the handoff file (`/resume-handoff`) to restore critical context.

### Reducing context proactively

1. **Use `context: fork`** — skills that fork don't bloat main context
2. **Delegate exploration** — let agents handle research
3. **Clean summaries** — agents return summaries, not raw output
4. **Avoid large file reads** — use TLDR for token-efficient analysis
5. **Offload large tool output** — write outputs >2000 tokens to scratch files; return summary + path
6. **Place critical info at edges** — beginning and end of context get more attention
