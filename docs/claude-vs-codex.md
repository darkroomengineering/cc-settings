# Claude Code and Codex

> **Audience:** people using Claude Code, standalone Codex, or both
> **Purpose:** define the shared outcome contract and the host-specific ergonomics
> **Status:** canonical host-parity guide

cc-settings shares standards and skill sources across both products. It does not make their
interfaces or capabilities identical. "Shared" means the requested outcome and safety boundary
travel across hosts. The host decides how tools, agents, hooks, and background work execute.

## Everyday use

| Need | Claude Code | Standalone Codex |
|---|---|---|
| Let routing choose | Describe the outcome | Describe the outcome |
| Pin a shared skill | `/skill-name` | `$skill-name` |
| Inspect session state | Claude status surfaces | `/status` |
| Inspect installed cc-settings user scope | `bun ~/.claude/src/scripts/whats-on.ts` | No exact equivalent |
| Review plugin hooks | Inspect Claude settings and hook reference | `/hooks` |
| Continue agent work | Resume or message the existing agent/task | Resume or message the existing agent/task through native agent controls |

Natural language is the safest common interface. Explicit names matter when nearby skills have
different effects, such as `review`, `proof-of-work`, `verify`, `qa`, `triage`, and `audit`.

Claude's native `/review` name can overlap with the cc-settings `review` skill. Say "run the
cc-settings local pre-commit review" or choose the cc-settings skill from the visible skill picker.
Do not rely on an undocumented precedence rule.

## Installed capability matrix

| Surface | Claude full profile | Codex full profile |
|---|---|---|
| Shared standards | `CLAUDE.md`, `AGENTS.md`, rules, and profiles | Managed block in native `AGENTS.md` plus command policy |
| Shared skills | All 38 under `~/.claude/skills` | All 38 through `darkroom@cc-settings` |
| Role agents | All roles, including the Claude-to-Codex `codex-verifier` | Native role agents except `codex-verifier` |
| Hooks | Full Claude hook set from composed settings | Compatible plugin subset; user reviews trust through `/hooks` |
| MCP servers | Context7, TLDR, Figma, and Chrome DevTools | Fixed HTTPS Figma server only |
| Runtime source | Self-contained managed source under `~/.claude/src` | Allowlisted source under `$CODEX_HOME/darkroom/source` |
| Custom statusline | Yes | No arbitrary statusline API; use `/status` |
| Backups and ownership | Claude-specific store and sentinel | Codex-specific store and sentinel |

An MCP server is an external tool provider that gives the host capabilities such as documentation
lookup, browser inspection, or Figma access. A sentinel is a small ownership and version record that
lets the installer distinguish cc-settings files from user files.

The light profiles are intentionally different. Claude light keeps the custom statusline and
`share-learning`. Codex light keeps the managed Darkroom instruction block and runtime source. Both
skip most full-profile automation. See [installation](./install.md#full-and-light-profiles).

## Skills with important host differences

| Skill or capability | Claude Code | Standalone Codex |
|---|---|---|
| `tldr` | Uses the installed TLDR MCP | Falls back to `rg`, import searches, and native code navigation |
| Context7 lookup | Installed in the full profile | Available only when the user configured a reviewed server |
| `qa` | Uses Chrome DevTools MCP for screenshots and accessibility inspection | Uses a configured browser path or reports that visual verification is unavailable |
| `lighthouse` | Uses the Chrome DevTools Lighthouse tool | Requires a user-configured equivalent; must not invent scores |
| `freeze` | Enforces a directory edit boundary through Claude hooks | Unsupported as enforcement; file ownership is a convention only |
| `autoresearch` | Runs the controlled Claude subprocess optimization loop | Unsupported until Codex has an equivalent measured harness |
| `codex` bridge | Calls Codex as a second model family | Never invokes Codex recursively; a native reviewer supplies a fresh opinion |
| Agent teams and dynamic workflows | Available when Claude supports and enables them | Use native Codex agents and orchestration; mechanics differ |
| Forked skills | Return through Claude task notifications | Use Codex-native background or agent surfaces when available |

The [skill guide](./skills.md) lists the effect and prerequisite for every skill.

## Approval and safety stay shared

Both hosts should surface a material or irreversible choice before acting. Examples include
publishing, releasing, force pushing, changing a repository outside the Darkroom organization, and
posting a team-visible learning. Read-only inspection and reversible work inside the requested scope
normally proceed without another approval turn.

Frontmatter such as `context`, `allowed-tools`, and `agent` is native Claude metadata. Standalone
Codex treats it as documentation unless its own runtime exposes an equivalent. Every complex shared
skill therefore carries a Codex branch that restates the important safety and fallback behavior.

## Product-specific references

- [Codex installation and lifecycle](./codex.md)
- [Claude installed-state inspection](./whats-on.md)
- [Agent and model policy](./agent-models.md)
- [Claude-to-Codex bridge](./codex-bridge.md)
- [Skill guide](./skills.md)
