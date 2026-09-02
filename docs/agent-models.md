# Agent Model Routing

> **Committed session model: Claude Fable 5.1 (`claude-fable-5-1`), since 2026-09-01.** Fable is
> included on Max plans (since 2026-07-20): it draws from the same weekly pool as every other
> model at roughly 2x the Opus 5 rate and is capped at 50% of the weekly limit, after which it
> bills extra-usage credits. The team runs on Max, so the default buys 5.1's long-horizon
> agentic gains at the cost of faster pool burn; `quota-steer` still downshifts subagents at the
> 60%/65% bands. Drop to `/model opus` per session for routine work when the pool is tight.
> Before 2026-09-01 the default was `claude-opus-5`; existing installs that never changed
> `model` move with the default through the three-way merge (v15.4.0).

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The main session runs Fable 5.1; the agents whose *output is a judgment* (orchestration, planning, code-quality review) stay on `claude-opus-5`, which is near-Fable quality at half the pool burn and doesn't count toward the 50% Fable ceiling. Read-heavy and execution agents run on Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **claude-opus-5** | Orchestration needs the strongest default reasoning |
| `planner` | **claude-opus-5** | Architecture decisions need depth |
| `oracle` | *(session model)* (skill, not an agent — `skills/oracle/SKILL.md` runs as a `context: fork` of the main session, no agent binding) | Not a dedicated `claude-opus-5` agent despite the name; the fork inherits the session's model, so on a `claude-opus-5` session oracle already thinks at the top tier |
| `reviewer` | **sonnet** | Diff-reading is bulk work; cross-model `codex-verifier` provides the independent second gate |
| `implementer` | **sonnet** | Executes already-made plans; Sonnet 5 is near-Opus on coding, and plans come from the top tier |
| `security-reviewer` | **claude-opus-5** | Analysis feeding the session's decision |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | The highest-volume agent — routine investigation is Sonnet-fine; bump per-invocation to Opus for genuinely hard blast-radius/architecture work |
| `deslopper` | **sonnet** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix) |
| `codex-verifier` | **sonnet** | Independent cross-model check via the Codex CLI — the value is a different model family reviewing the diff, not raw reasoning depth on the Claude side |

The `sonnet` tier is now Claude Sonnet 5 — near-Opus quality on coding/agentic work — which reinforces the split above: `tester`, `scaffolder`, `explore`, `deslopper`, `implementer`, `reviewer`, and `codex-verifier` stay on Sonnet for fan-out/mechanical/execution/consult work at a fraction of Opus cost, while the judgment-bearing agents that gate a decision (`maestro`, `planner`, `security-reviewer`) stay on the top tier.

Override per-invocation when a specific task warrants it: bump a cheap agent up — `Agent(explore, "...", model: "opus")` for a hard investigation — or drop a decision agent down for a trivial pass. The table is the default, not a ceiling.

**Reach for `model: "fable"` on a genuinely stuck slice, not a hard-looking prompt.** Fable is 2x Opus 5 on base tokens ($10/$50 vs $5/$25 per MTok) and the session model can't be swapped mid-task by a hook, so the move is a subagent override scoped to just the failing piece — `Agent(implementer, "<the specific failing slice>", model: "fable")` — never a blanket re-run of the whole task at the higher tier. `escalate-model.ts` (below) surfaces this suggestion automatically once it observes real struggle; treat a manual reach for `fable` the same way — after two failed attempts on the same problem, not before the first one. Fable 5.1 softens the cost gap for exactly this scoped-subagent shape: its cache reads are $0.25/MTok (0.025x base, vs 0.1x on every other model — Opus 5 reads cost $0.50), so a long escalated slice that mostly re-reads its cached prefix pays less per re-read than Opus would. The 2x still applies to fresh input and all output; the escalation bar stays where it is. One 5.1 behavior to watch in escalated subagents: it batches parallel tool calls less consistently than Fable 5, so keep the briefing's "batch independent calls" expectation explicit if a fable slice looks serial. `model-switch-guard.ts` (PreModelSwitch) asks before a `/model fable` switch when cached usage is ≥95% and annotates it at the critical band; it never blocks.

**`CLAUDE_CODE_SUBAGENT_MODEL` is the floor under the table above.** The env var (in `config/10-core.json`, upstream v2.1.147) sets the *default* model for every subagent — Agent-tool spawns, the built-in `Explore`/`Plan`/`general-purpose` agents, and Agent Teams teammates under `teammateMode: "auto"`. Since Claude Code v2.1.251 it is a default, not an override: an agent definition's `model:` and an explicit per-spawn `model` take precedence, which is what keeps `maestro`, `planner`, and `security-reviewer` on `claude-opus-5` while everything unpinned — including built-in agents, which used to inherit the session model — runs on **`sonnet`**. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257) restores the old override-everything behavior; cc-settings leaves it unset. The steady state: the session and the deep-reasoning agents stay on the top tier while wide fan-out — which re-reads the repo per agent — drops to Sonnet for cost.

**Fan-out limits (upstream v2.1.217, depth raised v2.1.219)**: at most 20 subagents run concurrently by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` overrides; excess spawns queue). Subagent nesting depth defaulted to `1` (no nesting) through v2.1.218; v2.1.219 raised the default to `3`, so subagents can now spawn nested subagents two levels deep out of the box. cc-settings no longer pins `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` — the earlier `2` pin (meant to let `maestro` and `deslopper` fan out via the Agent tool even when invoked as subagents) was removed in v13.2.1 once upstream's own default rose to `3`, which made the pin a restriction instead of a loosener; existing installs have it auto-pruned via the `DEPRECATED_ENV_KEYS` retirement mechanism.

## Advisor: strong-model consults from a cheap executor

Claude Code has a native **advisor** layered on the API's [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) (beta): the session ("executor") model calls an `advisor` server tool whenever it wants strategic guidance; Anthropic runs the stronger advisor model over the **full transcript** server-side and returns short advice (typically 400–700 text tokens) mid-turn. No orchestration and no briefing prompt — unlike a subagent, the advisor sees everything the executor saw. It works on **subscription billing** (advisor tokens count toward Max usage limits, visible in `/usage`) as well as API keys, but Anthropic API only — absent on Bedrock / Vertex / Foundry. Docs: [code.claude.com/docs/en/advisor](https://code.claude.com/docs/en/advisor).

**Config surface** (v2.1.98+; Fable as advisor needs v2.1.170+ and Fable org access):

- `/advisor opus` — set or change mid-session, persists; `/advisor off` disables
- `"advisorModel": "opus"` in settings.json — standing default
- `--advisor <model>` — one-session override (takes precedence over the setting)
- `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` — hard disable

**Pairing rules that matter here** (the advisor must be at least as capable as the executor):

| Session (executor) | Valid advisors | Verdict |
|---|---|---|
| `sonnet` (Sonnet 5) | fable, mythos, opus 5 | **The sweet spot** — near-top-tier planning at Sonnet burn rate |
| `claude-opus-5` | fable, mythos, opus 5 | Valid but marginal — Opus already plans well, and it doesn't relieve the scarce Opus pool |
| `claude-fable-5-1` (our default) | fable only | Self-consult; skip — a Fable session rejects every non-Fable advisor |

**Recommended use: "workhorse mode", opt-in per session.** Run daily-driver sessions as `/model sonnet` + `/advisor opus` (or `/advisor fable` for the top-of-range tier), and reserve `claude-fable-5-1`/`claude-opus-5` sessions for work that needs a top-tier *executor*. This is the native version of the "Sonnet loop bodies, Opus gate decisions" split — except the strong model corrects course mid-turn with full context instead of reviewing after the fact, and dozens of consults cost less than one Opus session. It is deliberately **not** the composed default: our standing `model` is `claude-fable-5-1`, which only accepts a Fable advisor, so the advisor is a per-session choice that starts with `/model sonnet`.

**Interactions:**

- **Subagents inherit** the configured advisor and re-check pairing against their own model — with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, every fanned-out implementer gets strong-model advice on its own transcript. That directly targets the drift/laziness failure modes the delegation rules guard against; cost scales linearly (advice is small), but consider `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for very wide fan-outs.
- **Codex routing is unaffected** — the advisor is Claude advising Claude, so `codex-verifier` remains the only independent cross-model check. What changes is upstream of it: less Opus wall-time spent babysitting Sonnet loops.
- **Fable advisor advice is opaque** — Fable/Mythos advisors return encrypted results; the executor reads them decrypted server-side, you can't audit what was advised. Use an Opus advisor when auditability matters.
- **Not in the Agent SDK** — CLI + raw API only, so scheduled routines and SDK harnesses can't use it yet.

## Automated quota steering

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json` on every refresh. A `quota-steer` `UserPromptSubmit` hook reads that cache and injects routing guidance into the session when usage crosses thresholds (5-hour ≥ 60% or weekly ≥ 65% is "elevated"; either ≥ 85% is "critical") — steering bulk work to the Codex bridge when it's available, or downshifting subagents to Sonnet when it isn't. Either ≥ 95% is "exhausted", which re-injects the routing directive on every prompt instead of once (see `docs/codex-bridge.md` for the full band behavior, including the bridge-down fallback).

## Automated model-escalation suggestion

`post-failure.ts` (`PostToolUseFailure`) tallies failures per session keyed by a signature of {tool, normalized error} — normalized so the same failure with a different line number or absolute path still collapses to one bucket. `escalate-model.ts` (`UserPromptSubmit`) reads that tally and, once a single signature has repeated `CC_ESCALATE_THRESHOLD` times (default 3), suggests spawning a `model: "fable"` subagent scoped to just the failing slice — once per signature (per session), debounced 10 minutes globally, and silent at both the elevated and critical quota bands so it never contradicts quota-steer's "keep subagents on sonnet" (elevated) or "avoid Opus/Fable" (critical) guidance. This fires on observed struggle only, never on prompt shape — a "this looks hard" heuristic would trigger on ordinary prompts, suggest 2x spend on false positives, and train the user to ignore it.
