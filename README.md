# Darkroom Claude Code Settings

**Engineering-grade configuration for Claude Code, Codex, and other AI coding agents. Not vibe coding.**

A composable layer of standards, agents, skills, and hooks that prevents the failure modes that show up when you actually try to ship with AI. Used in production at [darkroom.engineering](https://darkroom.engineering).

Open source. Hack around. Make it your own.

---

## Quickstart (30-second setup)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

Restart Claude Code. That's it.

Re-runs are non-destructive — your hand-added permissions, custom hooks, and local env overrides all survive. See [docs/settings-reference.md](./docs/settings-reference.md#re-install-merge-behavior).

<details>
<summary>Alternative install methods</summary>

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

**Windows:**
```powershell
.\setup.ps1
```
</details>

---

## Why cc-settings exists

These are the four failure modes we kept hitting on real projects, and the fixes that ship with cc-settings.

### #1: Agents drift from the codebase

> "With a ubiquitous language, conversations among developers and expressions of the code are all derived from the same domain model."
>
> Eric Evans, *Domain-Driven Design*

**The problem.** Default Claude Code (and Codex, Cursor, Copilot) sees only the conversation. After a few turns, the agent forgets project conventions, hallucinates function names, or applies patterns from its training data instead of yours. Without a shared reference, every session starts from scratch.

**The fix.** A layered context system that loads contextually instead of all at once:

- **`AGENTS.md`** — portable coding standards. Read by Claude Code, Codex, Cursor, and 20+ other tools (the [open standard](https://agents.md))
- **`rules/`** — path-conditioned guidance. `react.md` loads when editing `.tsx`, `git.md` always loads, `security.md` only on API/lib code
- **`profiles/`** — opt-in stacks for Next.js, Expo, Tauri, WebGL

Per-agent context cost dropped from ~5,000 tokens (one giant CLAUDE.md) to ~2,700 tokens by splitting and gating. See the table under [Architecture](#architecture).

### #2: Sessions hallucinate fixes that don't compile

> "Always take small, deliberate steps. The rate of feedback is your speed limit. Never take on a task that's too big."
>
> David Thomas & Andrew Hunt, *The Pragmatic Programmer*

**The problem.** AI agents generate code that *looks* plausible but doesn't typecheck, doesn't run, or breaks tests three files away. They confidently report "fixed" when the build is red.

**The fix.** Multiple feedback loops, all enforced:

- **Pre-commit `tsc` hook** — blocks any commit if types fail. No `--no-verify` shortcuts
- **`/verify`** — three-agent adversarial pattern (finder → adversary → referee) for high-stakes code (auth, payments, data integrity)
- **2-iteration limit** (in `AGENTS.md`) — fail twice, stop, present alternatives instead of digging deeper into a doomed approach
- **`/fix`** — explore → tester → implementer → reviewer pipeline. Never solo
- **`/ship`** — typecheck → build → test → lint → web quality gate before any PR

### #3: Context window burns out before the work is done

> "Premature compaction is the root of all unfinished features."

**The problem.** Non-trivial features can blow through the 1M-token Opus context before shipping. Auto-compaction at 95% loses state. Sessions die with WIP unsaved. Subagents reload the same config 9× across an orchestration.

**The fix.** Token-aware everything:

- **Layered config loading** keeps base cost at ~2,700 tokens (was ~5,000). Subagents inherit, don't reload
- **Prompt caching 1h** (`ENABLE_PROMPT_CACHING_1H`) — cache hits cost ~10% of fresh
- **Native `Skill` tool auto-invocation** (Claude Code v2.1.108+) — skill text only loaded when the description matches your prompt
- **`/checkpoint`** mid-session JSON quicksaves; **`/create-handoff`** for full session transfers
- **Auto-handoff on `PreCompact`** — never lose work to compaction. Resume next session with `/resume-handoff`

### #4: Upstream changes leave configs stale

> "The only constant in agent tooling is the changelog."

**The problem.** Claude Code ships ~3 versions per week. Native features start overlapping with custom hooks. Schemas drift from reality. You either chase the changelog manually every Friday or fall behind and find out the hard way.

**The fix.**

- **`/cc-sync`** — audits cc-settings against the official changelog, identifies adopt-vs-dedupe candidates, runs the sync end-to-end with one human approval gate
- **`upstream/claude-code-manifest.json`** + drift scanner — `bun run upstream:scan` reports schema drift in CI
- **GitHub Action** opens manifest-only bump PRs automatically; richer syncs go through `/cc-sync`

---

## Reference

Skills are auto-invoked from natural language — describe what you want, don't memorize commands. If you forget what's available, type `/skills` for the picker.

For the full operational guide with conversation phrases for each skill, see **[MANUAL.md](./MANUAL.md)**.

### Daily workhorses

These run constantly. Get fluent with them first.

- **[`/fix`](./skills/fix/SKILL.md)** — explore → reproduce → fix → review for any bug, broken test, or "not working"
- **[`/build`](./skills/build/SKILL.md)** — research (GO/NO-GO gate) → plan → scaffold → implement → test for any new feature
- **[`/ship`](./skills/ship/SKILL.md)** — typecheck → build → test → lint → web quality gate → commit → PR
- **[`/review`](./skills/review/SKILL.md)** — review against Darkroom standards (TS, React, a11y, performance)
- **[`/explore`](./skills/explore/SKILL.md)** — read-only codebase navigation, returns file locations and summaries
- **[`/docs`](./skills/docs/SKILL.md)** — fetches current library docs via Context7 MCP. Auto-runs before `bun add` / `npm install`
- **[`/refactor`](./skills/refactor/SKILL.md)** — explore → plan → implement → test → review with behavior preserved
- **[`/test`](./skills/test/SKILL.md)** — write/run tests, surface coverage gaps

### Verification & quality

Reach for these before merging or whenever stakes are high.

- **[`/verify`](./skills/verify/SKILL.md)** — three-agent adversarial pattern: finder → adversary → referee
- **[`/qa`](./skills/qa/SKILL.md)** — visual + a11y review (layout, typography, contrast, hierarchy)
- **[`/figma`](./skills/figma/SKILL.md)** — compares implementation against Figma designs
- **[`/lighthouse`](./skills/lighthouse/SKILL.md)** — Lighthouse audits with median-of-3 averaging, optimizes scores
- **[`/debug`](./skills/debug/SKILL.md)** — browser automation for visual debugging
- **[`/audit`](./skills/audit/SKILL.md)** — runs the cc-settings audit script
- **`security-reviewer`** *(agent)* — OWASP Top 10, secret scanning, auth flow audit

### Planning & research

Before writing code on anything non-trivial.

- **[`/discovery`](./skills/discovery/SKILL.md)** — turn vague ideas into concrete requirements
- **[`/prd`](./skills/prd/SKILL.md)** — clarifying interview → scope → user stories → task breakdown
- **[`/ask`](./skills/ask/SKILL.md)** — delegate to the oracle agent for evidence-based guidance
- **[`/premortem`](./skills/premortem/SKILL.md)** — failure-mode analysis before implementing
- **[`/f-thread`](./skills/f-thread/SKILL.md)** — compare approaches with weighted scoring matrix → ADR

### Session management

For long sessions and multi-day work.

- **[`/context`](./skills/context/SKILL.md)** — context-window status and management
- **[`/checkpoint`](./skills/checkpoint/SKILL.md)** — lightweight JSON quicksave (mid-session)
- **[`/create-handoff`](./skills/create-handoff/SKILL.md)** — full markdown session transfer with GitHub Issue sync
- **[`/resume-handoff`](./skills/resume-handoff/SKILL.md)** — load handoff + linked issue context
- **[`/learn`](./skills/learn/SKILL.md)** — store learnings (local or `--shared` to team via GitHub Projects)

### Maintenance

Run weekly or when entropy hits.

- **[`/cc-sync`](./skills/cc-sync/SKILL.md)** — sync cc-settings with the official Claude Code changelog
- **[`/consolidate`](./skills/consolidate/SKILL.md)** — audit rules, skills, learnings for contradictions and bloat
- **[`/autoresearch`](./skills/autoresearch/SKILL.md)** — autonomous skill optimization loop

### Scaffolding

For starting fresh or adding common pieces.

- **[`/init`](./skills/init/SKILL.md)** — clone Satus starter template (full Darkroom stack)
- **[`/component`](./skills/component/SKILL.md)** — scaffold React component with CSS module
- **[`/hook`](./skills/hook/SKILL.md)** — scaffold typed custom React hook
- **[`/design-tokens`](./skills/design-tokens/SKILL.md)** — generate type scale / color palette as Tailwind or CSS vars
- **[`/lenis`](./skills/lenis/SKILL.md)** — install and configure Lenis smooth scroll

### Advanced orchestration

Niche but powerful — reach for these when the simpler skills fall short.

- **[`/orchestrate`](./skills/orchestrate/SKILL.md)** — delegate multi-agent coordination to Maestro
- **[`/teams`](./skills/teams/SKILL.md)** — coordinate independent Claude Code instances for true parallelism (3+ workstreams, no file conflicts)
- **[`/l-thread`](./skills/l-thread/SKILL.md)** — phased execution with checkpoints and recovery; for overnight or multi-hour tasks
- **[`/tldr`](./skills/tldr/SKILL.md)** — token-efficient codebase analysis (95% fewer tokens than reading files)
- **[`/project`](./skills/project/SKILL.md)** — read/update linked GitHub issues from branch name

### Agents

Specialized subagents the skills delegate to. You rarely invoke these directly — they run inside skill pipelines.

| Agent | Role | Model |
|-------|------|-------|
| `planner` | Task breakdown, architecture decisions | Opus |
| `oracle` | Expert Q&A with file:line citations | Opus |
| `reviewer` | Code review against standards | Opus |
| `security-reviewer` | OWASP, secrets, auth audit | Opus |
| `maestro` | Multi-agent orchestration | Opus |
| `implementer` | Write and edit code | Sonnet |
| `tester` | Write and run tests | Sonnet |
| `scaffolder` | Boilerplate generation | Sonnet |
| `explore` | Read-only navigation, doc fetching | Sonnet |
| `deslopper` | Dead-code removal, cleanup | Sonnet |

Opus for judgment, Sonnet for execution. Read-only agents (`explore`, `oracle`, `reviewer`, `security-reviewer`) run with `permissionMode: plan` so a stray write can't slip through.

---

## What gets installed

```
~/.claude/
├── CLAUDE.md           # Claude-Code-specific config (slim)
├── AGENTS.md           # Portable coding standards (reference copy)
├── settings.json       # Permissions, hooks, MCP servers
├── agents/             # 10 specialized agents
├── skills/             # 38 auto-invocable skills
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

## Architecture

How layered loading keeps context cost down.

| Layer | File | Approx. Tokens | Loaded |
|-------|------|----------------|--------|
| **Standards** | `AGENTS.md` | ~1,500 | Per-project, all AI tools |
| **Claude config** | `CLAUDE.md` | ~1,200 | Claude Code only |
| **Orchestration** | `profiles/maestro.md` | ~1,000 | Opt-in, power users |
| **Rules** | `rules/*.md` | ~500 each | On-demand by file type |

Early versions shipped a 538-line monolithic CLAUDE.md loaded into every conversation and every agent spawn — ~5,000 tokens of config overhead per agent, compounding to ~45K tokens across a 9-agent pipeline. A third of API spend was re-reading configuration.

**Now:** base cost ~2,700 tokens. Orchestration is opt-in. Rules load contextually. Subagents inherit instead of reloading.

---

## Cross-tool compatibility

`AGENTS.md` is the [open standard](https://agents.md) for AI coding instructions, supported by Codex, Cursor, Copilot, Windsurf, and 20+ other tools.

For projects using multiple AI tools:

```bash
ln -s AGENTS.md CLAUDE.md
```

Claude Code reads `CLAUDE.md`. Other tools read `AGENTS.md`. The symlink gives both the same content.

---

## Profiles

Activate specialized workflows in `settings.json`:

| Profile | When to use |
|---------|-------------|
| `maestro` | Full orchestration — delegate everything to agents |
| `nextjs` | Next.js App Router web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |

---

## Knowledge system

Two-tier knowledge management:

| Tier | Storage | Scope |
|------|---------|-------|
| **Shared** | GitHub Project board | Team-wide decisions, conventions, gotchas |
| **Local** | Auto-memory + learnings | Personal preferences, session context |

```bash
/learn store bug "useAuth causes hydration — use dynamic import"        # local
/learn store --shared gotcha "Sanity API returns UTC dates"              # team
```

See [docs/knowledge-system.md](./docs/knowledge-system.md) for setup.

---

## Documentation

| Doc | Content |
|-----|---------|
| [MANUAL.md](./MANUAL.md) | Operational guide — every skill with conversation phrases |
| [USAGE.md](./USAGE.md) | Progressive onboarding (Level 0–4) |
| [AGENTS.md](./AGENTS.md) | Portable coding standards and guardrails |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |
| [docs/knowledge-system.md](./docs/knowledge-system.md) | Two-tier knowledge setup |
| [docs/settings-reference.md](./docs/settings-reference.md) | Every `settings.json` field |
| [docs/hooks-reference.md](./docs/hooks-reference.md) | All 27 hook events |
| [docs/frontmatter-reference.md](./docs/frontmatter-reference.md) | YAML frontmatter for agents, skills, rules |
| [docs/feature-agents-guide.md](./docs/feature-agents-guide.md) | Creating project-specific feature agents |
| [docs/github-workflow.md](./docs/github-workflow.md) | GitHub-native workflow with Issues and Projects |
| [docs/thread-types.md](./docs/thread-types.md) | Thread type decision tree for orchestration |
| [docs/cache-strategy.md](./docs/cache-strategy.md) | Prompt caching ordering |

---

## Platform support

- **macOS** — native (`bash setup.sh`)
- **Linux** — native (`bash setup.sh`)
- **Windows** — native (`.\setup.ps1` in PowerShell)

Runtime: Bun `>=1.1.30` (auto-installed by the bootstrap if missing).

---

## Contributing

1. Fork the repo
2. Edit configs locally
3. Install deps: `bun install`
4. Gates: `bun run typecheck && bun run lint && bun test`
5. Install to `~/.claude/`: `bash setup.sh` (or `.\setup.ps1` on Windows)
6. Submit PR with conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)

### Project structure

```
AGENTS.md              # Portable coding standards (source of truth)
CLAUDE-FULL.md         # Claude-Code config (installed as ~/.claude/CLAUDE.md)
setup.sh / setup.ps1   # Bootstrap (installs Bun, execs src/setup.ts)
config/                # Settings fragments (composed at install): core, mcp, permissions, hooks
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
