---
name: context-window-monitor
trigger: context-trigger
description: Monitors context window usage and triggers skill activation warnings
enabled: partial
threshold: 0.7
warningThreshold: 0.8
criticalThreshold: 0.9
---

> **Implementation Status:** Context monitoring is integrated into the statusline (`statusline.sh`) and skill-activation system (`skill-activation.sh`), not registered as a standalone hook in `settings.json`. The behavior described below is the target design.

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
| 70-79% | 🟡 Notice | `warn` | Save checkpoint, consider handoff at stopping point |
| 80-89% | 🟠 Warning | `warn` | Save checkpoint + commit completed work, recommend handoff soon |
| 90%+ | 🔴 **CRITICAL** | `block` | Save checkpoint + handoff notes, **MUST run create_handoff NOW** |

> **Note:** Checkpoints and handoffs are complementary. Checkpoints are lightweight, frequent snapshots of task state (`/checkpoint save`). Handoffs are comprehensive session transfers (`/create-handoff`). At each threshold, save a checkpoint first, then follow the handoff guidance. See `hooks/checkpoint.md` for checkpoint details.

**Actions:**

```
AT 70% usage:
  RUN /checkpoint save "Auto-checkpoint at 70% context"
  WRITE context-usage.json { "percent": 70 }
  INJECT "🟡 NOTICE: Checkpoint saved. Consider handoff at stopping point"

AT 80% usage:
  RUN /checkpoint save "Auto-checkpoint at 80% context"
  RUN git commit (completed work)
  WRITE context-usage.json { "percent": 80 }
  INJECT "🟠 WARNING: Checkpoint saved + work committed. Recommend handoff soon"
  SUGGEST /create-handoff

AT 90% usage:
  RUN /checkpoint save "Auto-checkpoint at 90% context — preparing handoff"
  WRITE context-usage.json { "percent": 90 }
  INJECT "🔴 CRITICAL: Checkpoint saved. Run /create-handoff NOW!"
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
