# Skill Activation System

**You don't need to memorize slash commands.** Just describe what you want naturally.

## How It Works

When you send a message, the `UserPromptSubmit` hook analyzes your intent and suggests relevant skills, workflows, and agents.

```
> "Fix the login bug in auth.ts"

🎯 SKILL ACTIVATION CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 RECOMMENDED SKILLS:
   → fix

🤖 RECOMMENDED AGENTS:
   → explore, implementer, tester

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Matching Strategies

| Strategy | What It Matches | Confidence |
|----------|----------------|------------|
| **Keywords** | Simple words like "fix", "debug", "broken" | Medium |
| **Intent Patterns** | Regex patterns like `"fix.*?(bug\|error)"` | High |

## Priority Levels

| Level | Meaning | Enforcement |
|-------|---------|-------------|
| ⚠️ **CRITICAL** | Must use before proceeding | `block` |
| 📚 **RECOMMENDED** | Should use | `suggest` |
| 💡 **SUGGESTED** | Consider using | `suggest` |
| ❓ **AMBIGUOUS** | Validate before activating | `warn` |

## Skill Types

| Type | Purpose | Example |
|------|---------|---------|
| **skill** | Single-purpose tool | `commit`, `explore`, `docs` |
| **workflow** | Multi-step process | `/fix`, `/build`, `/refactor` |

## Context Warnings

| Context % | Warning | Skill Triggered |
|-----------|---------|-----------------|
| 70-79% | 🟡 Notice | — |
| 80-89% | 🟠 Warning | — |
| 90%+ | 🔴 **CRITICAL** | `create_handoff` (enforcement: block) |

## Adding Custom Skills

Edit `skill-rules.json` to add your own skills:

```json
{
  "skills": {
    "my-skill": {
      "type": "skill",
      "enforcement": "suggest",
      "priority": "medium",
      "description": "What this skill does",
      "promptTriggers": {
        "keywords": ["/my-skill", "trigger phrase"],
        "intentPatterns": ["regex.*?pattern"]
      },
      "agents": ["agent1", "agent2"]
    }
  }
}
```

### Trigger Configuration

```json
{
  "promptTriggers": {
    "keywords": [
      "/my-skill",           // Slash command
      "exact phrase",        // Exact match (case-insensitive)
      "another trigger"
    ],
    "intentPatterns": [
      "what.*?could.*?go wrong",  // Regex pattern
      "(broken|not working)"       // Alternatives
    ]
  }
}
```

### Enforcement Levels

| Level | Behavior |
|-------|----------|
| `"block"` | Must use skill before proceeding (guardrail) |
| `"suggest"` | Shows suggestion, doesn't block |
| `"warn"` | Shows warning, allows proceeding |

### Ambiguous Keywords

Some keywords appear in casual conversation. Mark them as ambiguous:

```json
{
  "test": {
    "ambiguous": true,
    ...
  }
}
```

These get flagged for validation:

```
❓ AMBIGUOUS MATCHES (validate before activating):
   test [skill] - validate if testing is requested
```

## Session Handoffs

The skill activation system integrates with session handoffs:

- **create_handoff** - Auto-suggested at 80%+, required at 90%+
- **resume_handoff** - Activated when resuming sessions

### Handoff Storage

```
~/.claude/handoffs/
├── handoff_20240115_143022.json   # Machine-readable
├── handoff_20240115_143022.md     # Human-readable
├── latest.json                     # Symlink to latest
└── latest.md                       # Symlink to latest
```

## Files

| File | Purpose |
|------|---------|
| `skill-rules.json` | Skill definitions and triggers |
| `~/.claude/scripts/skill-activation.sh` | UserPromptSubmit hook script |
| `~/.claude/context-usage.json` | Context tracking (written by hooks) |

## Natural Language Examples

| What You Say | Skills/Agents Activated |
|--------------|------------------------|
| "Fix the broken login" | `fix` → explore, implementer, tester |
| "Build a user dashboard" | `build` → planner, scaffolder, implementer |
| "Understand this codebase" | `explore` → explore, oracle |
| "What could go wrong?" | `premortem` → oracle, reviewer |
| "Done for today" | `create_handoff` (critical) |
| "Continue where we left off" | `resume_handoff` |
| "Review this code" | `review` → reviewer, tester |
| "Create a component" | `component` → scaffolder |
| "Remember this for next time" | `learn` → store learning |
| "What did we learn?" | `learn` → recall learnings |

## Debugging

Check skill activation output:

```bash
cat ~/.claude/skill-activation.out
```

Check context usage:

```bash
cat ~/.claude/context-usage.json
```

List available handoffs:

```bash
ls ~/.claude/handoffs/*.md
```
