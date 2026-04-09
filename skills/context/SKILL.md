---
name: context
description: |
  Use when:
  - User asks about "context window", "context usage", "context limit"
  - User mentions "running out of context", "context full"
  - User wants to "compact", "clear context", "optimize context"
  - Context is getting full and needs management
---

# Context Window Management

Monitor and manage Claude Code context window usage.

## Watch the Statusline

The statusline shows live context usage:

```
Opus 4.6 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 70-79% | Consider wrapping up or handing off |
| 80-89% | Start wrapping up |
| 90%+ | Run `/create-handoff` now |

## Model Degradation Thresholds

Context degradation is not gradual — it follows a step function. Place critical information at the **beginning** and **end** of context (attention-favored positions). Avoid burying important facts in the middle.

| Model | Noticeable Degradation | Severe Degradation |
|-------|------------------------|-------------------|
| Claude Opus 4.6 | ~100K tokens | ~180K tokens |
| Claude Sonnet 4.6 | ~80K tokens | ~150K tokens |
| Claude Haiku 4.5 | ~50K tokens | ~90K tokens |

**Key patterns:**
- **Lost-in-middle**: Information in the center of context gets less attention
- **Context poisoning**: A single wrong fact in context can corrupt reasoning on related topics
- **Context distraction**: Irrelevant information degrades performance on a step function, not proportionally

## Managing Context

### Create Handoff Before Compacting
```
/create-handoff
```

This saves:
- Current task state
- Key decisions made
- Files modified
- Next steps

### Compact Context
```
/compact
```

Reduces context by summarizing earlier conversation.

### Resume After Compact
```
/resume-handoff
```

Restores context from handoff file.

## Structured Compaction Template

When compacting, use this structured format to prevent silent information loss. Each section acts as a checklist the summarizer must populate:

```markdown
## Session Intent
[What the user is trying to accomplish — the "why"]

## Files Modified
- path/to/file.ts: What changed and why
- path/to/other.ts: What changed and why

## Files Read (Not Modified)
- path/to/reference.ts: Why it was consulted

## Decisions Made
- Decision 1: Rationale
- Decision 2: Rationale

## Errors Encountered
- Error message or symptom → Resolution applied
- Error message or symptom → Still unresolved

## Current State
- Build status (passing/failing)
- Test status (X passing, Y failing)
- What's working, what isn't

## Next Steps
1. Immediate next action
2. Following action
3. Remaining work
```

**Why structure matters**: The artifact trail (which files were touched, what changed) is universally the weakest dimension after compression, scoring 2.2-2.5/5.0 even with structured summaries. Dedicated sections force preservation of file paths, error messages, and decisions that would otherwise silently drift away.

## Post-Compaction Validation

After compaction, verify quality with 3-5 probe questions before continuing work:

1. "What files have I modified in this session?"
2. "What was the last error I encountered?"
3. "What approach did I decide on and why?"
4. "What are the remaining next steps?"

If any probe returns vague or incorrect answers, re-read the handoff file (`/resume-handoff`) to restore critical context. Traditional metrics (ROUGE, embedding similarity) fail to capture functional compression quality — probing tests whether the information the agent actually needs survived.

## Tips for Reducing Context

1. **Use `context: fork`** - Skills that fork don't bloat main context
2. **Delegate exploration** - Let agents handle research
3. **Clean summaries** - Agents return summaries, not raw output
4. **Avoid large file reads** - Use TLDR for token-efficient analysis
5. **Offload tool output** - Write outputs >2000 tokens to scratch files, return summary + path
6. **Place critical info at edges** - Beginning and end of context get more attention

## When Context is Full

1. **Don't panic** - Your work isn't lost
2. **Create handoff** - Save current state
3. **Compact** - Let Claude summarize using structured template above
4. **Validate** - Probe 3-5 critical facts
5. **Resume** - Pick up where you left off

## Automatic Protection

The setup includes:
- Warning at 70%, 80%, 90% thresholds
- Auto-handoff before compaction (PreCompact hook)
- Session start recalls relevant learnings

## Output

Report:
- **Current usage**: X% of context
- **Recommendation**: Action to take
- **Next steps**: What to do
