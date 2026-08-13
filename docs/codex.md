# Codex support

How to *set up* Codex with the Darkroom standards. For running Codex alongside a Claude Code
session — the `/codex` skill, the `codex-verifier` agent, quota routing — see
[codex-bridge.md](./codex-bridge.md). This doc is setup; that one is runtime.

Keep Codex support in this repository. `AGENTS.md` and `skills/` are shared source files; a fork or
second repository would make the standards and workflows drift.

## Recommended setup: import the installed Claude Code harness

Codex has a native import flow for Claude Code. It translates the parts that need different native
formats instead of asking cc-settings to maintain a second installer.

1. Install or update cc-settings normally.
2. Start a new local Codex CLI session.
3. Enter `/import`.
4. Choose **Claude Code**, then select the Darkroom instructions, skills, hooks, MCP servers, and
   subagents.
5. Review any permissions and reconnect MCP servers that require authentication.
6. Start a new Codex session and try a representative workflow such as `review my changes`.

The import leaves the Claude Code setup unchanged. Turn on automatic import updates in the ChatGPT
desktop app if both harnesses should stay synchronized on one machine.

Use this path for the complete setup. Codex maps the installed `~/.claude/AGENTS.md`,
`settings.json`, skills, hooks, MCP configuration, and subagents to its own configuration surfaces.

## Native plugin: skills-only preview and local development

The repository also carries `.codex-plugin/plugin.json`. It exposes the shared skill library through
the existing `cc-settings` marketplace without duplicating the skills.

From this checkout:

```bash
codex plugin marketplace add .
codex plugin add darkroom@cc-settings
```

Start a new session after installing. This direct plugin path exposes the shared `SKILL.md` files,
but it does not replace the full import. Several orchestrated workflows refer to Claude role-agent
conventions, and `CLAUDE-FULL.md`, Claude settings, hooks, and role-agent definitions still need
Codex's import translation.

Use the plugin path to validate packaging and progressively port individual workflows. Do not call
the whole skill library Codex-native until representative multi-agent, review, and shipping flows
pass in Codex. The Codex IDE extension can load standalone skills, but it does not load installed
plugins; use the import or put repo-scoped skills under `.agents/skills` for that surface.

## Distribution decision

- Keep development local until the import and representative workflows pass on a clean Codex
  profile.
- Merge the compatibility files into `darkroomengineering/cc-settings` after that check. This is the
  canonical repository for the shared source material.
- Do not create `codex-settings` unless Codex eventually needs independently versioned behavior or
  the shared skills require persistent, incompatible forks.
- Treat publication to the universal plugin directory as a later distribution step, not a separate
  source repository.

Official references: [Import from another agent](https://learn.chatgpt.com/docs/import),
[Build skills](https://learn.chatgpt.com/docs/build-skills), and
[Package plugins](https://developers.openai.com/plugins/build/plugins).
