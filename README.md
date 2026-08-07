# cc-settings

Claude Code configuration for the Darkroom team — installs agents, skills, hooks, and coding standards into `~/.claude/`.

Vanilla Claude Code is a capable but unopinionated agent. cc-settings turns it into the team's house engineer: it knows our standards, refuses to do dangerous things, proves its work before shipping it, delegates instead of grinding solo, routes work across model quotas, and detects when its own install has been tampered with.

---

## Install

**macOS / Linux:**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
```

Restart Claude Code after install. New to Claude Code? `bash setup.sh --light` installs a minimal tier (statusline + one skill) you can upgrade later. Flags, requirements, what lands where, rollback: [docs/install.md](./docs/install.md).

---

## After installing

There are no commands to learn. Open Claude Code in a project and describe what you want in your own words — the right workflow loads on its own.

```
> fix the login redirect
> add a dashboard with stats
> review my changes
> ship it
```

That's the whole interface. Slash names like `/fix` and `/ship` exist so you can pin a specific one when you want to, and you'll rarely need them. When you're curious what fired and why, run `bun run whats-on` or ask *"what skill handles X?"*. The [situation-to-phrase table in MANUAL.md](./MANUAL.md#quickstart) covers the common cases.

---

## What it adds on top of vanilla Claude Code

### Standards & knowledge

- **[AGENTS.md](./AGENTS.md)** — portable coding standards on the [open standard](https://agents.md) also read by Codex, Cursor, Copilot, and Windsurf; the source of truth, with [CLAUDE.md](./CLAUDE.md) layering Claude-Code-specific behavior (edit strategy, delegation, autonomy contract, output shaping) on top.
- **10 path-conditioned rules** — TypeScript, React, performance, accessibility, security, git, styling — loaded only when relevant files are in play, so context isn't spent on Tauri rules during a CSS fix.
- **6 stack profiles** — nextjs, react-native, tauri, webgl, react-router, maestro — deeper per-stack workflows activated on demand.
- **Team knowledge system** — a shared team-knowledge repo consulted before architecture/convention calls, per-project auto-memory, and `/share-learning` to promote personal learnings team-wide.

### Automation: 38 skills, 10 agents, 15 hooks

- **38 skills** — multi-step workflows that fire from how you phrase a request, not from a command you memorize. *"fix the login redirect"* runs explore → tester → implementer → reviewer; *"ship it"* runs the full gate to an open PR; *"poke holes in this"* puts three competing agents on the claim. Each has a slash name for when you want to pin one, and [MANUAL.md](./MANUAL.md) maps situations to phrasings. The count is ratcheted in CI: adding a 39th or dropping to 37 both fail lint until the baseline is deliberately moved in a commit.
- **10 subagents** — explore, planner, implementer, tester, reviewer, security-reviewer, deslopper, scaffolder, maestro, codex-verifier — with a mechanical delegation heuristic (3+ files or 12+ tool calls → delegate) enforced by a hook, because models under-delegate on their own.
- **15 hook modules wired across 17 event types** (34 command bindings, including lifecycle scripts), split into hard gates and soft advisories:
  - *Gates*: proof-of-work blocks pushing/PR-ing until typecheck/test/lint are green; the [farolero](https://github.com/darkroomengineering/farolero) ratchet gates commits in repos that use it; `/freeze` blocks edits outside a locked directory. For destructive Bash, the permissions deny-list is the enforcement boundary, with a fail-open safety-net hook as defense-in-depth on top ([SECURITY.md](./SECURITY.md)).
  - *Advisories*: delegation nudges, model-escalation suggestions after repeated failures, quota steering, memory-promotion prompts.

### Model & quota strategy

- **Model pins** — Opus 5 as session default, Sonnet for subagent fan-out, effort pinned to `high`: a deliberate cost calibration ([docs/agent-models.md](./docs/agent-models.md)).
- **Codex bridge** — the OpenAI Codex CLI as a second model family: default-on cross-model review of every meaningful diff, bulk mechanical work routed to Codex's roomy quota, Claude kept for planning and gate decisions. Fail-open when the bridge is down ([docs/codex-bridge.md](./docs/codex-bridge.md)).
- **Quota-aware statusline** — model + effort, context-usage bar, 5h/7d rate-limit chips, review-queue backpressure, version drift, and Codex availability in one line.

### Settings & permissions

Composed `settings.json` from modular fragments: a curated allowlist of safe commands, a large denylist (force-push, `curl | bash`, credential reads, `sudo`, secret deletion), and 4 pre-wired MCP servers — context7 for library docs, tldr for token-cheap code intel, figma, chrome-devtools. Re-installs are non-destructive: existing permissions, custom hooks, and local overrides survive.

### Supply-chain defense

Setup writes a SHA256 fingerprint of the hooks block plus a content manifest of every installed script; every session start re-verifies both, and `bun run audit:hooks` classifies every hook command as trusted (content-hash-verified, or exact-match known-vendor templates), stale, unknown, or suspicious against known worm signatures. The auditor can never whitelist itself ([SECURITY.md](./SECURITY.md)).

### The installer

Non-destructive three-way merge that survives re-installs, timestamped backups with one-command rollback, dry-run preview, the `--light` beginner tier, and an upstream drift scanner that flags when Claude Code itself changed underneath the config.

Everything is TypeScript on Bun, tested, linted, and CI-gated — including the counts and contracts above, so this summary stays true by construction rather than by discipline.

---

## How it fits together

Rules start as advisories, work ships through gates, and an advisory is only promoted to a gate when telemetry proves it gets ignored. The full loop, with diagram: [docs/the-flow.md](./docs/the-flow.md).

---

## Docs

| Doc | What's in it |
|-----|-------------|
| [docs/install.md](./docs/install.md) | Install flags, requirements, light vs full, what lands where, common commands |
| [docs/the-flow.md](./docs/the-flow.md) | The advisory → gate → measurement loop that ties the pieces together |
| [MANUAL.md](./MANUAL.md) | Every skill — how to invoke it, what it does |
| [AGENTS.md](./AGENTS.md) | Coding standards and guardrails (source of truth) |
| [CLAUDE.md](./CLAUDE.md) | Claude-Code config, delegation rules, effort levels |
| [docs/profiles.md](./docs/profiles.md) | Stack-specific profiles (Next.js, RN, Tauri, WebGL, React Router) |
| [docs/skill-authoring.md](./docs/skill-authoring.md) | Writing new skills |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |

---

## Why

Shared config means every engineer on the team runs the same agents, the same guardrails, and the same coding standards — no per-machine drift. `AGENTS.md` is the [open standard](https://agents.md) for AI coding instructions and is also read by Codex, Cursor, Copilot, and Windsurf, so the rules follow you across tools.

---

[darkroom.engineering](https://darkroom.engineering) · MIT
