# Codex host adapter

This section supersedes Claude-only mechanics in the portable `AGENTS.md` when the host is standalone Codex. The engineering standards, guardrails, and product intent in the portable file still apply.

## Native mechanics

- Use the native custom agents installed in `$CODEX_HOME/agents` (or the active Codex home). Create a new
  agent with `spawn_agent`, deliver context while it runs with `send_message`,
  trigger another turn once it is idle with `followup_task`, wait with
  `wait_agent`, and stop its current turn with `interrupt_agent` only when
  necessary.
- Use `apply_patch` for file edits and `exec_command` for shell commands. Do not translate these back to Claude tool names.
- Delegate before work that spans 3 or more files, is likely to need 12 or more tool calls, or touches security-sensitive code. Route exploration, implementation, testing, review, and security work to the matching native role.
- Never spawn `codex-verifier` and never call the Claude-to-Codex bridge from standalone Codex. For independent review, spawn a fresh `reviewer` agent; for adversarial verification, use separate issue-finder, disprover, and judge agents.
- Writers share the working tree unless the live host explicitly offers
  isolation. Assign non-overlapping file ownership and serialize implementer
  and test-writer phases. Only read-only reviewers may overlap. Never promise a
  Codex implementer Claude worktree isolation.
- Invoke a shared skill as `$skill-name`. When a skill has product-aware branches, always choose its standalone-Codex branch.
- Use `/hooks` to inspect and manage hook trust. Use `/status` for native session, model, sandbox, and usage status. Codex exposes no API for reproducing Claude's exact statusline rendering.

## Response shape

Lead with the result or next action. Number multi-step work with one bounded action per step. Take reversible in-scope actions instead of offering them. Ask only when the user owns a material or irreversible choice. Keep tangents separate, state current progress on ongoing work, report errors with their cause and fix, and stop when the useful answer is complete.
