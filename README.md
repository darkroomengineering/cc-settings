# Darkroom Claude Code Configuration

Team-shareable Claude Code settings with **native hooks**, **skill activation**, and **persistent learnings**.

## Quick Setup

```bash
git clone git@github.com:darkroomengineering/cc-settings.git /tmp/darkroom-claude
bash /tmp/darkroom-claude/setup.sh
```

**With TLDR code analysis:**

```bash
bash /tmp/darkroom-claude/setup.sh --with-tldr
```

Restart Claude Code to apply changes.

---

## What's Installed

```
~/.claude/
├── CLAUDE.md           # Coding standards
├── settings.json       # Permissions + Hooks + MCP
├── scripts/            # 12 scripts
├── skills/             # 19 skill rules
├── agents/             # 9 specialized agents
└── commands/           # 14 slash commands
```

---

## Core Features

### Skill Activation
**Just describe what you want.** The `UserPromptSubmit` hook analyzes your intent and suggests skills, workflows, and agents.

```
"Fix the broken login" → fix workflow → explore, implementer, tester
"Build a dashboard"    → build workflow → planner, scaffolder, implementer
"Done for today"       → create_handoff (critical)
```

### Statusline
Custom status bar showing model, directory, git branch with status, and context window usage:

```
Claude 4.5 Opus | my-project | main✱↑ | ████░░░░░░ 42% (84k/200k)
```

- Branch name in cyan
- `✱` (yellow) = uncommitted changes
- `↑` = unpushed commits, `↓` = behind remote

Enable in `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/.claude/scripts/statusline.sh\""
  }
}
```

### Native Hooks
Real shell scripts triggered at specific events:

| Event | Action |
|-------|--------|
| `UserPromptSubmit` | Skill activation |
| `SessionStart` | Recalls learnings |
| `PostToolUse` | Auto-format, TLDR tracking |
| `PreCompact` / `SessionEnd` | Auto-handoff |

### Persistent Learnings
Store insights that survive across sessions:

```
/learn store bug "useAuth causes hydration - use dynamic import"
/learn recall all
```

### MCP Servers

| Server | Purpose |
|--------|---------|
| **Context7** | Up-to-date library docs (add "use context7" to prompts) |
| **Sanity** | CMS operations - GROQ, documents, releases, schemas |
| **TLDR** | Semantic search, impact analysis (95% token savings) |

```bash
# Sanity MCP (OAuth required on first use)
# Just works - prompts for auth when needed

# TLDR setup (optional)
brew install pipx && pipx ensurepath  # If you don't have pipx
pipx install llm-tldr  # One-time
tldr warm .            # Per project, optional flag: --lang typescript
```

See [Sanity MCP docs](https://www.sanity.io/docs/compute-and-ai/mcp-server) for full capabilities.

---

## Quick Reference

| Want To... | Do This |
|------------|---------|
| Understand code | "How does X work?" |
| Build feature | "Build a..." |
| Fix bug | "Fix the..." |
| Find callers | `tldr impact func .` |
| Save insight | `/learn store bug "..."` |
| End session | "Done for today" |
| Resume | "Resume where we left off" |

---

## Documentation

| Doc | Content |
|-----|---------|
| **[USAGE.md](./USAGE.md)** | Daily workflow, all commands, agents, examples |
| **[hooks/README.md](./hooks/README.md)** | Native hooks configuration |
| **[skills/README.md](./skills/README.md)** | Skill activation details |
| **[commands/learn.md](./commands/learn.md)** | Learning system reference |

---

## Agents

`@planner` `@implementer` `@reviewer` `@tester` `@scaffolder` `@librarian` `@explore` `@oracle` `@maestro`

## Commands

`/component` `/hook` `/review` `/init` `/lenis` `/explore` `/docs` `/context` `/orchestrate` `/ask` `/create-handoff` `/resume-handoff` `/tldr` `/learn`

---

## Contributing

1. Edit your local `~/.claude/` config
2. Test with Claude Code
3. Copy to this repo and submit PR
