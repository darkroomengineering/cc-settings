# Agent Model Routing

Routing principle: **explore and execute on the cheaper tiers, decide on Fable.** Fable 5 (`claude-fable-5`) is the top tier and stays on the main session plus the agents whose *output is a judgment* (orchestration, planning, code-quality review). Read-heavy and execution agents run on Opus (strong, ~2× cheaper than Fable) or Sonnet (mechanical), then feed their findings back to the Fable session for the decision. All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **fable** | Orchestration needs strongest reasoning |
| `planner` | **fable** | Architecture decisions need depth |
| `oracle` | **fable** | Expert Q&A needs nuance |
| `reviewer` | **fable** | Code-quality judgment is the deliverable |
| `implementer` | **opus** | Executes already-made decisions; Opus lands clean code (it was the pre-Fable workhorse) at ~half Fable's cost — the single biggest token consumer, so the largest saving |
| `security-reviewer` | **opus** | Analysis feeding the session's decision — and Fable's safety classifier routes security content to Opus anyway, so pin it explicitly rather than pay Fable and get downgraded mid-flight |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | The highest-volume agent — routine investigation is Sonnet-fine; bump per-invocation to Opus for genuinely hard blast-radius/architecture work |
| `deslopper` | **sonnet** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix) |

Override per-invocation when a specific task warrants it: bump a cheap agent up — `Agent(explore, "...", model: "opus")` for a hard investigation, or `Agent(implementer, "...", model: "fable")` for a change where landing it wrong is expensive — or drop a Fable agent down for a trivial pass. The table is the default, not a ceiling.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent table and the main session's pinned model. Set to **`sonnet`** (the steady state): the session and the deep-reasoning agents stay on Fable while wide teammate fan-out — which re-reads the repo per teammate — drops to Sonnet for cost.
