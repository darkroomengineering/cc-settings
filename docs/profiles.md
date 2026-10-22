# Profiles

Profiles document the stack-specific instructions that cc-settings installs under
`~/.claude/profiles/`. They are source material for the shared instructions and skills. There is no
supported `settings.json` key or interactive command that activates one as a runtime mode.

Profiles are never loaded automatically. Read the one that matches the project when you need the
studio's conventions for that stack. Use `/orchestrate` in Claude or `$orchestrate` in Codex when you
explicitly want the maestro workflow. Do not copy profile frontmatter into settings; those fields are
documentation only.

| Profile | Use Case |
|---------|----------|
| `nextjs` | Next.js web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |
| `react-router` | React Router 7+ / Novus projects |
| `durable-agents` | Agents, bots, and autonomous jobs inside a product that must survive crashes and restarts |

---

## Profile Frontmatter Convention

Each profile file may carry a YAML frontmatter block at the top documenting its intended usage. These fields are **advisory only** — validated at install time for well-formedness, and readable as documented intent. They are not enforced at runtime: cc-settings does not switch the active model, gate skills, or restrict tools based on a profile.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Profile identifier (kebab-case, must match the filename stem) |
| `description` | string | Yes | Short description of the profile's purpose |
| `model` | string | No | Advisory: intended model alias (`fable`, `opus`, `sonnet`, `haiku`, or a pinned variant like `claude-opus-5-5`) |
| `skills` | list | No | Advisory: skill names expected to be active in this context |
| `tools` | list | No | Advisory: tool subset relevant to this workflow |
| `permissionMode` | string | No | Advisory: intended permission mode (`default`, `manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`) |
| `effort` | string | No | Advisory: default effort level (`low`, `medium`, `high`, `xhigh`, `max`) |

### Example

```yaml
---
name: nextjs
description: Next.js web apps
model: claude-opus-5-5
skills: [build, component, hook]
---
```

> **Advisory caveat:** Profile frontmatter documents intent, not enforcement. Claude Code does not read these fields to switch models or activate skills at runtime. They exist so a profile reads as a legible manifest — useful for humans and for install-time well-formedness checks.
