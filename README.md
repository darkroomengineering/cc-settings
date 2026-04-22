# Darkroom Claude Code Settings

Open-source AI coding configuration for [darkroom.engineering](https://darkroom.engineering) projects.

Layered config, portable standards, progressive complexity. See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## Architecture

Early versions shipped a 538-line monolithic CLAUDE.md loaded into every conversation and every agent spawn — ~5,000 tokens of config overhead per agent, compounding to ~198K tokens across a full orchestration pipeline. A third of API spend was re-reading configuration.

Current design splits this into layers:

| Layer | File | Approx. Tokens | Loaded |
|-------|------|----------------|--------|
| **Standards** | `AGENTS.md` | ~1,500 | Per-project, all AI tools |
| **Claude Config** | `CLAUDE.md` | ~1,200 | Claude Code only |
| **Orchestration** | `profiles/maestro.md` | ~1,000 | Opt-in, power users |
| **Rules** | `rules/*.md` | ~500 each | On-demand by file type |

**Before:** Every agent loaded 5,000+ tokens of config. 9-agent pipeline = 45K tokens just for config.
**After:** Base cost is ~2,700 tokens. Orchestration is opt-in. Rules load contextually.

---

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

Restart Claude Code.

Re-running the installer preserves your hand-edits to `~/.claude/settings.json` — permission rules you added, custom hooks, local env overrides, and extra MCP servers all survive. For fine-grained control over scalar overrides and team-added rules, pass `--interactive` (see [docs/settings-reference.md](./docs/settings-reference.md#re-install-merge-behavior)).

<details>
<summary>Alternative methods</summary>

**Clone and run locally:**
```bash
git clone https://github.com/darkroomengineering/cc-settings.git /tmp/darkroom-claude
bash /tmp/darkroom-claude/setup.sh
```

**Interactive install** (prompts on each settings conflict):
```bash
bash setup.sh --interactive    # or: CC_INTERACTIVE=1 bash setup.sh
```

**Plugin install (requires GitHub SSH keys):**
```
/plugin install darkroomengineering/cc-settings
```
</details>

### What Gets Installed

```
~/.claude/
├── CLAUDE.md           # Claude-Code-specific config (slim)
├── AGENTS.md           # Portable coding standards (reference copy)
├── settings.json       # Permissions, hooks, MCP servers
├── agents/             # 10 specialized agents
├── skills/             # 43 auto-invocable skills
├── profiles/           # Workflow profiles (maestro, nextjs, etc.)
├── rules/              # Path-conditioned rules (load on-demand)
├── contexts/           # Ecosystem contexts
├── src/                # TypeScript: hooks, scripts, libs, schemas
├── docs/               # Reference documentation
├── backups/            # Install backups (rollback target)
├── learnings/          # Local persistent memory
└── handoffs/           # Session state backups
```

---

## Getting Started

See **[USAGE.md](./USAGE.md)** for the progressive onboarding guide (Level 0-4: from "just talk" to full orchestration).

---

## Cross-Tool Compatibility

`AGENTS.md` is the [open standard](https://agents.md) for AI coding instructions, supported by Codex, Cursor, Copilot, Windsurf, and 20+ other tools.

For projects using multiple AI tools:
```bash
# Symlink so both Claude Code and other tools read the same file
ln -s AGENTS.md CLAUDE.md
```

Claude Code reads `CLAUDE.md`. Other tools read `AGENTS.md`. The symlink gives both the same content.

---

## Knowledge System

Two-tier knowledge management:

| Tier | Storage | Scope |
|------|---------|-------|
| **Shared** | GitHub Project board | Team-wide decisions, conventions, gotchas |
| **Local** | Auto-memory + learnings | Personal preferences, session context |

```bash
# Store locally (default)
/learn store bug "useAuth causes hydration — use dynamic import"

# Store to team knowledge base
/learn store --shared gotcha "Sanity API returns UTC dates"
```

See [docs/knowledge-system.md](./docs/knowledge-system.md) for setup.

---

## Profiles

| Profile | When To Use |
|---------|-------------|
| `maestro` | Full orchestration — delegate everything to agents |
| `nextjs` | Next.js App Router web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |

---

## Documentation

| Doc | Content |
|-----|---------|
| [AGENTS.md](./AGENTS.md) | Portable coding standards and guardrails |
| [USAGE.md](./USAGE.md) | Progressive onboarding guide |
| [docs/knowledge-system.md](./docs/knowledge-system.md) | Two-tier knowledge setup |
| [skills/README.md](./skills/README.md) | Skill system |
| [hooks/README.md](./hooks/README.md) | Hook configuration |
| [docs/hooks-reference.md](./docs/hooks-reference.md) | All 27 hook events |
| [docs/settings-reference.md](./docs/settings-reference.md) | settings.json fields |
| [docs/frontmatter-reference.md](./docs/frontmatter-reference.md) | YAML frontmatter fields for agents, skills, rules |
| [docs/feature-agents-guide.md](./docs/feature-agents-guide.md) | Creating project-specific feature agents |
| [docs/github-workflow.md](./docs/github-workflow.md) | GitHub-native workflow with Issues and Projects |
| [docs/thread-types.md](./docs/thread-types.md) | Thread type decision tree for orchestration |
| [docs/enhanced-todos.md](./docs/enhanced-todos.md) | Todo complexity sizing and token budgeting |
| [docs/parallel-batch-detection.md](./docs/parallel-batch-detection.md) | Parallel batch detection algorithm |

---

## Platform Support

- **macOS** — Native (`bash setup.sh`)
- **Linux** — Native (`bash setup.sh`)
- **Windows** — Native (`.\setup.ps1` in PowerShell)

Runtime: Bun `>=1.1.30` (auto-installed by the bootstrap if missing).

---

## Contributing

1. Fork the repo
2. Edit configs locally
3. Install deps: `bun install`
4. Gates: `bun run typecheck && bun run lint && bun test`
5. Install to `~/.claude/`: `bash setup.sh` (or `.\setup.ps1` on Windows)
6. Submit PR with conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)

### Project Structure

```
AGENTS.md              # Portable coding standards (source of truth)
CLAUDE-FULL.md         # Claude-Code config (installed as ~/.claude/CLAUDE.md)
setup.sh               # Bootstrap (installs Bun, execs src/setup.ts)
setup.ps1              # Windows bootstrap
settings.json          # Permissions, hooks, MCP
src/setup.ts           # Authoritative installer
src/hooks/             # Hot-path hooks (safety-net, statusline, …)
src/scripts/           # One-shot scripts (post-edit, handoff, learn, …)
src/lib/               # Shared libs (colors, mcp, packages, platform, …)
src/schemas/           # zod schemas for settings.json, hooks, skills, MCP
src/upstream/          # Claude Code version-drift scanner
agents/                # Agent definitions
skills/                # Skill definitions
profiles/              # Workflow + platform profiles
rules/                 # Path-conditioned rules
contexts/              # Ecosystem contexts
docs/                  # Reference docs
bench/                 # Performance benchmarks + regression gate
tests/                 # bun:test suites
schemas/               # Generated JSON Schemas (bun run schemas:emit)
```

---

## License

MIT
