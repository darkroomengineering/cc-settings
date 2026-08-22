# Skills

Skills turn ordinary requests into repeatable workflows. Claude Code and standalone Codex install
the same 38 active skill sources, but each host uses its own invocation, agent, hook, and tool
mechanics.

- Start with the [human skill guide](../docs/skills.md) for value, effects, approvals, output,
  background behavior, prerequisites, host differences, and nearby alternatives.
- Read a specific `skills/<name>/SKILL.md` for the executable procedure that the host follows.
- Read [skill authoring](../docs/skill-authoring.md) before creating or changing a skill.

Natural language works in both hosts. Pin a skill as `/skill-name` in Claude Code or `$skill-name`
in standalone Codex. The canonical active-name registry is `ACTIVE_SKILLS` in
[`src/lib/managed-skills.ts`](../src/lib/managed-skills.ts); this README does not maintain a second
inventory.

Most Claude skills with `context: fork` run in the background and return by task notification.
Standalone Codex keeps the same outcome and safety boundary through native agent controls, but its
background behavior and tool availability can differ. See
[Claude Code and Codex](../docs/claude-vs-codex.md).
