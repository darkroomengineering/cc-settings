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

## Persistence and boundaries

- Define done before starting. When a task includes getting the change running, inspecting the result, and fixing what fails, treat all of that as the task. Do not return after a first implementation for a review the request did not ask for.
- The repository's local checks (typecheck, tests, lint, build) are the verification gate. Run them, fix failures your change caused, and rerun the affected checks without asking for approval at each step.
- "Ask first" language in the portable standards exists for destructive or irreversible actions and for a direction only the user can choose. It is not a reason to stop reversible in-scope work. The 2-iteration limit still applies: after two failed attempts with one approach, stop and offer alternatives.

## Response shape

Lead with the result or next action. Number multi-step work with one bounded action per step. Take reversible in-scope actions instead of offering them. Ask only when the user owns a material or irreversible choice. Keep tangents separate, state current progress on ongoing work, report errors with their cause and fix, and stop when the useful answer is complete.
