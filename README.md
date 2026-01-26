# Darkroom Claude Code Configuration

Team-shareable Claude Code settings with **auto-orchestration**, **natural language skills**, **TLDR-first exploration**, and **persistent learnings**.

## Installation

### Option 1: Plugin Install (Recommended)

In Claude Code, run:

```
/plugins install darkroomengineering/cc-settings
```

This installs the plugin from GitHub and enables all features automatically.

### Option 2: Setup Script

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

Or clone and run locally:

```bash
git clone git@github.com:darkroomengineering/cc-settings.git /tmp/darkroom-claude
bash /tmp/darkroom-claude/setup.sh
```

**Script Options:**
- `--minimal` - Skip optional tools (agent-browser, tldr)
- `--skip-deps` - Skip all dependency installation

### Dependencies

The setup script auto-installs:
- **jq** - Required for learnings, statusline
- **llm-tldr** - Semantic code search (95% token savings)
- **agent-browser** - AI-optimized browser automation

Restart Claude Code to apply changes.

---

## Philosophy

**You don't need to memorize commands.** Just describe what you want naturally.

Claude automatically:
1. Recognizes intent from your message
2. Invokes the appropriate skill
3. Delegates to specialized agents
4. Returns a clean summary

```
You: "Fix the auth bug"

Claude automatically:
→ Invokes fix skill
→ Spawns explore agent (investigate)
→ Spawns implementer agent (fix)
→ Spawns tester agent (verify)
→ Returns summary
```

---

## What Gets Installed

```
~/.claude/
├── CLAUDE.md           # Coding standards + orchestration mode
├── settings.json       # Permissions + Hooks + MCP
├── agents/             # 10 specialized agents (TLDR-enforced)
├── skills/             # 23 auto-invocable skills (SKILL.md format)
├── contexts/           # 4 ecosystem contexts (web, webgl, desktop, mobile)
├── rules/              # 7 path-conditioned rule files
├── profiles/           # 4 stack-specific profiles
├── mcp-configs/        # MCP server templates
├── scripts/            # 12 hook scripts
├── lib/                # 5 shared bash utilities
├── learnings/          # Persistent project memory
├── handoffs/           # Session state backups
└── tldr-cache/         # TLDR warm status
```

---

## Core Features

### Auto-Orchestration (Maestro Mode)

Claude defaults to **orchestration mode**—coordinating agents rather than executing directly.

| You Say | Claude Does |
|---------|-------------|
| "Fix the broken login" | `explore` → `implementer` → `tester` |
| "Build a dashboard" | `planner` → `scaffolder` → `implementer` |
| "How does auth work?" | `explore` with TLDR semantic search |
| "Review my changes" | `reviewer` agent |
| "Done for today" | `create-handoff` (critical) |

### Skills Auto-Invoke

Skills use the native `SKILL.md` format with intent-based descriptions. Claude reads these descriptions and **automatically invokes** the right skill based on your conversation.

| Natural Language | Skill Invoked | What Happens |
|-----------------|---------------|--------------|
| "fix", "broken", "bug" | `fix` | explore → implement → test |
| "build", "create", "add feature" | `build` | plan → scaffold → implement |
| "how does X work?" | `explore` | TLDR semantic + context |
| "refactor", "clean up" | `refactor` | explore → implement → review |
| Non-obvious fix discovered | `learn` | **Auto-stores** the insight |

### TLDR-First Exploration

All agents enforce **TLDR usage** for 95% token savings:

```bash
# Instead of reading files...
tldr context functionName --project .   # LLM-ready summary
tldr semantic "authentication flow" .   # Find by meaning
tldr impact functionName .              # Who calls this?
tldr slice file.ts func 42              # What affects line 42?
```

Agents have "Forbidden" lists that prohibit reading raw files when TLDR would suffice.

### Auto-Learning

The `learn` skill **auto-invokes** when Claude discovers something worth remembering:
- Non-obvious bug fixes
- Useful patterns
- Gotchas and edge cases
- Architecture decisions

Learnings persist across sessions and are recalled on session start.

### Statusline

Custom status bar showing model, directory, git branch with status, and context window usage:

```
Claude 4.5 Opus | my-project | main✱↑ | ████░░░░░░ 42% (84k/200k)
```

---

## Natural Language Examples

| What You Say | What Happens |
|--------------|--------------|
| "Fix the broken login" | fix workflow (explore → tester → implementer) |
| "Build a user dashboard" | build workflow (planner → scaffolder → implementer) |
| "How does auth work?" | explore agent with TLDR |
| "Review my changes" | reviewer agent |
| "Create a Button component" | scaffolder agent |
| "What could go wrong?" | premortem analysis |
| "Done for today" | saves session state |
| "Resume where we left off" | loads previous handoff |

---

## Skills Reference

### Workflows (Multi-Agent)
| Skill | Triggers | Agents |
|-------|----------|--------|
| `fix` | bug, broken, error, not working | explore → tester → implementer |
| `build` | build, create, implement, add feature | planner → scaffolder → implementer |
| `refactor` | refactor, clean up, reorganize | explore → implementer → reviewer |
| `review` | review, check, PR | reviewer |
| `test` | test, write tests, coverage | tester |
| `orchestrate` | complex task, coordinate | maestro |

### Research (Forked Context)
| Skill | Triggers |
|-------|----------|
| `explore` | how does, where is, find, understand |
| `docs` | documentation, how to use, API |
| `ask` | advice, guidance, what should I |
| `tldr` | who calls, dependencies, semantic search |
| `premortem` | risks, what could go wrong |
| `discovery` | requirements, scope, figure out |

### Creation (Direct Output)
| Skill | Triggers |
|-------|----------|
| `component` | create component, new component |
| `hook` | create hook, custom hook |
| `init` | new project, initialize |

### Session Management
| Skill | Triggers |
|-------|----------|
| `learn` | **AUTO**: after discoveries |
| `context` | context window, running out |
| `create-handoff` | done for today, save state |
| `resume-handoff` | resume, continue, last session |

---

## Agents

All agents are **TLDR-enforced** with mandatory commands and forbidden actions.

| Agent | Purpose | TLDR Commands |
|-------|---------|---------------|
| `explore` | Codebase navigation | `semantic`, `arch`, `context` |
| `oracle` | Expert Q&A | `context`, `semantic`, `impact`, `slice` |
| `planner` | Task breakdown | `arch`, `impact`, `calls` |
| `implementer` | Code execution | `context`, `impact`, `slice` |
| `reviewer` | Code review | `impact`, `context`, `change-impact` |
| `tester` | Testing | `change-impact`, `impact`, `context` |
| `scaffolder` | Boilerplate | `semantic`, `structure`, `context` |
| `librarian` | Documentation | `semantic`, `context`, `arch`, `calls` |
| `maestro` | Multi-agent coordination | All commands |
| `security-reviewer` | Security audit | `semantic`, `slice`, `dfg`, `impact` |

---

## Rules (Path-Conditioned)

Rules load automatically based on file context:

| Rule | Loaded When |
|------|-------------|
| `react.md` | Working with `.tsx`, `.jsx`, `components/` |
| `typescript.md` | Working with `.ts`, `.tsx` |
| `style.md` | Working with CSS, SCSS, styled components |
| `accessibility.md` | Working with UI components |
| `security.md` | Working with API routes, lib code, env files |
| `performance.md` | Working with app code or components |
| `git.md` | Always loaded |

---

## Ecosystem Contexts

Switch contexts for different platforms:

```bash
/context web      # Default - Next.js, React, Tailwind
/context webgl    # R3F, Three.js, GSAP, shaders
/context desktop  # Tauri (Rust + Web)
/context mobile   # Expo (React Native)
```

---

## MCP Servers

| Server | Purpose | Status |
|--------|---------|--------|
| **context7** | Up-to-date library docs | Auto-configured |
| **Sanity** | CMS operations (GROQ, documents) | OAuth on first use |
| **tldr** | Semantic search, impact analysis | Auto-installed |

---

## Native Hooks

| Event | Action |
|-------|--------|
| `SessionStart` | Recalls learnings, auto-warms TLDR |
| `SubagentStart/Stop` | Swarm logging |
| `PostToolUse` | TLDR tracking (async) |
| `PreCompact` / `SessionEnd` | Auto-handoff |

---

## Quick Reference

| Want To... | Just Say... |
|------------|-------------|
| Understand code | "How does X work?" |
| Build feature | "Build a..." |
| Fix bug | "Fix the..." |
| Review code | "Review my changes" |
| Find callers | "Who calls X?" |
| End session | "Done for today" |
| Resume | "Resume where we left off" |
| Debug visually | "Take a screenshot of..." |
| Security audit | "Check for security issues" |

---

## Documentation

| Doc | Content |
|-----|---------|
| **[USAGE.md](./USAGE.md)** | Daily workflow, examples |
| **[skills/README.md](./skills/README.md)** | Skill system details |
| **[hooks/README.md](./hooks/README.md)** | Native hooks configuration |
| **[rules/README.md](./rules/README.md)** | Path-conditioned rules |
| **[mcp-configs/README.md](./mcp-configs/README.md)** | MCP server setup |
| **[contexts/README.md](./contexts/README.md)** | Ecosystem contexts |

---

## Platform Support

- **macOS** - Native (Homebrew for dependencies)
- **Linux** - Native (apt, dnf, pacman)
- **Windows** - Via Git Bash, WSL, or MSYS2

---

## Contributing

1. Edit your local `~/.claude/` config
2. Test with Claude Code
3. Copy to this repo and submit PR
