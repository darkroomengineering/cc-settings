# Darkroom Engineering — Claude Code

Read `AGENTS.md` for coding standards and guardrails. This file contains only
Claude Code-specific rules.

## Editing

- Edit tokens are the cost to minimize: when it does not change the result,
  edit surgically instead of rewriting the file. Use Edit with the smallest
  unique `old_string` for any targeted change, whatever its size.
- Use Write only for a new file or when most of the file changes.
- After one Edit mismatch, re-read the file and retry Edit once with a wider
  anchor; on a second mismatch, Write.
- Re-read a file before editing if two or more tool calls have passed.

## Voice for text written as the user

For PRs, issues, release notes, Slack, and public text: plain human language, no
em dashes, no corporate tone, no technical detail the audience does not need.
State the real-world effect before the mechanism. Slack: ask or news in the
first line, one topic per message, owner and deadline for requests. PRs: follow
`rules/git.md` "Signal, not spam" — lead with "What this does", number review
order for large diffs, bounded checkable test-plan items. Issues: observed
effect first, numbered one-action repro steps, one problem per issue.

Kill AI tells in that text: puffery ("pivotal", "comprehensive", "crucial",
"delve"), "not just X but Y", groupings of three, headers that restate content,
decorative emojis, bold overuse, hedging, "serves as" for "is", weak verb
propped by an adverb, sycophantic closers, generic wrap-up conclusions. State a
position with concrete specifics instead of neutral abstraction; vary sentence
length.

## Replies

`output-styles/darkroom.md` is installed at `~/.claude/output-styles/` and set
through `config/10-core.json`. Main conversations get that system-prompt style;
subagents do not (only `/fork` inherits it). Subagents receive the CLAUDE.md
hierarchy instead, so the register below stays here. Built-in `Explore` and
`Plan` skip CLAUDE.md too — restate critical rules in their prompts.
Output-style changes apply after `/clear` or a new session. Users opt out via
`/config`; `bun ~/.claude/src/scripts/whats-on.ts` shows the effective style.

### Register for every reply, including subagents

Clarity is the target, not length. Never clip sentences or write fragments.

- Put the subject before its description; move modifiers after the noun.
- Prefer active voice and direct verbs. Name the actor when it matters.
- Split sentences when combining subjects or decisions creates ambiguity.
- Use the existing name for an existing thing; do not coin or capitalize an
  ordinary phrase as a concept.
- Use code identifiers only when pointing the reader at code.
- Define necessary jargon inline on first use.
- State the effect before the mechanism; never give the mechanism alone.
- Say what you mean literally. No mannered prose: metaphor or flourish in
  place of a direct statement ("a dial worth turning" for "a parameter worth
  varying") makes the reader work so the writer can perform.
- Use lists, tables, or headers when the content is multifaceted enough that
  they help the reader; keep to plain prose otherwise. This is a rule about
  when structure earns its place, not a ban on structure.

After three consecutive "still broken" turns in cc-settings, stop iterating.
Name the questionable assumption and ask one diagnostic question. If a hook
reports the same failure signature, spawn a scoped `model: "fable"` subagent on
that failing slice instead of retrying with the session model.

### Numbers

Report a delta only when both sides were measured. Never claim savings or
percentages against a run that never happened. Label extrapolation `est.` and
name its basis. Applies to summaries, PRs, `/retro`, `/proof-of-work`, and
`/autoresearch`.

## Delegation

Every subagent is a fresh context that re-pays the system prompt and re-reads
files, so delegate for scale, not by habit. Before each unit of work, ask once:
**3+ files, 20+ tool calls, or security-sensitive code?** The tool threshold is
`CC_PARALLELMAX_THRESHOLD` (default 20), enforced by `tool-cadence`. If yes:

| Work | Route |
|---|---|
| understand, find, map, blast radius | `explore` |
| build, change, fix across files | `implementer` |
| plan or architecture | `planner` |
| new test files | `tester` (**MUST**) |
| auth, payments, crypto, input validation | `security-reviewer` (**MUST**) |
| dead code or deslop | `deslopper` (**MUST**) |
| 3+ independent workstreams | parallel Agent calls in one message (**MUST**) |
| workers must debate while working | agent team |
| full feature spanning 3+ agents | `maestro` |
| premature-stopping or self-review-bias risk | dynamic workflow or `/effort ultracode`; see `skills/orchestrate/SKILL.md` |

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

**Always ask:** work in repositories outside `darkroomengineering` (report
findings only, never open an external PR), force-push or history rewrite,
deletion outside the pre-approved list, and anything visible outside the team
(publish, release).

## Claude and Codex routing

The `/codex` skill and `codex-verifier` agent bridge to the OpenAI Codex CLI;
they no-op unless installed and authenticated (`docs/codex-bridge.md`).

- **Opus/Fable:** planning, synthesis, gate decisions; never tight loop bodies.
- **Sonnet:** loop bodies and most fan-out agents (already the subagent
  default; pin `/loop` invocations explicitly).
- **Codex:** batched bulk/mechanical work, plus **one cross-model review per PR
  or `/ship`** — not per diff-turn. The `codex-verify` SessionStart hook injects
  the current policy; if absent, the bridge is down — proceed Claude-only.
  Always review Codex's diff.

Route by available quota. The statusline caches limits in
`~/.claude/tmp/rate-limits.json`; `quota-steer` raises routing urgency at
5h ≥60% or weekly ≥65%. At either ≥95%, route ALL executable work to Codex; if
the bridge is down, pause or switch to Sonnet and tell the user.

## Effort and context

`CLAUDE_CODE_EFFORT_LEVEL` pins the default at `medium` — thinking tokens are
output-priced and every inheriting agent spends them. Raise deliberately:
`/effort high` for hard non-coding reasoning, `/effort xhigh` for audits,
migrations, and hard debugging, `ultrathink` for one turn. Agent frontmatter
pins effort where depth is non-negotiable (`security-reviewer`, `planner`).
`ultracode`: session-only `xhigh` plus automatic dynamic workflows (2.1.154+).

On Fable 5.1, `medium` matches Fable 5 quality at lower cost and `low` is
viable for routine turns; but at `low` it answers from memory instead of
searching, so raise effort for turns that need fresh lookups.

Treat **200K tokens as the working context ceiling even on a 1M-window model**:
on Opus-tier models input above 200K bills at the long-context premium, and on
every model giant contexts are the main driver of drained usage limits and
degraded attention. `/clear` between unrelated tasks; compact or `/handoff` by
~150K; break subtasks to finish within that. Reserve a `[1m]` model for
sessions that genuinely need it, via `/model`, and drop it after. Fable 5 and
5.1 are the exception on price only: 1M is their default window at standard
per-token rates, and 5.1 cache reads cost 0.025x base, so on Fable the ceiling
is about usage limits and attention, not premium billing, and compaction can
run later. After compaction, re-read the plan and active files per AGENTS.md.
Output is 64K tokens by default, 128K maximum. See `docs/agent-models.md`.

## Verify fast-moving names before answering

Before recommending tools or steps for hardware, firmware, OS, docks, or
filesystem compatibility, web-search the exact model and platform: confirm the
tool exists there (including Apple Silicon), the hardware supports the assumed
licensed or chipset-gated feature, and no platform restriction blocks it.
Library and framework questions still use context7. The same rule covers any
name from a fast-moving area (AI models, developer tools, CLI flags):
recognizing a name is not knowing its current state, and partial background is
what makes a stale answer sound authoritative. Search it as the user wrote it
before answering from memory.

## Reference

- Profiles: `docs/profiles.md` · TLDR: `docs/tldr-cheatsheet.md`
- Hooks and `if` filtering: `docs/hooks-reference.md`
- Agent frontmatter: `docs/frontmatter-reference.md`
- Knowledge system: `docs/knowledge-system.md`
- Agent teams: `docs/feature-agents-guide.md`

### Hook supply-chain defense

`setup.sh` fingerprints the merged hooks block in `~/.claude/settings.json`;
`verify-hooks.ts` checks it at SessionStart. `bun run audit:hooks` classifies
hook commands and fails on suspicious ones. After an intentional hook change,
rerun `setup.sh` to refresh the fingerprint; the auditor never refreshes its
own. See `SECURITY.md`.

### Skill library ratchets

The managed library contains exactly 38 skills. `SKILL_COUNT_BASELINE` in
`src/lib/lint-skills.ts` fails when the count moves either way. The
description-byte ceiling is one-way: tighten the longest descriptions when it
fails; never raise the ceiling. `bun run lint:skills` enforces both in CI.
