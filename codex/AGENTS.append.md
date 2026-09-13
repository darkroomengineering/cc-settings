# Codex host adapter

This section supersedes Claude-only mechanics in the portable `AGENTS.md` when the host is standalone Codex. The engineering standards, guardrails, and product intent in the portable file still apply.

## Native mechanics

- Use the native custom agents installed in `$CODEX_HOME/agents` (or the active Codex home). Create a new
  agent with `spawn_agent`, deliver context while it runs with `send_message`,
  trigger another turn once it is idle with `followup_task`, wait with
  `wait_agent`, and stop its current turn with `interrupt_agent` only when
  necessary.
- Use `apply_patch` for file edits and `exec_command` for shell commands. Do not translate these back to Claude tool names.
- Every agent is a fresh context that re-pays the instructions and re-reads files, so delegate for scale, not by habit. Before each unit of work, ask once: **3+ files, 12+ tool calls, or security-sensitive code?** If no threshold fires, work directly. Re-evaluate when scope grows; state one reason before overriding a yes. This is the same threshold and routing Claude Code uses, so the two hosts should feel alike.

  | Work | Route |
  |---|---|
  | understand, find, map, blast radius | `explore` |
  | build, change, fix across files | `implementer` |
  | plan or architecture | `planner` |
  | new test files | `tester` (**MUST**) |
  | auth, payments, crypto, input validation | `security-reviewer` (**MUST**) |
  | dead code or deslop | `deslopper` (**MUST**) |
  | 3+ independent workstreams | parallel `spawn_agent` calls in one turn (**MUST**) |
  | full feature spanning 3+ agents | `maestro` |

- Start independent delegations together and keep working while they run; wait only when the next step depends on their result. Resume an existing agent with `send_message` or `followup_task` instead of spawning a replacement; a respawn repurchases its whole context. Respawn only for a deliberately cold second opinion.
- Give every implementer the full briefing contract from the portable `AGENTS.md`: the user's ask verbatim, exact paths and line ranges, the concrete change, verification commands with expected output, off-limits scope, and stop conditions. Thin prompts must be refused.
- Never spawn `codex-verifier` and never call the Claude-to-Codex bridge from standalone Codex. For an independent review from another model family, spawn `claude-verifier` (read-only, calls Claude Opus 5 through `claude-run.ts`; needs network, so approve the escalation when prompted). For a same-family second opinion, spawn a fresh `reviewer`; for adversarial verification, use separate issue-finder, disprover, and judge agents.
- Native agents carry a `model`: judgment roles run on GPT-6 Astra, execution roles on GPT-5.6 Sol. Delegate long execution to Sol-backed roles and keep decisions in the session.
- Writers share the working tree unless the live host explicitly offers
  isolation. Assign non-overlapping file ownership and serialize implementer
  and test-writer phases. Only read-only reviewers may overlap. Never promise a
  Codex implementer Claude worktree isolation.
- Invoke a shared skill as `$skill-name`. When a skill has product-aware branches, always choose its standalone-Codex branch.
- Use `/hooks` to inspect and manage hook trust. Use `/status` for native session, model, sandbox, and usage status. Codex exposes no API for reproducing Claude's exact statusline rendering.

## Persistence and boundaries

- Define done before starting. When a task includes getting the change running, inspecting the result, and fixing what fails, treat all of that as the task. Do not return after a first implementation for a review the request did not ask for.
- The repository's local checks (typecheck, tests, lint, build) are the verification gate. Run them, fix failures your change caused, and rerun the affected checks without asking for approval at each step.
- "Ask first" language in the portable standards exists for destructive or irreversible actions and for a direction only the user can choose. It is not a reason to stop reversible in-scope work. The 2-iteration limit still applies: after two failed attempts with one approach, switch to the best alternative and say so.

## Response shape

Lead with the result or next action. Number multi-step work with one bounded action per step. Take reversible in-scope actions instead of offering them. Ask only when the user owns a material or irreversible choice. Keep tangents separate, state current progress on ongoing work, report errors with their cause and fix, and stop when the useful answer is complete.
