# Agent Model Routing

> **Committed session model: Claude Fable 5.1 (`claude-fable-5-1`), since 2026-09-01.** Fable is
> included on Max plans (since 2026-07-20): it draws from the same weekly pool as every other
> model at roughly 2x the Opus 5 rate and is capped at 50% of the weekly limit, after which it
> bills extra-usage credits. The team runs on Max, so the default buys 5.1's long-horizon
> agentic gains at the cost of faster pool burn; `quota-steer` still downshifts subagents at the
> 60%/65% bands. Drop to `/model opus` per session for routine work when the pool is tight.
> Before 2026-09-01 the default was `claude-opus-5`; existing installs that never changed
> `model` move with the default through the three-way merge (v15.4.0).

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The main session runs Fable 5.1; the agents whose *output is a judgment* (orchestration, planning, code-quality review) stay on `claude-opus-5-5`, one tier below Fable at 40% of its per-token price, which doesn't count toward the 50% Fable ceiling. Read-heavy and execution agents run on Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **claude-opus-5-5** | Orchestration needs the strongest default reasoning |
| `planner` | **claude-opus-5-5** | Architecture decisions need depth |
| `oracle` | *(session model)* (skill, not an agent — `skills/oracle/SKILL.md` runs as a `context: fork` of the main session, no agent binding) | Not a dedicated `claude-opus-5-5` agent despite the name; the fork inherits the session's model, so on a `claude-opus-5-5` session oracle already thinks at the top tier |
| `reviewer` | **sonnet** | Diff-reading is bulk work; cross-model `codex-verifier` provides the independent second gate |
| `implementer` | **sonnet** | Executes already-made plans; Sonnet 5 is near-Opus on coding, and plans come from the top tier |
| `security-reviewer` | **claude-opus-5-5** | Analysis feeding the session's decision |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | The highest-volume agent — routine investigation is Sonnet-fine; bump per-invocation to Opus for genuinely hard blast-radius/architecture work |
| `deslopper` | **sonnet** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix) |
| `codex-verifier` | **sonnet** | Independent cross-model check via the Codex CLI — the value is a different model family reviewing the diff, not raw reasoning depth on the Claude side |

The `sonnet` tier is now Claude Sonnet 5 — near-Opus quality on coding/agentic work — which reinforces the split above: `tester`, `scaffolder`, `explore`, `deslopper`, `implementer`, `reviewer`, and `codex-verifier` stay on Sonnet for fan-out/mechanical/execution/consult work at a fraction of Opus cost, while the judgment-bearing agents that gate a decision (`maestro`, `planner`, `security-reviewer`) stay on the top tier.

## Codex tiers

The same table drives standalone Codex. The installer maps each agent's Claude tier to a Codex model when it writes `$CODEX_HOME/agents/*.toml`, so there is one routing table, not two:

| Claude tier in frontmatter | Codex `model` | Why |
|---|---|---|
| `claude-opus-5-5`, `claude-opus-5`, `opus`, `fable` | `gpt-6-astra` | Judgment: OpenAI's most aligned model, returns early but judges well |
| `sonnet` | `gpt-6-sol` | Execution: Codex's workhorse coding model |
| `haiku` | `gpt-6-luna` | Fast, low-cost tasks |
| unset | inherits the session model | |

The Claude-to-Codex bridge uses the same split per call: `exec` defaults to Sol, `review` and `ask` to Astra. The Codex-to-Claude bridge (`claude-run.ts`, `claude-verifier`) defaults to `claude-opus-5-5`. See [codex-bridge.md](./codex-bridge.md).

Override per-invocation when a specific task warrants it: bump a cheap agent up — `Agent(explore, "...", model: "opus")` for a hard investigation — or drop a decision agent down for a trivial pass. The table is the default, not a ceiling.

**Reach for `model: "fable"` on a genuinely stuck slice, not a hard-looking prompt.** Fable is 2.5x Opus 5.5 on base tokens ($10/$50 vs $4/$20 per MTok) and the session model can't be swapped mid-task by a hook, so the move is a subagent override scoped to just the failing piece — `Agent(implementer, "<the specific failing slice>", model: "fable")` — never a blanket re-run of the whole task at the higher tier. `escalate-model.ts` (below) surfaces this suggestion automatically once it observes real struggle; treat a manual reach for `fable` the same way — after two failed attempts on the same problem, not before the first one. Fable 5.1 narrows the cost gap for exactly this scoped-subagent shape: its cache reads are $0.25/MTok (0.025x base), close to Opus 5.5's $0.20, so a long escalated slice that mostly re-reads its cached prefix costs about the same per re-read as Opus would. The 2.5x still applies to fresh input and all output; the escalation bar stays where it is. One 5.1 behavior to watch in escalated subagents: it batches parallel tool calls less consistently than Fable 5, so keep the briefing's "batch independent calls" expectation explicit if a fable slice looks serial. `model-switch-guard.ts` (PreModelSwitch) asks before a `/model fable` switch when cached usage is ≥95% and annotates it at the critical band; it never blocks.

**`CLAUDE_CODE_SUBAGENT_MODEL` is the floor under the table above.** The env var (in `config/10-core.json`, upstream v2.1.147) sets the *default* model for every subagent — Agent-tool spawns, the built-in `Explore`/`Plan`/`general-purpose` agents, and Agent Teams teammates under `teammateMode: "auto"`. Since Claude Code v2.1.251 it is a default, not an override: an agent definition's `model:` and an explicit per-spawn `model` take precedence, which is what keeps `maestro`, `planner`, and `security-reviewer` on `claude-opus-5-5` while everything unpinned — including built-in agents, which used to inherit the session model — runs on **`sonnet`**. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257) restores the old override-everything behavior; cc-settings leaves it unset. The steady state: the session and the deep-reasoning agents stay on the top tier while wide fan-out — which re-reads the repo per agent — drops to Sonnet for cost.

**Fan-out limits (upstream v2.1.217, depth raised v2.1.219)**: at most 20 subagents run concurrently by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` overrides; excess spawns queue). Subagent nesting depth defaulted to `1` (no nesting) through v2.1.218; v2.1.219 raised the default to `3`, so subagents can now spawn nested subagents two levels deep out of the box. cc-settings no longer pins `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` — the earlier `2` pin (meant to let `maestro` and `deslopper` fan out via the Agent tool even when invoked as subagents) was removed in v13.2.1 once upstream's own default rose to `3`, which made the pin a restriction instead of a loosener; existing installs have it auto-pruned via the `DEPRECATED_ENV_KEYS` retirement mechanism.

## Advisor: strong-model consults from a cheap executor

Claude Code has a native **advisor** layered on the API's [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) (experimental): the session ("executor") model calls an `advisor` server tool at decision points; Anthropic runs the advisor model over the **full transcript** server-side and returns short guidance mid-turn. No briefing prompt is needed. Unlike a subagent, the advisor sees everything the executor saw. It works on subscription billing (advisor tokens count toward plan limits, visible in `/usage`) and on API keys, but only against the Anthropic API: not on Bedrock, Vertex, or Foundry, and through a gateway only when the gateway forwards the tool intact. `DISABLE_TELEMETRY` and other flag-fetch kill switches turn it off. Docs: [code.claude.com/docs/en/advisor](https://code.claude.com/docs/en/advisor).

**cc-settings sets `"advisorModel": "claude-fable-5-1"`** in `config/10-core.json`. Fable 5.1 is the only advisor that every model we run accepts, including the Fable 5.1 default, which rejects Opus and Sonnet advisors and gets a Fable 5 advisor refused by the API. The full ID is pinned instead of the `fable` alias because the alias follows Claude Code's built-in default; if it pointed at Fable 5, a Fable 5.1 session would drop the advisor with no error.

| Session (executor) | Accepts `claude-fable-5-1`? | What it buys |
|---|---|---|
| `claude-fable-5-1` (composed default) | yes, the only accepted advisor | A second Fable pass on hard calls |
| `claude-opus-5-5` (`planner`, `maestro`, `security-reviewer`) | yes (Fable, or Opus 5+) | Top-tier review of Opus plans and gate decisions |
| `sonnet` (Sonnet 5: `implementer`, `tester`, `explore`, and the other `CLAUDE_CODE_SUBAGENT_MODEL` agents) | yes | The pairing the docs recommend first: Sonnet runs the routine turns, Fable steps in at decision points |
| `haiku` | yes | Cheapest executor with top-tier planning |

**Config surface:**

- `/advisor <model>` sets it and saves to user settings; `/advisor off` disables it. The text form works in `-p`, the Agent SDK, the desktop app, and Remote Control since v2.1.260.
- `--advisor <model>` overrides for one session; it exits at launch when the pairing is invalid.
- `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` ignores `advisorModel` entirely.
- A saved advisor the main model can't pair with is not attached, and the session shows a notification. When the API refuses one mid-conversation, the advisor stays off until `/clear` or `/compact`.

**When it is called:** the model decides, usually before committing to an approach, when an error recurs, and before declaring done. There is no setting to force or cap calls, so `implementer`, `tester`, and `maestro` ask for those three checkpoints in their prompts. Ask for one directly with "consult the advisor before you continue".

**Interactions:**

- **Subagents inherit** the advisor and re-check pairing against their own model. Wide fan-outs multiply advisor calls; set `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for a run where that cost isn't worth it.
- **Cost:** each call rereads the full transcript uncached at the advisor's rates. Toggling `/advisor` mid-session does not invalidate the main model's prompt cache. Turn it off with `/advisor off` when quota is tight (`quota-steer` at 5h ≥60% or weekly ≥65%).
- **Codex routing is unaffected.** The advisor is Claude advising Claude, so `codex-verifier` remains the only independent cross-model check.
- **Fable advice is opaque.** Fable returns encrypted advisor results, so you can't audit what was advised; press `Ctrl+O` on the `Advising` line to see what is readable. Run `/advisor opus` from an Opus or Sonnet session when auditability matters.

## Automated quota steering

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json` on every refresh. A `quota-steer` `UserPromptSubmit` hook reads that cache and injects routing guidance into the session when usage crosses thresholds (5-hour ≥ 60% or weekly ≥ 65% is "elevated"; either ≥ 85% is "critical") — steering bulk work to the Codex bridge when it's available, or downshifting subagents to Sonnet when it isn't. Either ≥ 95% is "exhausted", which re-injects the routing directive on every prompt instead of once (see `docs/codex-bridge.md` for the full band behavior, including the bridge-down fallback).

## Automated model-escalation suggestion

`post-failure.ts` (`PostToolUseFailure`) tallies failures per session keyed by a signature of {tool, normalized error} — normalized so the same failure with a different line number or absolute path still collapses to one bucket. `escalate-model.ts` (`UserPromptSubmit`) reads that tally and, once a single signature has repeated `CC_ESCALATE_THRESHOLD` times (default 3), suggests spawning a `model: "fable"` subagent scoped to just the failing slice — once per signature (per session), debounced 10 minutes globally, and silent at both the elevated and critical quota bands so it never contradicts quota-steer's "keep subagents on sonnet" (elevated) or "avoid Opus/Fable" (critical) guidance. This fires on observed struggle only, never on prompt shape — a "this looks hard" heuristic would trigger on ordinary prompts, suggest 2x spend on false positives, and train the user to ignore it.
