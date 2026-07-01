# Agent Model Routing

> **Fable 5 / Mythos 5 suspended (2026-06-12).** A US government export-control
> directive disabled all access to Fable 5 and Mythos 5 for every customer
> ([announcement](https://www.anthropic.com/news/fable-mythos-access)). All
> other Claude models are unaffected. Until access is restored, the decision
> tier routes to **Opus 4.8 with 1M context (`opus[1m]`)** — the strongest
> generally-available model, pinned to `[1m]` because (unlike Fable) Opus is not
> 1M-native. When Fable returns, revert the `opus[1m]` entries below to `fable`
> and drop the pins.

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The top tier (currently `opus[1m]`, normally `fable`) stays on the main session plus the agents whose *output is a judgment* (orchestration, planning, code-quality review). Read-heavy and execution agents run on Opus or Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **opus[1m]** | Orchestration needs the strongest available reasoning (was `fable`) |
| `planner` | **opus[1m]** | Architecture decisions need depth (was `fable`) |
| `oracle` | **opus[1m]** | Expert Q&A needs nuance (was `fable`) |
| `reviewer` | **opus[1m]** | Code-quality judgment is the deliverable (was `fable`) |
| `implementer` | **opus** | Executes already-made decisions; Opus lands clean code — the single biggest token consumer, so per-task context (no 1M pin) keeps cost down |
| `security-reviewer` | **opus** | Analysis feeding the session's decision |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | The highest-volume agent — routine investigation is Sonnet-fine; bump per-invocation to Opus for genuinely hard blast-radius/architecture work |
| `deslopper` | **sonnet** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix) |

The `sonnet` tier is now Claude Sonnet 5 — near-Opus quality on coding/agentic work — which reinforces the split above: `tester`, `scaffolder`, `explore`, and `deslopper` stay on Sonnet for fan-out/mechanical work at a fraction of Opus cost, while the judgment-bearing agents (`maestro`, `planner`, `oracle`, `reviewer`, `implementer`, `security-reviewer`) stay on Opus for the decision.

Override per-invocation when a specific task warrants it: bump a cheap agent up — `Agent(explore, "...", model: "opus")` for a hard investigation — or drop a decision agent down for a trivial pass. The table is the default, not a ceiling.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent table and the main session's pinned model. Set to **`sonnet`** (the steady state): the session and the deep-reasoning agents stay on the top tier while wide teammate fan-out — which re-reads the repo per teammate — drops to Sonnet for cost.
