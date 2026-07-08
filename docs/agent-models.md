# Agent Model Routing

> **Fable 5 is free per-session through 2026-07-12 (promo extended), then credit-gated.**
> The export-control suspension (2026-06-12) lifted on 2026-07-01 with a promotional
> window — Anthropic [extended it](https://support.claude.com/en/articles/15424964-claude-fable-5-promotional-access)
> from July 7 to **2026-07-12 11:59 PM PT**: up to 50% of the weekly limit on `fable` at
> no extra cost, drawn from the same shared pool. The **committed** default is deliberately
> **Opus 4.8 with 1M context (`opus[1m]`)**, matching the agent pins below — not `fable`,
> so fresh installs never silently spend usage credits when the promo ends. To ride the free
> window, run **`/model fable` per session** (live, no reinstall) through July 12. After
> July 12, Fable draws usage credits beyond the plan.

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The top tier (`opus[1m]`) stays on the main session plus the agents whose *output is a judgment* (orchestration, planning, code-quality review). Read-heavy and execution agents run on Opus or Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **opus[1m]** | Orchestration needs the strongest available reasoning (was `fable`) |
| `planner` | **opus[1m]** | Architecture decisions need depth (was `fable`) |
| `oracle` | **opus[1m]** | Expert Q&A needs nuance (was `fable`) |
| `reviewer` | **sonnet** | Diff-reading is bulk work; cross-model `codex-verifier` provides the independent second gate |
| `implementer` | **sonnet** | Executes already-made plans; Sonnet 5 is near-Opus on coding, and plans come from the top tier |
| `security-reviewer` | **opus** | Analysis feeding the session's decision |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | The highest-volume agent — routine investigation is Sonnet-fine; bump per-invocation to Opus for genuinely hard blast-radius/architecture work |
| `deslopper` | **sonnet** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix) |

The `sonnet` tier is now Claude Sonnet 5 — near-Opus quality on coding/agentic work — which reinforces the split above: `tester`, `scaffolder`, `explore`, `deslopper`, `implementer`, and `reviewer` stay on Sonnet for fan-out/mechanical/execution work at a fraction of Opus cost, while the judgment-bearing agents that gate a decision (`maestro`, `planner`, `oracle`, `security-reviewer`) stay on the top tier.

Override per-invocation when a specific task warrants it: bump a cheap agent up — `Agent(explore, "...", model: "opus")` for a hard investigation — or drop a decision agent down for a trivial pass. The table is the default, not a ceiling.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent table and the main session's pinned model. Set to **`sonnet`** (the steady state): the session and the deep-reasoning agents stay on the top tier while wide teammate fan-out — which re-reads the repo per teammate — drops to Sonnet for cost.

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
| `sonnet` (Sonnet 5) | fable, mythos, opus 4.8/4.7 | **The sweet spot** — near-top-tier planning at Sonnet burn rate |
| `opus[1m]` (our default) | fable, mythos, opus 4.8/4.7 | Valid but marginal — Opus already plans well, and it doesn't relieve the scarce Opus pool |
| `fable` | fable only | Self-consult; skip |

**Recommended use: "workhorse mode", opt-in per session.** Run daily-driver sessions as `/model sonnet` + `/advisor opus` (or `/advisor fable` while promo/org access lasts), and reserve `opus[1m]`/`fable` sessions for work that needs a top-tier *executor*. This is the native version of the "Sonnet loop bodies, Opus gate decisions" split — except the strong model corrects course mid-turn with full context instead of reviewing after the fact, and dozens of consults cost less than one Opus session. It is deliberately **not** the composed default: our standing `model` is `opus[1m]`, where an advisor adds little, and a Fable session would reject every non-Fable advisor.

**Interactions:**

- **Subagents inherit** the configured advisor and re-check pairing against their own model — with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, every fanned-out implementer gets strong-model advice on its own transcript. That directly targets the drift/laziness failure modes the delegation rules guard against; cost scales linearly (advice is small), but consider `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` for very wide fan-outs.
- **Codex routing is unaffected** — the advisor is Claude advising Claude, so `codex-verifier` remains the only independent cross-model check. What changes is upstream of it: less Opus wall-time spent babysitting Sonnet loops.
- **Fable advisor advice is opaque** — Fable/Mythos advisors return encrypted results; the executor reads them decrypted server-side, you can't audit what was advised. Use an Opus advisor when auditability matters.
- **Not in the Agent SDK** — CLI + raw API only, so scheduled routines and SDK harnesses can't use it yet.

## Automated quota steering

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json` on every refresh. A `quota-steer` `UserPromptSubmit` hook reads that cache and injects routing guidance into the session when usage crosses thresholds (5-hour ≥ 60% or weekly ≥ 65% is "elevated"; either ≥ 85% is "critical") — steering bulk work to the Codex bridge when it's available, or downshifting subagents to Sonnet when it isn't.
