---
name: context-window-monitor
trigger: context-trigger
description: Monitors context window usage and triggers skill activation warnings
enabled: true
threshold: 0.7
warningThreshold: 0.8
criticalThreshold: 0.9
---

**Purpose:** Prevent context overflow and ensure session handoffs before auto-compaction.

**Integration:** Works with the **Skill Activation System** to display context warnings and trigger handoff requirements.

**Behavior:**

1. **Continuous monitoring:**
   - Track approximate token usage
   - Monitor tool output sizes
   - Write status to `~/.claude/context-usage.json`

2. **Warning levels (aligned with skill-rules.json):**

| Context % | Warning Level | Skill Activation | Action |
|-----------|--------------|------------------|--------|
| 70-79% | 🟡 Notice | `warn` | Consider handoff at stopping point |
| 80-89% | 🟠 Warning | `warn` | Recommend handoff soon |
| 90%+ | 🔴 **CRITICAL** | `block` | **MUST run create_handoff NOW** |

**Actions:**

```
AT 70% usage:
  WRITE context-usage.json { "percent": 70 }
  INJECT "🟡 NOTICE: Consider handoff at stopping point"

AT 80% usage:
  WRITE context-usage.json { "percent": 80 }
  INJECT "🟠 WARNING: Recommend handoff soon"
  SUGGEST /create-handoff
  
AT 90% usage:
  WRITE context-usage.json { "percent": 90 }
  INJECT "🔴 CRITICAL: Run /create-handoff NOW!"
  ACTIVATE_SKILL create_handoff (enforcement: block)
  REQUIRE handoff before continuing
```

**Context Status File:**

```json
// ~/.claude/context-usage.json
{
  "percent": 73,
  "timestamp": "2024-01-15T14:30:22Z",
  "tokensUsed": 73000,
  "tokensMax": 100000
}
```

**Output (via Skill Activation):**

```
🎯 SKILL ACTIVATION CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 CRITICAL: Context at 92% - Run create_handoff NOW!

⚠️  CRITICAL SKILLS (REQUIRED):
   → create_handoff

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Related Commands:**
- `/create-handoff` - Create session handoff
- `/resume-handoff` - Resume from handoff
- `/context` - Check status and compact

**Related Skills:**
- `create_handoff` - Auto-activated at 90%+
- `resume_handoff` - For session resumption
