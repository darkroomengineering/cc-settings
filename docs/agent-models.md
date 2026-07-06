# Agent Model Routing

> **Fable 5 redeployed 2026-07-01, promo-then-credit-gated.** The export-control
> suspension (2026-06-12) has lifted; Fable is back as a promotional tier.
> `config/10-core.json` temporarily defaults the session model to `fable` for
> the promo window, reverting to **Opus 4.8 with 1M context (`opus[1m]`)** on
> 2026-07-07 once the promo ends and credit-gating applies. The agent pins
> below stay on `opus[1m]` as the steady-state top tier — swap to `fable`
> per-session (`/model fable`) during the promo if you want it.

Routing principle: **explore and execute on the cheaper tiers, decide on the top tier.** The top tier (currently `opus[1m]`, normally `fable`) stays on the main session plus the agents whose *output is a judgment* (orchestration, planning, code-quality review). Read-heavy and execution agents run on Opus or Sonnet (mechanical), then feed their findings back to the session for the decision. All tiers get 1M context on Max plans.

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

## Automated quota steering

The statusline persists Claude's own rate-limit percentages to `~/.claude/tmp/rate-limits.json` on every refresh. A `quota-steer` `UserPromptSubmit` hook reads that cache and injects routing guidance into the session when usage crosses thresholds (5-hour ≥ 60% or weekly ≥ 65% is "elevated"; either ≥ 85% is "critical") — steering bulk work to the Codex bridge when it's available, or downshifting subagents to Sonnet when it isn't.
