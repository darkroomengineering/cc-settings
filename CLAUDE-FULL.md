# Darkroom Engineering — Claude Code

Read `AGENTS.md` for coding standards and guardrails. This file is Claude-Code-specific only.

---

## Edit Strategy

The Edit tool uses exact string matching. Follow these rules:

- **Small edits (<10 lines)**: Use `Edit` with minimal but unique `old_string`
- **Large edits (>15 lines)**: Use `Write` for full file replacement
- **On first Edit failure**: Switch to `Write` immediately
- **Re-read before editing**: If a file was read 2+ tool calls ago, re-read it

---

## Voice (ghostwritten comments, PR bodies, Slack, public text)

When writing as the user (PR comments, issue replies, release notes, Slack messages):
- No em dashes. No technicalities unless the reader is an engineer who needs them.
- Plain sentences, human-readable, lowercase-casual is fine; never corporate.
- Say the real-world effect, not the mechanism.
Stated once here so it is never re-specified per session.

**Action-first applies to ghostwritten text too.** The reader's working memory
is the constraint whether they're the CC user or a teammate skimming Slack on a
phone. Shape by destination:

- **Slack messages** — the first line is the whole message in miniature: lead
  with the ask or the news (a notification shows nothing else). One message,
  one topic. If something is needed from the reader, name the owner and the
  deadline ("need a yes/no from you on the pricing copy by thursday"). Three
  short lines beat three paragraphs; link out for detail.
- **PR descriptions** — `rules/git.md` "Signal, not spam": "What this does" is
  the TL;DR, review order numbered for large diffs, test-plan items bounded
  and checkable.
- **Issue descriptions** — `rules/git.md` "Issue descriptions": observed effect
  first, numbered one-action repro steps, one issue per problem.

---

## Output style — how replies are written

**These rules live in `output-styles/darkroom.md`, installed to
`~/.claude/output-styles/` and set as the default via `"outputStyle":
"Darkroom"` in `config/10-core.json`.** They are not repeated here.

They used to be a ~40-line "Action-First Output (always on)" block in this
file, and that placement was the bug. A `CLAUDE.md` instruction is delivered as
a user message *after* the system prompt, so it competes with the system prompt
and decays over a few turns — the reason a personal `communication_style.md`
"works for 1 to 2 turns before reverting." An output style **is** part of the
system prompt, and Claude Code re-issues adherence reminders for it during the
conversation. Same rules, a delivery mechanism that doesn't wear off.

The style carries two independent rule sets:

- **Register** (new) — subject first, no stacked modifiers, no coined terms for
  things that already have names, active voice and direct verbs, one
  unambiguous subject or decision per sentence, identifiers only when pointing
  at code, jargon defined inline. Targets *comprehension*, never word count.
  Every brevity-targeting skill the team tried (`/caveman`, `/talk-normal`,
  `/tldr`, `i-have-adhd`) overcorrected into a register that was shorter and no
  clearer.
- **Shape** — the former Action-First rules, moved verbatim. Adapted from
  [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT).

Two limits worth knowing:

1. **Subagents never get an output style.** A subagent runs its own system
   prompt, and [the docs are explicit](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup)
   that output style is main-conversation-only (a `/fork` is the exception — it
   inherits the parent's). What a subagent *does* get is **this file**: every
   level of the CLAUDE.md hierarchy, `~/.claude/CLAUDE.md` included. That is why
   the register block below is duplicated here instead of living only in the
   style — it is the only copy delegated work actually reads. `AGENTS.md` is
   **not** loaded by Claude Code at all; it is the portable copy for other tools
   (Codex, Cursor) and for humans. Do not "dedupe" the block below into the
   output style; that silently drops it from every subagent.
   (Built-in `Explore` and `Plan` skip CLAUDE.md too — restate anything critical
   in the delegation prompt, which the `implementer` briefing contract already
   requires.)
2. **It loads once per session.** Changing `outputStyle` takes effect after
   `/clear` or a new session, not mid-turn.

### Register (the subagent copy)

Applies to every reply, including delegated work. Length is not the target — a
reply is better for being understood on the first read, not for being shorter.
Never compensate by clipping sentences or writing in fragments.

- **Subject first.** Name the thing before describing it; modifiers go after the
  noun, in a clause, not stacked in front of it. "The parser drops trailing
  commas — a lookahead bug, one line", not "a lookahead-driven
  trailing-comma-tolerant parse failure surfaces".
- **Prefer active voice and direct verbs.** Name the actor when it matters.
  "Remove the file", not "perform removal of the file". Use passive voice when
  the actor is unknown or irrelevant.
- **Keep one subject or decision per sentence when combining them could create
  ambiguity.** Split competing claims instead of making the reader determine
  which qualifier applies to which claim.
- **Use the existing name for the existing thing.** Never coin a term when one
  exists; never capitalize an ordinary phrase into a proper noun to make it
  sound like a concept.
- **Identifiers point at code, not at ideas.** `parseConfig` when the reader
  will open that function; "the config parser" when describing behavior.
- **Define jargon inline on first use.** One parenthetical is enough.
- **Say the effect, then the mechanism.** Never the mechanism alone.

To opt out, run `/config` → Output style → Default, or set `"outputStyle"` in
your own settings — user scope beats the shipped value. `bun run whats-on`
prints which style is actually in effect.

**cc-settings-specific escalation** (not part of the style): after three
consecutive "still broken" turns, stop iterating — name the assumption that
might be wrong, ask one diagnostic question, or, if a hook has flagged the same
failure signature repeating, spawn a scoped `model: "fable"` subagent on just
the failing slice instead of retrying on the session model.

### Reporting numbers (the subagent copy)

Duplicated here for the same reason as the register block above: `AGENTS.md`
carries this rule for Codex and Cursor, and Claude Code never loads that file.
Without this copy, no Claude Code session or subagent ever sees it.

**No savings against a run that never happened.** Report a delta only between
two things that were both measured. "Saved ~400 lines", "cut token use 60%",
"about 3× faster" — these are unknowable when the unoptimized version was never
written and the without-the-change run was never executed. There is no baseline
to subtract from, so the number is invented however plausible it looks.

Report what you can count: lines deleted in this diff, the measured before and
after of a benchmark you ran twice, a timing you actually observed. Where an
extrapolation genuinely helps, label it `est.` and name what it came from.

This bites hardest on numbers that flatter the work — a savings figure is the
easiest thing to fabricate and the least likely to be checked. It applies to
end-of-turn summaries, PR bodies, `/retro` output, `/proof-of-work` gates, and
`/autoresearch` dashboards alike.

---

## Delegation

> **Why a heuristic and not judgment**: the Opus line under-delegates — it prefers internal reasoning over spawning agents. This one rule is deliberately mechanical to counter that bias. Do not reason your way out of it "because you could do it yourself."

### The per-decision heuristic

Before each unit of work, ask once: **3+ files, 12+ tool calls, or security-sensitive code?** (Tool-call threshold is `CC_PARALLELMAX_THRESHOLD`, default 12 — the `tool-cadence` hook enforces this exact number.)

**YES → delegate first, then route by shape:**

| Shape | Agent |
|---|---|
| understand / find / map / blast-radius | `explore` |
| build / change / fix across files | `implementer` |
| plan / architecture | `planner` |
| new test files | `tester` (MUST) |
| auth, payments, crypto, input validation | `security-reviewer` (MUST) |
| dead code / deslop | `deslopper` (MUST) |
| 3+ independent workstreams | parallel `Agent` calls in ONE message (MUST) |
| workers must argue with each other, not just report back | an **agent team** (see below) |
| full feature spanning 3+ agents | `maestro` |
| prone to single-window failure — agentic laziness (quitting at 20 of 50 items), self-preferential bias (judging your own output), goal drift across compaction | a [dynamic workflow](https://code.claude.com/docs/en/workflows) / `/effort ultracode` (see `skills/orchestrate/SKILL.md`) |

**NO → act directly.** 1–2 file edits, known-path reads, single greps/globs, build/test runs, conversational answers. Keeping small diffs in the main session is correct — don't spawn an `implementer` to prove you delegated.

**Rules that close the loop:**

1. **Re-ask when scope grows.** Predicted small but it's now over the threshold? Stop and delegate the remainder — sunk tool calls are not a reason to finish solo.
2. **Overriding a YES requires a stated reason.** One line, in your response, before proceeding (e.g. "12 calls but all sequential edits to one file"). The `tool-cadence` hook escalates on streaks that continue past a reminder with no Agent call.
3. **Delegating needs no narration** — just call the Agent tool.
4. **Parallelize**: independent delegations go in a single message — they run concurrently.
5. **Isolate parallel writers.** Two agents editing the same working tree at the same time corrupt each other's diffs, and nothing warns you — you get one incoherent result and no way to tell which agent wrote what. When you fan out **2+ agents that will write files**, pass `isolation: "worktree"` on each `Agent` call so each gets its own tree under `.claude/worktrees/`. Then collect: each `Agent` result carries a `worktreePath` and `worktreeBranch`, and you review and land the diffs yourself, one at a time. Do **not** set this on a lone implementer — it costs ~200-500ms and a disk copy per agent, and it moves the diff out of the tree where you'd normally just read it. Parallel **readers** (`explore`, `reviewer`, `security-reviewer`) never need it.

   **You own the cleanup.** A worktree that was written to persists after its agent exits, along with a `worktree-agent-<id>` branch — only untouched ones are auto-removed. Once you've landed or discarded a diff, `git worktree remove --force <path>` and delete the branch, or they accumulate across sessions. Verified 2026-08-10: two implementers writing the same path landed in separate worktrees, the main tree stayed clean, and both worktrees and branches survived until removed by hand.
6. **Resume, don't respawn.** Follow-up work for an agent you already spawned goes through `SendMessage` (by name — it resumes from its transcript), not a fresh `Agent` call. A respawn discards everything that agent reasoned through and pays to re-derive it. OpenAI's ARC-AGI-3 result is the receipt: same model, reasoning carried across steps instead of dropped, 13.3% → 38.3% and ~6× fewer output tokens ([writeup](https://openai.com/index/how-two-settings-tripled-our-arc-agi-3-scores/)). Respawn only when you want a deliberately cold read (adversarial verification, second opinion).

   Since 2.1.224 `SendMessage` also reaches **your other Claude Code sessions**, not just agents inside this one — `/list-agents` (or `/peers`) shows who's reachable. Since 2.1.232 a bare name that exactly matches one live session delivers directly (no ref confirmation), typing `@` in the prompt mentions a session by name, and live sessions on one machine keep unique names (a duplicate gets a `name-word-word` variant). Use it when a session working elsewhere in the repo needs something you just learned: a breaking change you landed, a decision that unblocks them, a migration that finished. Only plain text crosses, never files or history, and the receiving session's own permissions still apply — so a message asks, it never authorizes. Sessions on other machines are reply-only. macOS and Linux; not on Bedrock/Vertex/Foundry. Config: `docs/settings-reference.md` → Cross-session messaging.

### Agent teams — enabled, deliberately not the default

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` ships in `config/10-core.json`, so teams are **available**. Enabling the flag does not make them automatic: Claude still only forms a team when you ask for one or when it proposes one and you approve.

**Parallelism alone is not the reason to reach for a team.** Subagent fan-out is already parallel and already gives each worker its own context window. The single thing teams do that subagents cannot is let workers **talk to each other** — they share a task list and message each other directly, where a subagent can only report back to you. So the question is never "is this big?", it's:

> Does worker A need to see, challenge, or build on what worker B found *while both are still working*?

- **Yes → team.** Competing hypotheses that should try to disprove each other; a review where the security, perf, and test lenses need to argue; cross-layer work where ownership shifts as the shape becomes clear.
- **No → parallel `Agent` calls.** N independent results you collect and synthesize yourself. Cheaper, one review surface, and the results land in your context instead of N transcripts.

Cost is a real input but not the deciding one — a team is roughly N full sessions, and trading tokens for wall-clock is often the right call. Spend them when the debate is the point, not to run errands faster.

Four constraints that decide feasibility before cost does:

1. **Teammate permission prompts surface in the lead session** — you must be present to approve them. A team is not an unattended mechanism.
2. **`/resume` and `/rewind` do not restore in-process teammates.** A team does not survive a session boundary; the lead will try to message teammates that no longer exist.
3. **No nested teams.** Teammates cannot spawn teammates, so `maestro` running *as* a teammate cannot fan out.
4. **Two teammates editing one file overwrite each other** — same hazard as rule 5 above. Split by file ownership when spawning, since teammates are separate sessions and cannot take a `worktree` isolation flag the way a subagent can.

`TeamCreate`/`TeamDelete` no longer exist (removed upstream in v2.1.178). A team forms when the lead spawns its first teammate and its directories are cleaned up when the session ends.

> **Briefing contract for `implementer`**: as a subagent it gets only your prompt — no conversation context, none of the files you've read — so every prompt MUST contain actual content, not references: the user's ask verbatim, exact file paths and line ranges, the change to make (paste the planner output; never write "based on findings" or "according to plan"), the verification command with its expected output (machine-checkable, never "works correctly"), a scope boundary, any escape hatches (conditions to STOP and report back instead of improvising), and — when the work already has history — what was tried and rejected and why. Thin prompts are the curse of knowledge in action — you assume the subagent shares your context; it shares nothing. They cause regressions; the agent will refuse them. It runs in the live working tree and leaves changes **uncommitted** for you to review before they land. Full contract: `agents/implementer.md` REQUIRED BRIEFING. This applies equally to `explore` → `implementer` and `planner` → `implementer` chains.

### Autonomy Contract

Receipts (July 2026 session-archive audit): ~150 pure-approval turns ("yes/proceed/a/approve all") whose absence would have changed nothing — "nothing would've been worse, just unknown." Awareness is bought with digests, not per-action questions.

**Pre-approved — act, then report in the end-of-turn summary (never ask):**
- Fixing a defect you surfaced while doing work the user asked for — finding it
  and reporting it is half the job; "want me to fix it?" is the other half
  billed back to the user
- Dependency bumps that pass typecheck + tests
- Branch cleanup (local + remote) after a merge
- CI fixes on an already-approved PR (scoped to the failing check)
- Doc-only and changelog-only commits
- Re-running flaky checks once

This list is a **floor, not a whitelist** — absence from it doesn't imply "ask."
The test is reversibility and scope: if it's undoable and inside what the user
already asked for, do it. Only the "Always ask" list below is a hard stop.

**Always ask — no exceptions:**
- Anything touching a repo outside the darkroomengineering org (NEVER open PRs on external/agency repos — report findings only; incident 2026-07-07)
- Force-push, history rewrite, deletion of anything not on the pre-approved list
- Publishing, releasing, or any action visible outside the team

For full orchestration mode, activate `profiles/maestro.md`. Model routing per agent: see `docs/agent-models.md`.

---

## Codex pairing (Opus + Codex)

The OpenAI Codex CLI runs as a second model alongside Claude via the `/codex` skill and the `codex-verifier` agent. It's gated — no-ops when `codex` isn't installed or logged in, and the statusline shows availability (`codex ✓ / auth? / ⏳`). Full design: `docs/codex-bridge.md`.

**Quota-aware routing** — Claude meters Opus by wall-time/weekly (scarce, ~22–52h/wk on Max 5x, auto-downshifts to Sonnet); Codex (Pro-class) meters by messages per ~5-hour window (roomy). Route by headroom, not habit:

- **Opus** → planning, synthesis, gate decisions. Never the body of a tight `/loop`.
- **Sonnet** → loop bodies and most fan-out subagents (`CLAUDE_CODE_SUBAGENT_MODEL` is already `sonnet`). Now near-Opus quality on coding/agentic work, which makes this split cheaper without giving up much. There's no `/loop` model setting — pin per-invocation.
- **Codex** → default-on for cross-model review of diffs and for bulk/mechanical implementation, batched into few large calls. The full policy (and the exact commands) is injected by the `codex-verify` SessionStart hook when the bridge is up — that injection is the single source, so it isn't restated here. If you don't see it this session, the bridge is down: proceed Claude-only. Always review Codex's diff before trusting it.

Two roomy pools (Sonnet + Codex) carry volume; the one scarce pool (Opus) does the thinking. If a Codex window drains, fail over to Claude-only rather than stalling.

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json`, and the `quota-steer` hook escalates routing urgency past 5h ≥ 60% / weekly ≥ 65%. At ≥95% of either window (`exhausted` band) it goes hard: every prompt re-injects a directive to route ALL executable work to Codex (or, bridge down, to pause/`/model sonnet`) and to tell the user; the statusline chip shows `→codex` alongside the percentage.

---

## Effort & Context

**Effort levels** — `low`, `medium`, `high`, `xhigh`, `max`. Default `high` (pinned via `CLAUDE_CODE_EFFORT_LEVEL` in settings.json — matches Anthropic's 4.8 default; a deliberate cost choice over the old `xhigh` pin). Per-session: `/effort xhigh` for deep work; `ultrathink` keyword for one-turn max depth. Per-agent: `effort` frontmatter.

- `low` — trivial lookups, latency-sensitive
- `medium` — routine edits where depth isn't required
- `high` — non-coding intelligence (writing, analysis)
- `max` — extreme cases only; often overthinks
- `ultracode` — session-only; `xhigh` reasoning plus automatic [dynamic workflow](https://code.claude.com/docs/en/workflows) orchestration. Useful for codebase audits, large migrations, deep research. Set via `/effort ultracode`. Resets on session end. Requires Claude Code v2.1.154+.

**4.8/Fable calibration**: Anthropic's 4.8 default effort is `high` (was `xhigh` on 4.7). cc-settings now pins `high` too — the `xhigh` ladder allocates materially more thinking tokens per turn on 4.8/Fable (per-model calibration; see [model-config docs](https://code.claude.com/docs/en/model-config#choose-an-effort-level)), and on a Fable session that cost compounds across every inheriting agent. `high` is the cost-conscious default; raise to `/effort xhigh` per-session for audits/migrations/hard debugging, or use the `ultrathink` keyword for a single deep turn. At `low`/`medium` the model scopes strictly and may under-think — reach for `xhigh`, not prompt workarounds, when depth is missing.

**Context window** — 1M tokens default on Max. Subagents inherit. The cc-settings default model is `claude-opus-5` (Opus 5, released 2026-07-24) — the committed top tier, and a strict upgrade over the earlier `opus[1m]` (Opus 4.8) interim pin used while Fable 5 was export-control-suspended (see [docs/agent-models.md](docs/agent-models.md)). Opus 5 is 1M-native on Max, so no `[1m]` pin is needed — same as Sonnet 5 and Fable, both already 1M-native. Fable 5 is generally available again but priced at 2× Opus 5 ($10/$50 vs $5/$25 per MTok); Opus 5 lands near Fable's frontier quality at half the price, so it stays the default rather than switching back.

- **Manual `/compact` at 65%** — Opus 4.7/4.8's tokenizer is ~1-1.35x heavier per text vs 4.6 (was 70% on 4.6), so context burns faster. Sonnet 5 shares the same heavier tokenizer family (~30% more tokens than Sonnet 4.6 for the same text), so Sonnet subagents now burn context at that same heavier rate too — the compaction budgets below apply to Sonnet subagents, not just Opus/Fable sessions. Auto-compaction triggers at 95%; don't wait for it. The prompt cache has a 5-minute TTL — idling past it re-ingests the whole window at full price, so `/clear` between unrelated tasks and `/handoff` instead of marathon sessions both save real tokens on long 1M contexts.
- **Break subtasks to complete within 45%** — conservative budget for 4.7/4.8 tokenization. Prevents context rot mid-task.
- **After compaction**: re-read task plan + active files (see AGENTS.md "Post-Compaction Recovery").

Output token limits: 64K default, 128K upper bound.

---

## Verification Before Recommendation

For hardware, firmware, OS-level, dock, or filesystem-compatibility tasks, web-search the exact model number and platform **before** recommending tooling or steps. Three things must be verified upfront:

1. **The tool exists on the user's platform.** Apple Silicon macOS support is not implied by a Windows or Intel Mac listing.
2. **The hardware actually supports the assumed feature.** exFAT, NTFS, PCIe passthrough, and similar capabilities are licensed or chipset-gated — they are not universal.
3. **Documented platform restrictions.** Apple Silicon's Hypervisor.framework blocks PCIe passthrough required for many firmware flashers; macOS rejects unsigned kexts; iOS blocks raw USB.

Real incidents this rule encodes:
- **TCL C845** lacks exFAT licensing — hours of reformatting wasted before discovery.
- **Dell macOS firmware updater** searched for does not exist on macOS; only Windows and Linux builds ship.
- **WD19TB dock firmware flash** blocked by Hypervisor.framework on Apple Silicon — the vendor tool requires PCIe passthrough that the platform forbids.

Scope: consumer hardware and platform-integration questions specifically. Library and framework questions still go through context7.

---

## Reference

- **Profiles** (specialized workflows: `nextjs`, `react-native`, `tauri`, `webgl`, `maestro`, `react-router`) — see `docs/profiles.md`
- **TLDR** (token-efficient codebase exploration; `native-ts` default, `llm-tldr` opt-in) — see `docs/tldr-cheatsheet.md`
- **Hooks** (29 events, 8 categories, conditional `if` filtering) — see `docs/hooks-reference.md`
- **Agent frontmatter** (`tools`, `disallowedTools`, `maxTurns`, `permissionMode`, `effort`, `isolation`, `hooks`, `mcpServers`, `initialPrompt`) — see `docs/frontmatter-reference.md`
- **Knowledge system** (shared team-knowledge repo + local auto-memory) — see `docs/knowledge-system.md`
- **Agent teams** (parallel independent workstreams, `teammateMode: "auto"`) — see `docs/feature-agents-guide.md`

Skill matching is handled by the native `Skill` tool (v2.1.108).

### Supply-chain hook defense

cc-settings detects post-install tampering of `~/.claude/settings.json` — the
Shai-Hulud worm pattern that compromised 172 npm/PyPI packages in May 2026
by injecting a persistent `SessionStart` hook. Two layers:

- **Fingerprint** — `setup.sh` writes a SHA256 of the merged hooks block. The
  `verify-hooks.ts` SessionStart hook re-hashes on every session and warns
  on mismatch. Silent when fingerprint matches.
- **Audit** — `bun run audit:hooks` classifies every hook command in
  `~/.claude/settings.json` as trusted / unknown / suspicious. Exit 1 on
  suspicious findings, suitable for CI.

Custom hooks are preserved by the installer's merger; after intentionally
adding one, re-run `setup.sh` to refresh the fingerprint. The auditor never
self-refreshes the fingerprint — that would let malware whitelist itself.

Full threat model + remediation: see `SECURITY.md`.

### Skill library ratchet — 38

Anthropic's Skills guide flags 20–50 skills as the point where the Skill selector starts struggling to read every description per turn. We sit at 38 cc-settings skills (Tier P1 cleanup May 2026: retired `audit`, `lenis`; merged `create-handoff`+`resume-handoff` → `handoff`, `discovery`+`prd` → `plan-feature`, `ask`+`premortem`+`compare-approaches` → `oracle`, `tdd` folded into `test`, `cc-sync`+`cc-update` → `cc`; folded `long-task` into `orchestrate`; demoted `write-a-skill` to `bun run new-skill` CLI; `nuclear-review` ported from Cursor team-kit May 2026; `share-learning` revived May 2026; `proof-of-work` + `review-batch` added May 2026 from the Orchestration Tax; `freeze` edit-scope lock ported from gstack June 2026; `adversarial-audit` goal-spec audit trio adapted July 2026; `harvest` workflow-capture added July 2026; `triage` first-pass client-repo review added July 2026; `adhd` parallel divergent ideation ported from UditAkhourii/adhd July 2026; `nuclear-review` + `adversarial-audit` merged → `audit` with a mode-router disambiguation step August 2026, reviving the retired `audit` name). **The count is a ratchet, not a target.** `SKILL_COUNT_BASELINE` in `src/lib/lint-skills.ts` holds the current floor (38) and `bun run lint:skills` fails in *both* directions: adding a 39th skill is an error (consolidate or remove one instead), and dropping to 37 is also an error until you lower the baseline and commit it. That commit is the point — every movement of the number lands in git history with a reviewer attached, instead of a warning nobody fails on. The same command enforces the rest of the spec (kebab-case folders, frontmatter contract, no angle brackets, ACTIVE_SKILLS parity); it runs in CI's `lint` job. A companion `SKILL_DESCRIPTION_BYTE_BUDGET` (12 KiB, ceiling-only — exceeding it is an error but staying under it never is) catches the real per-turn cost the count ratchet only proxies, and is enforced by the same `bun run lint:skills`.
