# Darkroom Claude Code Configuration

Team-shareable Claude Code settings with **native hooks**, **skill activation**, **ecosystem contexts**, and **persistent learnings**.

## One-Liner Setup

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

Or clone and run locally:

```bash
git clone git@github.com:darkroomengineering/cc-settings.git /tmp/darkroom-claude
bash /tmp/darkroom-claude/setup.sh
```

**Options:**
- `--minimal` - Skip optional tools (agent-browser, tldr)
- `--skip-deps` - Skip all dependency installation

The setup script auto-installs:
- **jq** - Required for learnings, statusline
- **agent-browser** - AI-optimized browser automation
- **llm-tldr** - Semantic code search (auto-warms on session start)

Restart Claude Code to apply changes.

---

## What Gets Installed

```
~/.claude/
├── CLAUDE.md           # Coding standards
├── settings.json       # Permissions + Hooks + MCP
├── agents/             # 10 specialized agents
├── commands/           # 17 slash commands
├── contexts/           # 4 ecosystem contexts (web, webgl, desktop, mobile)
├── rules/              # 7 modular rule files
├── profiles/           # 4 stack-specific profiles
├── mcp-configs/        # MCP server templates
├── scripts/            # 12 hook scripts
├── skills/             # 23 skill rules
├── lib/                # 5 shared bash utilities
├── learnings/          # Persistent project memory
├── handoffs/           # Session state backups
└── tldr-cache/         # TLDR warm status
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

### Native Hooks

| Event | Action |
|-------|--------|
| `SessionStart` | Recalls learnings, auto-warms TLDR |
| `UserPromptSubmit` | Skill activation |
| `PostToolUse` | TLDR tracking, console.log warnings, TypeScript checks |
| `PreToolUse` | Pre-push review reminder |
| `PreCompact` / `SessionEnd` | Auto-handoff |
| `Stop` | Session evaluation, learning reminder |

### Persistent Learnings
Store insights that survive across sessions:

```
/learn store bug "useAuth causes hydration - use dynamic import"
/learn recall all
```

### Auto-Warming TLDR
On session start, the system automatically:
1. Detects project type (TypeScript, Rust, Go, Python)
2. Warms the TLDR index in background
3. Enables semantic code search without manual setup

---

## Ecosystem Contexts

Switch contexts when working in unfamiliar ecosystems. No configuration needed—just switch and go.

```bash
/context web      # Default - Next.js, React, Tailwind (Darkroom patterns)
/context webgl    # R3F, Three.js, GSAP, shaders
/context desktop  # Tauri for macOS/Windows/Linux (Rust + Web)
/context mobile   # Expo for iOS/Android (React Native)
```

Each context loads:
- Behavioral priorities (stability vs speed, etc.)
- Ecosystem-specific patterns and gotchas
- Favored tools and commands
- Relevant documentation sources

See [contexts/](./contexts/) for full details.

---

## Modular Rules

Rules are extracted into focused files for easier maintenance:

| Rule | Focus |
|------|-------|
| `rules/security.md` | Secrets, input validation, OWASP |
| `rules/typescript.md` | Strict mode, no `any`, narrowing |
| `rules/react.md` | Server Components, no manual memo |
| `rules/performance.md` | Waterfalls, bundles, lazy loading |
| `rules/accessibility.md` | WCAG 2.1, aria, semantic HTML |
| `rules/git.md` | Conventional commits, no force push |
| `rules/style.md` | CSS modules, Tailwind conventions |

Disable per-project in `.claude/settings.json`:
```json
{
  "disabledRules": ["rules/style.md"]
}
```

---

## MCP Servers

| Server | Purpose | Status |
|--------|---------|--------|
| **context7** | Up-to-date library docs | Auto-configured |
| **Sanity** | CMS operations (GROQ, documents) | OAuth on first use |
| **tldr** | Semantic search, impact analysis | Auto-installed |

Additional server templates in [mcp-configs/](./mcp-configs/):
- `recommended.json` - context7, vercel, memory
- `optional.json` - railway, supabase, cloudflare, github, firecrawl, etc.
- `project-example.json` - Per-project configuration examples

## CLI Tools

| Tool | Purpose | Status |
|------|---------|--------|
| **agent-browser** | AI-optimized browser automation | Auto-installed |

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
| Debug visually | "Take a screenshot of..." |
| Build desktop app | `/context desktop` |
| Build mobile app | `/context mobile` |
| Security review | "Review for security issues" |
| Check accessibility | `/qa` |

---

## Agents

`@planner` `@implementer` `@reviewer` `@security-reviewer` `@tester` `@scaffolder` `@librarian` `@explore` `@oracle` `@maestro`

**New:** `@security-reviewer` - OWASP Top 10, secret detection, Shopify/Sanity-specific checks

## Commands

`/component` `/hook` `/review` `/init` `/lenis` `/explore` `/docs` `/context` `/orchestrate` `/ask` `/create-handoff` `/resume-handoff` `/tldr` `/learn` `/debug` `/qa` `/versions`

**Enhanced:** `/context` now supports ecosystem switching (`/context ios`, `/context macos`, etc.)

---

## Documentation

| Doc | Content |
|-----|---------|
| **[USAGE.md](./USAGE.md)** | Daily workflow, all commands, agents, examples |
| **[hooks/README.md](./hooks/README.md)** | Native hooks configuration |
| **[skills/README.md](./skills/README.md)** | Skill activation details |
| **[rules/README.md](./rules/README.md)** | Modular rules system |
| **[mcp-configs/README.md](./mcp-configs/README.md)** | MCP server setup guide |
| **[commands/learn.md](./commands/learn.md)** | Learning system reference |
| **[commands/context.md](./commands/context.md)** | Ecosystem context switching |

---

## Platform Support

The setup script and hooks work on:
- **macOS** - Native (Homebrew for dependencies)
- **Linux** - Native (apt, dnf, pacman for dependencies)
- **Windows** - Via Git Bash, WSL, or MSYS2

---

## Contributing

1. Edit your local `~/.claude/` config
2. Test with Claude Code
3. Copy to this repo and submit PR
