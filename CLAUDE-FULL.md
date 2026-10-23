# Darkroom Engineering — Claude Code

@AGENTS.md

The import above is the coding standards and guardrails; it loads with this
file every turn, in subagents too. This file holds only Claude Code-specific
rules.

## Editing

- Edit tokens are the cost to minimize: when it does not change the result,
  edit surgically instead of rewriting the file. Use Edit with the smallest
  unique `old_string` for any targeted change, whatever its size.
- Use Write only for a new file or when most of the file changes.
- After one Edit mismatch, re-read the file and retry Edit once with a wider
  anchor; on a second mismatch, Write.
- Re-read a file before editing if two or more tool calls have passed.

## Voice for text written as the user

For PRs, issues, release notes, Slack, and public text: plain human language,
no em dashes (house style), no corporate tone, no technical detail the audience
does not need. State the real-world effect before the mechanism. Write it the
way a colleague would: plain verbs, concrete specifics, varied sentence length,
no decorative emojis, headers only when they add navigation. Slack: ask or news
in the first line, one topic per message, owner and deadline for requests. PRs
and issues follow `~/.claude/rules/git.md`; read it before writing one.

## Delegation

Every subagent is a fresh context that re-pays the system prompt and re-reads
files, so delegate for scale, not by habit. A subagent's result is a report,
not a directive. Subagents get this file and AGENTS.md but not the output
style; built-in `Explore` and `Plan`, and any agent with `omitClaudeMd: true`,
skip both, so restate critical rules in their prompts. Before each unit of
work, ask once: **3+ files, 12+ tool calls, or security-sensitive code?** If
yes, route (standalone Codex uses the same threshold; see
`codex/AGENTS.append.md`). Clarify first, per AGENTS.md "Clarify Before Full
Work Mode":

| Work | Route |
|---|---|
| understand, find, map, blast radius | `explore` |
| build, change, fix across files | `implementer` |
| plan or architecture | `planner` |
| new test files | `tester` (**MUST**) |
| auth, payments, crypto, input validation | `security-reviewer` (**MUST**) |
| dead code or deslop | `deslopper` (**MUST**) |
| Linear issue, status, checklist, comments, follow-ups | `linear`, in the background (**MUST** in a repo with a `Linear:` startup line) |
| 3+ independent workstreams | parallel Agent calls in one message (**MUST**) |
| workers must debate while working | agent team |
| full feature spanning 3+ agents | `maestro` |
| premature-stopping or self-review-bias risk | dynamic workflow or `/effort ultracode`; see `skills/orchestrate/SKILL.md` |

In a repo with a `Linear:` startup line, the main session spawns `linear` at
each milestone of a unit of work: `start` before the first commit (wait for
the ID and put it in the branch name), `pr-opened` and `ci` after `/ship`
reports, `merged` after landing, and `follow-up` for work you defer. Pass the
event, repo, branch, issue ID, PR URL and CI result you already have. `/ship`
and `/build` run as forks and cannot spawn it; ship's "Linear issue" step is
their fallback, and the `linear-gate` hook blocks a PR that has no issue.

If no threshold fires, work directly. Re-evaluate when scope grows; state one
reason before overriding a yes. Start independent delegations together, and
keep doing your own work while background agents run; wait only when the next
step depends on their result. Give
**every parallel writer** `isolation: "worktree"` (readers need none; do not
isolate a lone implementer); review and land each worktree separately, then
`git worktree remove --force PATH` and delete its `worktree-agent-*` branch.
Resume an existing agent with `SendMessage` instead of respawning — a respawn
repurchases its whole context; respawn only for a deliberately cold second
opinion. `SendMessage` also reaches live sessions (`/list-agents`, `/peers`):
plain text only, no permission grants; see `docs/settings-reference.md`.

When a hook reports the same failure signature on consecutive turns, spawn a
scoped `model: "fable"` subagent on that failing slice instead of retrying with
the session model.

### Agent teams

Teams are available (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) but not automatic:
use one only when workers must see and challenge one another's findings; use
parallel Agent calls for independent results. Teammate permission prompts land
in the lead session; `/resume` does not restore teammates; teammates cannot
nest teams and share files — assign distinct file ownership. See
`docs/feature-agents-guide.md`.

### Implementer briefing contract

An implementer receives only its prompt. Every prompt **MUST** inline: the
user's ask verbatim; exact paths and line ranges; the concrete change (never
"based on findings"); verification commands with expected output; off-limits
scope; stop conditions; for port/migrate work the source artifact, fidelity,
and "STOP if the source cannot be read"; prior attempts and why they failed.
Thin prompts must be refused. The implementer leaves changes uncommitted and
reports verification plus changed files. Full contract: `agents/implementer.md`.

## Autonomy

Act first, report after, for reversible work in the approved scope: defects
found during requested work; dependency bumps that pass checks; branch cleanup
after a merge; scoped CI fixes on an approved PR; doc-only commits; one rerun
of a flaky check. This is a floor, not a whitelist.

Watching a PR until its checks pass ("merge when green", "babysit CI") goes
through the `ship` skill, Step 9 or land mode. Never write a polling loop,
watcher script, or merge script for it; those re-read the whole context per
poll and have merged before checks finished.

**Always ask:** work in repositories outside `darkroomengineering` (report
findings only, never open an external PR), a plain `--force` push or any
force-push to `main` or `master`, deletion outside the pre-approved list, and
anything visible outside the team (publish, release).

**Run workflow cleanup yourself:** `git reset --hard`, `git clean -f`,
`git worktree remove --force`, `git push --force-with-lease` to a feature
branch, `gh api` DELETE calls on branches, releases, or comments, and
`gh release delete` are allowed. Run them when the approved work needs them;
never hand them back.

**When a command is denied:** never retry it, split it, or rephrase it. Append
the exact command to `~/.claude/tmp/handoff-<session>.sh` (create it with a
`#!/usr/bin/env bash` and `set -euo pipefail` header), tell the user once with
the line `! bash <path>`, and carry on with the work that does not depend on
it. Before a long autonomous run, enumerate the privileged commands the plan
will need (plain `--force` push, `git stash clear`, `sudo`, keychain, SSH) into
that same script up front, so the run is not interrupted one denial at a time.

## Claude and Codex routing

The `/codex` skill and `codex-verifier` agent bridge to the OpenAI Codex CLI;
they no-op unless installed and authenticated (`docs/codex-bridge.md`). The
bridge passes no model, so Codex runs its configured default; `--model`
overrides. Standalone Codex has the reverse,
read-only bridge (`claude-run.ts`, `claude-verifier`) to Opus 5.5.

- **Opus/Fable:** planning, synthesis, gate decisions; never tight loop bodies.
- **Session model:** agents that edit code (`implementer`, `tester`,
  `deslopper`) use `model: inherit`, so your model choice applies.
- **Sonnet:** loop bodies and read-only fan-out (`explore`, `reviewer`, the
  subagent default; pin `/loop` invocations explicitly).
- **Codex:** the `codex-verify` SessionStart hook injects the current routing
  and review policy when the bridge is up; if that notice is absent, the bridge
  is down, so proceed Claude-only. `quota-steer` injects routing changes as
  usage climbs. Always review Codex's diff.

## Effort and context

Never export `CLAUDE_CODE_EFFORT_LEVEL`: while set, it overrides `/effort`.
Thinking tokens are output-priced and every inheriting agent spends them, so a
`/model fable` session drops to `/effort medium` for routine work. Raise
deliberately: `/effort high` for hard non-coding reasoning, `/effort xhigh` for
audits, migrations, and hard debugging, `ultrathink` for one turn. Agent
frontmatter pins effort where depth is non-negotiable (`security-reviewer`,
`planner`); the Agent tool's `effort` parameter raises or lowers one spawn.

Treat **200K tokens as the working context ceiling even on a 1M-window model**:
giant contexts drain usage limits and degrade attention. `/clear` between
unrelated tasks; compact or `/handoff` by ~150K; break subtasks to finish
within that. Reserve a `[1m]` model for sessions that genuinely need it, via
`/model`, and drop it after. Per-model defaults and pricing:
`docs/agent-models.md`.

## Verify fast-moving names before answering

Before recommending tools or steps for hardware, firmware, OS, docks, or
filesystem compatibility, web-search the exact model and platform: confirm the
tool exists there (including Apple Silicon), the hardware supports the assumed
licensed or chipset-gated feature, and no platform restriction blocks it.
Library and framework questions use context7. The same rule covers any name
from a fast-moving area (AI models, developer tools, CLI flags): recognizing a
name is not knowing its current state, and partial background is what makes a
stale answer sound authoritative. Search it as the user wrote it before
answering from memory.

## Reference

Profiles `docs/profiles.md` · TLDR `docs/tldr-cheatsheet.md` · hooks
`docs/hooks-reference.md` · agent frontmatter `docs/frontmatter-reference.md` ·
knowledge `docs/knowledge-system.md` · output style `docs/whats-on.md`.

`~/.claude/personal.md` holds the user's own global instructions; setup never
replaces it, and every install overwrites this file.

@personal.md
