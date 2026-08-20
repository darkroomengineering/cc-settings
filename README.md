# cc-settings

AI coding configuration for the Darkroom team. One installer configures Claude Code, Codex, or both
with shared standards and workflows plus the native features each product supports.

cc-settings turns either TUI into the team's house engineer. It knows our standards, avoids dangerous
actions, proves work before shipping, and delegates larger tasks instead of grinding through them in
one context.

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

The default `auto` target installs both products when `codex` is on `PATH`, and Claude Code only
otherwise. Clone the repository to select a target explicitly:

```bash
bash setup.sh --target=auto
bash setup.sh --target=claude
bash setup.sh --target=codex
bash setup.sh --target=both
```

The remote one-liners cannot forward flags. Restart every selected TUI after install. In Codex,
review the installed plugin hooks once through `/hooks`. Flags, requirements, profiles, installed
paths, and rollback details are in [docs/install.md](./docs/install.md). Codex-specific boundaries
are in [docs/codex.md](./docs/codex.md).

---

## After installing

There are no commands to learn. Open Claude Code or Codex in a project and describe what you want in
your own words. The right workflow loads on its own.

```
> fix the login redirect
> add a dashboard with stats
> review my changes
> ship it
```

That's the whole interface. Slash names like `/fix` and `/ship` exist so you can pin a specific one when you want to, and you'll rarely need them. When you're curious what fired and why, run `bun run whats-on` or ask *"what skill handles X?"*. The [situation-to-phrase table in MANUAL.md](./MANUAL.md#quickstart) covers the common cases.

---

## What it adds to Claude Code and Codex

### Standards & knowledge

- **[AGENTS.md](./AGENTS.md)** contains the portable coding standards. Claude Code also receives
  Claude-specific behavior from [CLAUDE.md](./CLAUDE.md). Codex receives a marked managed block in
  its native `AGENTS.md`, preserving unrelated user text.
- **Path-conditioned rules and stack profiles** give Claude Code deeper file and framework context.
  Codex receives its native command policy plus the shared instructions and skills.
- **The team knowledge system** provides shared conventions, project memory, and `/share-learning`.

### Automation

- **38 shared skills** fire from ordinary requests such as *"fix the login redirect"* or *"ship
  it"*. [MANUAL.md](./MANUAL.md) maps situations to phrasings.
- **Native role agents** support planning, implementation, testing, review, security, and
  orchestration. Claude Code also gets `codex-verifier`, which is omitted from Codex because that
  role bridges from Claude Code into Codex.
- **Lifecycle hooks** enforce proof, safety, and workflow checks. Codex installs the compatible
  subset through `darkroom@cc-settings`; review those hooks through `/hooks` after installation or
  change.

### Model & quota strategy

- **Claude Code model pins and routing** keep planning, fan-out, and cross-model review on their
  intended model pools ([docs/agent-models.md](./docs/agent-models.md)).
- **The Codex bridge** lets Claude Code call Codex as a second model family
  ([docs/codex-bridge.md](./docs/codex-bridge.md)). Standalone Codex workflows never invoke that
  bridge recursively.
- **Claude's custom statusline** shows model, context, quota, drift, and bridge health. Codex has no
  arbitrary custom statusline API, so use Codex `/status` for session state and installer `--status`
  for install health.

### Settings & permissions

Claude Code receives composed settings, permissions, hooks, and four MCP servers: `context7`,
`tldr`, `figma`, and `chrome-devtools`. Codex automatically receives only the fixed HTTPS Figma MCP.
It does not auto-run Context7 or Chrome DevTools from unpinned packages, and it does not bundle
`tldr`. Users may configure reviewed and pinned MCP versions themselves.

### Supply-chain defense

Claude setup fingerprints its hooks and installed scripts, then verifies them on session start.
`bun run audit:hooks` classifies hook commands against trusted content and suspicious patterns
([SECURITY.md](./SECURITY.md)). Codex uses its native plugin trust review through `/hooks`.

### The installer

The installer supports `--target=auto|claude|codex|both` for install, dry run, status, rollback, and
uninstall. Backups and ownership records are product-specific. Reinstalls preserve unrelated Codex
agents, rules, and `AGENTS.md` text, plus unrelated Claude settings and extensions. Invalid or
unknown flags fail closed. Codex copies an allowlisted runtime package, not user or ignored checkout
files.

Everything is TypeScript on Bun, tested, linted, and CI-gated, including the shared counts and
installer contracts above.

---

## How it fits together

Rules start as advisories, work ships through gates, and an advisory is only promoted to a gate when telemetry proves it gets ignored. The full loop, with diagram: [docs/the-flow.md](./docs/the-flow.md).

---

## Docs

| Doc | What's in it |
|-----|-------------|
| [docs/install.md](./docs/install.md) | Install flags, requirements, light vs full, what lands where, common commands |
| [docs/codex.md](./docs/codex.md) | Native Codex install, plugin trust, lifecycle, light profile, and platform boundaries |
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
