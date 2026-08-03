# Agent Model Routing

> **Committed top tier: Claude Opus 5 (`claude-opus-5`).** Released 2026-07-24, it lands
> near Fable 5's frontier quality at **half the price** ($5/$25 vs $10/$50 per MTok) and is
> the default Opus in Claude Code **v2.1.219+**. It runs the full 1M context **natively on
> Max — no `[1m]` pin** (that suffix, required for Opus 4.8, is now a no-op; keep it only
> behind an `ANTHROPIC_BASE_URL` gateway that needs the hint). Fable 5 (`claude-fable-5`) is
> generally available as a higher tier, but at 2× the price it's rarely worth it over Opus 5
> for this work — reach for it per session (`/model fable`) when you specifically want the
> top of the range. History: Fable was export-control-suspended 2026-06-12 and the interim
> default was `opus[1m]` (Opus 4.8); Opus 5 replaces that as a strict upgrade at the same price.

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The top tier (`claude-opus-5`) stays on the main session plus the agents whose *output is a judgment* (orchestration, planning, code-quality review). Read-heavy and execution agents run on Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **claude-opus-5** | Orchestration needs the strongest available reasoning (was `fable`, then `opus[1m]`) |
| `planner` | **claude-opus-5** | Architecture decisions need depth (was `fable`, then `opus[1m]`) |
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

**Reach for `model: "fable"` on a genuinely stuck slice, not a hard-looking prompt.** Fable is 2x Opus 5 ($10/$50 vs $5/$25 per MTok) and the session model can't be swapped mid-task by a hook, so the move is a subagent override scoped to just the failing piece — `Agent(implementer, "<the specific failing slice>", model: "fable")` — never a blanket re-run of the whole task at the higher tier. `escalate-model.ts` (below) surfaces this suggestion automatically once it observes real struggle; treat a manual reach for `fable` the same way — after two failed attempts on the same problem, not before the first one.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent table and the main session's pinned model. Set to **`sonnet`** (the steady state): the session and the deep-reasoning agents stay on the top tier while wide teammate fan-out — which re-reads the repo per teammate — drops to Sonnet for cost.

**Fan-out limits (upstream v2.1.217, depth raised v2.1.219)**: at most 20 subagents run concurrently by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` overrides; excess spawns queue). Subagent nesting depth defaulted to `1` (no nesting) through v2.1.218; v2.1.219 raised the default to `3`, so subagents can now spawn nested subagents two levels deep out of the box. cc-settings still pins `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` to `2` in `config/10-core.json` — enough for `maestro` and `deslopper` (agents that themselves fan out via the Agent tool) to keep working when invoked as subagents, but now a level *below* the new upstream default rather than an override of a stricter one.

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
| `claude-opus-5` (our default) | fable, mythos, opus 5 | Valid but marginal — Opus already plans well, and it doesn't relieve the scarce Opus pool |
| `fable` | fable only | Self-consult; skip |

**Recommended use: "workhorse mode", opt-in per session.** Run daily-driver sessions as `/model sonnet` + `/advisor opus` (or `/advisor fable` for the top-of-range tier), and reserve `claude-opus-5`/`fable` sessions for work that needs a top-tier *executor*. This is the native version of the "Sonnet loop bodies, Opus gate decisions" split — except the strong model corrects course mid-turn with full context instead of reviewing after the fact, and dozens of consults cost less than one Opus session. It is deliberately **not** the composed default: our standing `model` is `claude-opus-5`, where an advisor adds little, and a Fable session would reject every non-Fable advisor.

**Interactions:**

- **Subagents inherit** the configured advisor and re-check pairing against their own model — with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, every fanned-out implementer gets strong-model advice on its own transcript. That directly targets the drift/laziness failure modes the delegation rules guard against; cost scales linearly (advice is small), but consider `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for very wide fan-outs.
- **Codex routing is unaffected** — the advisor is Claude advising Claude, so `codex-verifier` remains the only independent cross-model check. What changes is upstream of it: less Opus wall-time spent babysitting Sonnet loops.
- **Fable advisor advice is opaque** — Fable/Mythos advisors return encrypted results; the executor reads them decrypted server-side, you can't audit what was advised. Use an Opus advisor when auditability matters.
- **Not in the Agent SDK** — CLI + raw API only, so scheduled routines and SDK harnesses can't use it yet.

## Automated quota steering

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json` on every refresh. A `quota-steer` `UserPromptSubmit` hook reads that cache and injects routing guidance into the session when usage crosses thresholds (5-hour ≥ 60% or weekly ≥ 65% is "elevated"; either ≥ 85% is "critical") — steering bulk work to the Codex bridge when it's available, or downshifting subagents to Sonnet when it isn't.

## Automated model-escalation suggestion

`post-failure.ts` (`PostToolUseFailure`) tallies failures per session keyed by a signature of {tool, normalized error} — normalized so the same failure with a different line number or absolute path still collapses to one bucket. `escalate-model.ts` (`UserPromptSubmit`) reads that tally and, once a single signature has repeated `CC_ESCALATE_THRESHOLD` times (default 3), suggests spawning a `model: "fable"` subagent scoped to just the failing slice — once per signature (per session), debounced 10 minutes globally, and silent at both the elevated and critical quota bands so it never contradicts quota-steer's "keep subagents on sonnet" (elevated) or "avoid Opus/Fable" (critical) guidance. This fires on observed struggle only, never on prompt shape — a "this looks hard" heuristic would trigger on ordinary prompts, suggest 2x spend on false positives, and train the user to ignore it.
