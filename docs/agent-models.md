# Agent Model Routing

Fable 5 (`claude-fable-5`) is cc-settings' top tier — used for the deep-reasoning agents and the main session. Sonnet handles mechanical work to conserve cost. `inherit` tracks the main session's model — used for agents whose tasks span both (cheap on a Sonnet session, strong on a Fable/Opus one). All tiers get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **fable** | Orchestration needs strongest reasoning |
| `planner` | **fable** | Architecture decisions need depth |
| `oracle` | **fable** | Expert Q&A needs nuance |
| `security-reviewer` | **fable** | Can't afford missed vulnerabilities |
| `reviewer` | **fable** | Code review needs careful judgment |
| `implementer` | **fable** | Plans land clean but Sonnet implementation was too often subpar — the workhorse needs strong reasoning |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **inherit** | Simple lookups are Sonnet-fine, but blast-radius/architecture synthesis isn't — inherit tracks the session so deep investigations on an Opus session get Opus synthesis, routine greps stay cheap |
| `deslopper` | **inherit** | Deletions are tool-grounded (tldr call graph) and guard-railed (no rm/commit/push, conservative auto-fix), so no Opus floor needed — but the dynamic-usage false-positive check benefits from session-level reasoning on serious pre-push cleanup |

Override per-invocation when needed: drop `implementer` to `Agent(implementer, "...", model: "sonnet")` for trivial mechanical edits to save Opus quota, or bump a mechanical agent up — `Agent(explore, "...", model: "opus")` — for a genuinely hard investigation.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent rationale table and the main session's pinned model. **Temporarily set to `fable` through 2026-06-21** as part of the Fable 5 rollout; on 2026-06-21 it reverts to `sonnet` (the "session + heavy agents" steady state), leaving the session + deep-reasoning agents on Fable while teammate fan-out drops back to Sonnet for cost.
