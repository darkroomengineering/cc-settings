---
name: consolidate
description: |
  Use when:
  - User says "consolidate", "clean up rules", "simplify config"
  - User mentions "contradictions", "too many rules", "bloated"
  - User says "spa day", "maintenance", "spring cleaning"
  - User asks to "review skills", "audit rules", "prune learnings"
  - Agent performance seems to have degraded
  - Rules or skills have been added incrementally over time
  - User says "what's redundant", "what can we remove"
context: fork
---

# Consolidate Rules, Skills, and Learnings

Prevent context bloat and contradictions by periodically auditing, merging, and pruning.

## Phase 1: Audit

### Count everything
```bash
echo "Rules:" && ls ~/.claude/rules/*.md 2>/dev/null | wc -l
echo "Skills:" && ls -d ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l
echo "Learnings:" && bun ~/.claude/src/scripts/learning.ts recall all 2>/dev/null | wc -l
echo "CLAUDE.md lines:" && wc -l ~/.claude/CLAUDE.md 2>/dev/null
echo "AGENTS.md lines:" && wc -l ~/.claude/AGENTS.md 2>/dev/null
```

### Check for contradictions
Read all rules and flag:
- Opposites ("always X" in one, "never X" in another)
- Significant overlap (two rules covering the same concern)
- References to outdated tools, patterns, or dependencies
- Vague rules that aren't actionable

### Check skill triggers
Read all skill descriptions and flag:
- Overlapping trigger phrases between skills
- Skills that never get invoked (ask the user)
- Outdated instructions

## Phase 2: Merge and Deduplicate

### Rules
- Merge rules covering the same concern
- Remove rules that duplicate AGENTS.md guardrails
- Remove rules for problems that no longer occur
- Tighten vague rules into specific instructions

### Skills
- Merge skills with overlapping triggers
- Remove unused skills
- Update outdated instructions
- Ensure distinct, non-overlapping trigger phrases

### Learnings
```bash
bun ~/.claude/src/scripts/learning.ts prune 90
```
- Remove learnings about long-fixed bugs
- Remove learnings about deprecated patterns
- Consolidate similar learnings into one

## Phase 3: Simplify CLAUDE.md

CLAUDE.md should be a routing table:
- Points to AGENTS.md for standards
- Points to rules for specific concerns
- Points to skills for specific workflows
- Minimal inline content

If it exceeds ~100 lines of content, extract inline sections into rules or skills.

## Phase 4: Verify

1. Start a fresh Claude Code session
2. Test that key skills still trigger
3. Verify no regressions in agent behavior
4. Ask the user about rules you're unsure about

## Output Format

```markdown
## Consolidation Report

### Changes Made
- Merged: [list]
- Removed: [list]
- Updated: [list]

### Current State
- Rules: N (was M)
- Skills: N (was M)
- Learnings: N (was M)
- CLAUDE.md: N lines (was M)

### Flagged for User Review
- [Item]: [Why it needs human judgment]

### Recommendations
- [Further cleanup suggestions]
```

## Remember

- Ask before deleting — the user may have reasons you don't see
- Fix contradictions first — they cause the most confusion
- Overlapping triggers cause skill mis-invocation
- 10 sharp rules beat 30 vague ones
