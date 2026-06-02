# Profiles

Activate for specialized workflows. Profiles live in `~/.claude/profiles/` (installed by `bun src/setup.ts`) and apply via `@profile-name` references in CLAUDE.md or per-project setup.

| Profile | Use Case |
|---------|----------|
| `maestro` | Full orchestration mode — agent delegation for everything |
| `nextjs` | Next.js web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |
| `react-router` | React Router 7+ / Novus projects |

---

## Profile Frontmatter Convention

Each profile file may carry a YAML frontmatter block at the top documenting its intended usage. These fields are **advisory only** — validated at install time for well-formedness, and readable as documented intent. They are not enforced at runtime: cc-settings does not switch the active model, gate skills, or restrict tools based on a profile.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Profile identifier (kebab-case, must match the filename stem) |
| `description` | string | Yes | Short description of the profile's purpose |
| `model` | string | No | Advisory: intended model alias (`opus`, `sonnet`, `haiku`, or a pinned variant like `opus[1m]`) |
| `skills` | list | No | Advisory: skill names expected to be active in this context |
| `tools` | list | No | Advisory: tool subset relevant to this workflow |
| `permissionMode` | string | No | Advisory: intended permission mode (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`) |
| `effort` | string | No | Advisory: default effort level (`low`, `medium`, `high`, `xhigh`, `max`) |

### Example

```yaml
---
name: nextjs
description: Next.js web apps
model: opus
skills: [build, component, hook, lighthouse]
---
```

> **Advisory caveat:** Profile frontmatter documents intent, not enforcement. Claude Code does not read these fields to switch models or activate skills at runtime. They exist so a profile reads as a legible manifest — useful for humans and for install-time well-formedness checks.
