# Darkroom Claude Code Configuration

Team-shareable Claude Code settings with **native hooks support** and **skill activation system**.

## Quick Setup

```bash
git clone git@github.com:darkroomengineering/claude-config.git /tmp/darkroom-claude
/tmp/darkroom-claude/setup.sh
```

**With TLDR code analysis (recommended):**

```bash
/tmp/darkroom-claude/setup.sh --with-tldr
```

Restart Claude Code to apply changes.

---

## What's Installed

```
~/.claude/
├── CLAUDE.md           # Coding standards
├── settings.json       # Permissions + Native Hooks + MCP servers
├── scripts/            # Hook command scripts
│   ├── session-start.sh
│   ├── post-edit.sh
│   ├── notify.sh
│   ├── skill-activation.sh
│   ├── create-handoff.sh
│   ├── resume-handoff.sh
│   ├── store-learning.sh
│   ├── recall-learnings.sh
│   └── delete-learning.sh
├── skills/             # Skill activation rules
│   └── skill-rules.json
├── agents/             # 9 specialized agents
└── commands/           # 14 slash commands
```

**Optional:** `llm-tldr` for semantic code analysis (install with `--with-tldr`)

---

## Skill Activation System

**You don't need to memorize slash commands.** Just describe what you want naturally.

When you send a message, the `UserPromptSubmit` hook analyzes your intent and suggests relevant skills, workflows, and agents.

### How It Works

| Strategy | What It Matches | Confidence |
|----------|----------------|------------|
| **Keywords** | Simple words like "fix", "debug", "broken" | Medium |
| **Intent Patterns** | Regex patterns like `"fix.*?(bug\|error)"` | High |

### Priority Levels

| Level | Meaning | Example |
|-------|---------|---------|
| ⚠️ **CRITICAL** | Must use (guardrail) | `create_handoff` at 90% context |
| 📚 **RECOMMENDED** | Should use | `fix` workflow for bugs |
| 💡 **SUGGESTED** | Consider using | `premortem` for risk analysis |

### Natural Language Examples

| What You Say | What Activates |
|--------------|----------------|
| "Fix the broken login" | `fix` workflow → explore, implementer, tester |
| "Build a user dashboard" | `build` workflow → planner, scaffolder, implementer |
| "I want to understand this codebase" | `explore` + explore, oracle agents |
| "What could go wrong with this plan?" | `premortem` |
| "Who calls this function?" | `tldr` → semantic analysis (if installed) |
| "Done for today" | `create_handoff` (critical) |
| "Resume where we left off" | `resume_handoff` |

### Context Warnings

| Context % | Warning | Action |
|-----------|---------|--------|
| 70-79% | 🟡 Notice | Consider handoff at stopping point |
| 80-89% | 🟠 Warning | Recommend handoff soon |
| 90%+ | 🔴 **CRITICAL** | **MUST run `/create-handoff` NOW** |

---

## Native Hooks (Real!)

Claude Code has a **native hooks system**. These are real hooks, not behavioral guidance:

### Configured Hooks

| Event | Trigger | Action |
|-------|---------|--------|
| `UserPromptSubmit` | Before Claude sees prompt | **Skill activation analysis** |
| `SessionStart` | New session | Logs session start |
| `PreToolUse` | Before Bash commands | Logs command |
| `PostToolUse` | After Write/Edit | Auto-formats with Biome |
| `PreCompact` | Before context compaction | **Auto-creates handoff** |
| `SessionEnd` | Session ending | **Auto-creates handoff** |
| `Notification` | Task completion | macOS/Linux notification |

### Hook Configuration Format

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "your-script.sh"
          }
        ]
      }
    ]
  }
}
```

### Available Hook Events

| Event | When |
|-------|------|
| `PreToolUse` | Before any tool runs |
| `PostToolUse` | After any tool runs |
| `PermissionRequest` | When permission needed |
| `Notification` | When Claude sends notification |
| `UserPromptSubmit` | When you submit a prompt |
| `Stop` | When Claude stops |
| `SubagentStop` | When subagent stops |
| `PreCompact` | Before context compaction |
| `SessionStart` | When session begins |
| `SessionEnd` | When session ends |

---

## Permissions

Auto-approve safe commands, deny dangerous ones:

```json
{
  "permissions": {
    "allow": ["Bash(bun:*)", "Read(*)", "Write(*)"],
    "deny": ["Bash(rm -rf /)", "Bash(sudo:*)"]
  }
}
```

---

## Agents

| Agent | Purpose |
|-------|---------|
| `planner` | Task breakdown |
| `implementer` | Code execution |
| `reviewer` | Code review |
| `tester` | Test runner |
| `scaffolder` | Boilerplate generation |
| `librarian` | Documentation |
| `explore` | Codebase navigation |
| `oracle` | Q&A expert |
| `maestro` | Multi-agent orchestration |

---

## Commands

| Command | Description |
|---------|-------------|
| `/component <name>` | Create React component |
| `/hook <name>` | Create custom hook |
| `/review` | Code review |
| `/init` | Initialize project |
| `/lenis` | Setup smooth scroll |
| `/explore [target]` | Navigate codebase |
| `/docs <topic>` | Fetch documentation |
| `/context [action]` | Manage context |
| `/orchestrate <task>` | Multi-agent task |
| `/ask <question>` | Ask Oracle |
| `/create-handoff` | Save session state for resumption |
| `/resume-handoff [id]` | Resume from previous handoff |
| `/tldr <action>` | TLDR code analysis (requires llm-tldr) |
| `/learn <action>` | Persistent learnings across sessions |

---

## Adding Custom Hooks

Create your own hooks in `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'File written!' | tee -a ~/.claude/activity.log"
          }
        ]
      }
    ]
  }
}
```

---

## TLDR Code Analysis (Optional)

**[llm-tldr](https://github.com/parcadei/llm-tldr)** provides semantic code search, dependency analysis, and program slicing with **95% token savings**.

### Installation

```bash
# During setup
./setup.sh --with-tldr

# Or manually
pip install llm-tldr
```

> **macOS Apple Silicon**: If you get a `faiss-cpu` dependency error:
> ```bash
> brew install pipx
> pipx install llm-tldr
> ```
> If it still fails, skip `--with-tldr`—the rest of the config works without it.

### First-Time Setup (per project)

```bash
cd /path/to/project
tldr warm .  # Build index (~1-2 min)
```

### Key Commands

| Command | Purpose |
|---------|---------|
| `tldr semantic "auth flow" .` | Natural language search |
| `tldr context loginUser --project .` | LLM-ready summary (95% fewer tokens) |
| `tldr impact validateToken .` | Find all callers |
| `tldr slice src/auth.ts login 42` | Trace what affects line 42 |
| `tldr arch .` | Detect architecture layers |

### MCP Integration

The MCP server is pre-configured in `settings.json`. If `tldr-mcp` isn't found, it gracefully ignores.

```json
{
  "mcpServers": {
    "tldr": {
      "command": "tldr-mcp",
      "args": ["--project", "."]
    }
  }
}
```

### When to Use

| Scenario | Traditional | With TLDR |
|----------|-------------|-----------|
| "How does auth work?" | Read 10+ files | `tldr semantic "authentication"` |
| "Who calls this?" | `grep -r` + manual tracing | `tldr impact functionName` |
| "Why is X null?" | Read entire function | `tldr slice file func line` |
| "Explain this function" | Paste 500 lines | `tldr context func` (95% smaller) |

---

## Documentation

- **[USAGE.md](./USAGE.md)** - Daily workflow guide, commands, agents, examples
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Plugins Reference](https://code.claude.com/docs/en/plugins)
- [Settings Reference](https://code.claude.com/docs/en/settings)
- [llm-tldr GitHub](https://github.com/parcadei/llm-tldr)

---

## Comparison with OpenCode

| Feature | OpenCode | Claude Code | This Config |
|---------|----------|-------------|-------------|
| Native hooks | ✅ | ✅ | ✅ |
| Slash commands | ✅ | ✅ | ✅ (14) |
| Custom agents | ✅ | ✅ | ✅ (9) |
| Permissions | ✅ | ✅ | ✅ |
| Plugins | ✅ | ✅ | ✅ |
| Skills | ✅ | ✅ | ✅ (19 skills) |
| Session handoffs | ✅ | ✅ | ✅ |
| MCP servers | ✅ | ✅ | ✅ (tldr-mcp) |
| Visual HUD | ✅ | ❌ | ❌ |
| Side panel | ✅ | ❌ | ❌ |

**Note**: Visual HUD/side panel is the main feature OpenCode has that Claude Code doesn't support natively.

---

## Contributing

1. Edit your local `~/.claude/` config
2. Test with Claude Code
3. Copy to this repo and submit PR
