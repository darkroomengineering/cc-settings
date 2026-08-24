# Darkroom Engineering — Claude Code

Read `AGENTS.md` for coding standards and guardrails. This file contains only
Claude Code-specific rules.

## Editing

- Under 10 lines: use Edit with the smallest unique `old_string`.
- Over 15 lines: use Write for the full file.
- After one Edit mismatch, switch to Write; do not retry Edit.
- Re-read a file before editing if two or more tool calls have passed.

## Voice for text written as the user

For PRs, issues, release notes, Slack, and public text: use plain human language,
no em dashes, no corporate tone, and no technical detail the audience does not
need. State the real-world effect before the mechanism.

- **Slack:** first line contains the ask or news. One topic per message. Name
  the owner and deadline for requests. Prefer three short lines; link details.
- **PR descriptions:** follow `rules/git.md` "Signal, not spam." Lead with
  "What this does," number review order for large diffs, and give bounded,
  checkable test-plan items.
- **Issue descriptions:** lead with the observed effect, use numbered
  one-action repro steps, and keep one problem per issue.

## Replies

`output-styles/darkroom.md` is installed at `~/.claude/output-styles/` and set
through `config/10-core.json` as `outputStyle: Darkroom`. Main conversations get
that system-prompt style. Subagents do not; only `/fork` inherits it. Subagents
instead receive the CLAUDE.md hierarchy, so keep the register below here.
`AGENTS.md` is portable documentation and is not loaded by Claude Code.
Built-in `Explore` and `Plan` skip CLAUDE.md too, so restate critical rules in
their prompts. Do not move this subagent copy solely into the output style.
Output-style changes apply after `/clear` or a new session, not mid-session.

### Register for every reply, including subagents

Clarity is the target, not length. Never clip sentences or write fragments.

- Put the subject before its description; move modifiers after the noun.
- Prefer active voice and direct verbs. Name the actor when it matters.
- Split sentences when combining subjects or decisions creates ambiguity.
- Use the existing name for an existing thing. Do not coin or capitalize an
  ordinary phrase as a concept.
- Use code identifiers only when pointing the reader at code; otherwise name
  the behavior in plain language.
- Define necessary jargon inline on first use.
- State the effect before the mechanism; never give the mechanism alone.

Users can opt out through `/config` or their own `outputStyle` setting. Run
`bun ~/.claude/src/scripts/whats-on.ts` to show the effective style.

After three consecutive "still broken" turns in cc-settings, stop iterating.
Name the questionable assumption and ask one diagnostic question. If a hook
reports the same failure signature, spawn a scoped `model: "fable"` subagent on
that failing slice instead of retrying with the session model.

### Numbers

Report a delta only when both sides were measured. Never claim savings, speedups,
or percentages against a run that never happened. Report counts or measured
before/after results. Label useful extrapolation `est.` and name its basis. This
applies to summaries, PRs, `/retro`, `/proof-of-work`, and `/autoresearch`.

## Delegation

Before each unit of work, ask once: **3+ files, 12+ tool calls, or
security-sensitive code?** The tool threshold is `CC_PARALLELMAX_THRESHOLD`
(default 12) and the `tool-cadence` hook enforces it. If yes, delegate first:

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
| work prone to premature stopping, self-review bias, or compaction drift | dynamic workflow or `/effort ultracode`; see `skills/orchestrate/SKILL.md` |

If no threshold fires, work directly: 1–2 file edits, known-path reads, one
search, builds/tests, and conversational answers do not need delegation.

1. Re-evaluate when scope grows. Crossing a threshold means delegate the rest.
2. State one reason before overriding a yes; sunk tool calls are not a reason.
3. Delegation needs no narration: call Agent.
4. Start independent delegations together.
5. Give **every parallel writer** `isolation: "worktree"`; readers need none.
   Writers otherwise corrupt a shared diff. Do not isolate a lone implementer.
   Review and land each returned worktree separately. After landing or
   discarding it, remove the worktree with `git worktree remove --force PATH`
   and delete its `worktree-agent-*` branch. Written worktrees persist; cleanup
   belongs to you.
6. Resume an existing agent with `SendMessage`; do not respawn and discard its
   reasoning. Respawn only for a deliberately cold review or second opinion.

`SendMessage` also reaches live Claude Code sessions shown by `/list-agents` or
`/peers`. Send only plain text; files and history do not cross, and a message
requests work but never grants permissions. An exact live-session name routes
directly; duplicate names receive a unique suffix. `@` mentions sessions.
Other-machine sessions are reply-only. This works on macOS and Linux, not
Bedrock, Vertex, or Foundry. See `docs/settings-reference.md`.

### Agent teams

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` makes teams available but not
automatic. Use a team only when workers need to see, challenge, or build on one
another's findings while working. Use parallel Agent calls for independent
results. Cost is not the deciding factor; debate is.

Team constraints:

1. Teammate permission prompts appear in the lead session; stay present.
2. `/resume` and `/rewind` do not restore teammates; teams end with the session.
3. Teammates cannot create nested teams, so teammate `maestro` cannot fan out.
4. Teammates share files. Assign distinct ownership; two writers on one file
   overwrite each other and teammate calls cannot request worktree isolation.

`TeamCreate` and `TeamDelete` no longer exist. The first teammate forms the
team; session end cleans its directories. See `docs/feature-agents-guide.md`.

### Implementer briefing contract

An implementer receives only its prompt. Every prompt **MUST** include actual
content, never references to earlier findings:

1. the user's original ask verbatim;
2. exact file paths and line ranges;
3. the concrete change or pasted plan/fix, never "based on findings";
4. verification commands and machine-checkable expected output;
5. off-limits scope;
6. conditions that require stopping instead of improvising;
7. for port/adapt/migrate/clone work, the source artifact and version, required
   fidelity, allowed deviations, and "STOP if the source cannot be read";
8. prior attempts, rejected approaches, and why when work has history.

Thin prompts cause regressions and must be refused. The implementer edits the
live worktree, leaves changes uncommitted, and reports verification plus changed
files. Full contract: `agents/implementer.md`. It also applies to
`explore → implementer` and `planner → implementer` chains.

## Autonomy

Act first and report afterward for reversible work inside the approved scope,
including:

- defects found during requested work;
- dependency bumps that pass typecheck and tests;
- local and remote branch cleanup after a merge;
- scoped fixes for failing CI on an approved PR;
- doc-only or changelog-only commits;
- one rerun of a flaky check.

This is a floor, not a whitelist. Ask only where required below.

**Always ask:** any work in a repository outside `darkroomengineering` (never
open an external/agency PR; report findings only), force-push or history rewrite,
deletion outside the pre-approved list, and any publish, release, or other
action visible outside the team.

For full orchestration, use `profiles/maestro.md`. Agent model routing lives in
`docs/agent-models.md`.

## Claude and Codex routing

The `/codex` skill and `codex-verifier` agent bridge to the OpenAI Codex CLI.
They no-op unless Codex is installed and authenticated. Status shows
`codex ✓`, `auth?`, or `⏳`; see `docs/codex-bridge.md`.

- **Opus:** planning, synthesis, and gate decisions; never tight loop bodies.
- **Sonnet:** loop bodies and most fan-out agents. The default subagent model is
  already Sonnet; pin each invocation because `/loop` has no model setting.
- **Codex:** default-on cross-model diff review and batched bulk/mechanical work.
  The `codex-verify` SessionStart hook injects the current policy and commands.
  If absent, the bridge is down: proceed Claude-only. Always review Codex's diff.

Route by available quota. If Codex drains, continue Claude-only. The statusline
stores Claude limits in `~/.claude/tmp/rate-limits.json`. `quota-steer` increases
routing urgency at 5h ≥60% or weekly ≥65%. At either limit ≥95%, route **ALL**
executable work to Codex; if the bridge is down, pause or switch to Sonnet, and
tell the user. The statusline then shows `→codex`.

## Effort and context

`CLAUDE_CODE_EFFORT_LEVEL` pins the default at `high`. `/effort xhigh` changes a
session; `ultrathink` raises one turn. Agent frontmatter can set `effort`.

- `low`: trivial, latency-sensitive lookups.
- `medium`: routine edits that do not need depth.
- `high`: default for non-coding intelligence.
- `xhigh`: audits, migrations, and hard debugging.
- `max`: extreme cases only; it often overthinks.
- `ultracode`: session-only `xhigh` plus automatic dynamic workflows; requires
  Claude Code 2.1.154+ and resets when the session ends.

Higher effort spends more thinking tokens for every inheriting agent. Raise
effort when `low` or `medium` under-thinks; do not compensate with prompt hacks.

The default `claude-opus-5` model has a native 1M-token Max context; subagents
inherit it. Compact manually at 65% rather than waiting for auto-compaction.
Break subtasks to finish within 45%. After compaction, re-read the plan and
active files per AGENTS.md. The prompt cache expires after five idle minutes;
use `/clear` between unrelated tasks and `/handoff` for long sessions. Output is
64K tokens by default and 128K maximum. See `docs/agent-models.md`.

## Hardware and platform recommendations

Before recommending tools or steps for hardware, firmware, OS, docks, or
filesystem compatibility, web-search the exact model and platform. Verify:

1. the tool exists for that platform, including Apple Silicon where relevant;
2. the hardware supports the assumed licensed or chipset-gated feature;
3. platform restrictions such as Hypervisor.framework PCIe passthrough limits,
   unsigned-kext rejection, or iOS raw-USB restrictions.

This rule covers consumer hardware and platform integration. Library and
framework questions still use context7.

## Reference

- Profiles: `docs/profiles.md`
- TLDR: `docs/tldr-cheatsheet.md`
- Hooks and `if` filtering: `docs/hooks-reference.md`
- Agent frontmatter: `docs/frontmatter-reference.md`
- Knowledge system: `docs/knowledge-system.md`
- Agent teams: `docs/feature-agents-guide.md`

The native Skill tool handles matching.

### Hook supply-chain defense

`setup.sh` fingerprints the merged hooks block in `~/.claude/settings.json`.
`verify-hooks.ts` checks it at SessionStart and warns on mismatch.
`bun run audit:hooks` classifies commands as trusted, unknown, or suspicious and
exits 1 for suspicious hooks. The installer preserves custom hooks; after an
intentional change, rerun `setup.sh` to refresh the fingerprint. The auditor
must never refresh its own fingerprint. See `SECURITY.md`.

### Skill library ratchets

The managed library contains exactly 38 skills. `SKILL_COUNT_BASELINE` in
`src/lib/lint-skills.ts` fails when the count rises **or falls**; consolidation
or a reviewed baseline change must accompany every movement. The same command
checks naming, frontmatter, and `ACTIVE_SKILLS` parity. The description-byte
ceiling is one-way: tighten the longest descriptions when it fails; do not raise
the ceiling to accommodate drift. `bun run lint:skills` enforces both in CI.
