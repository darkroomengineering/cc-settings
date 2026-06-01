# Agent Model Routing

Opus is reserved for tasks requiring deep reasoning. Sonnet handles mechanical work to conserve Opus quota. `inherit` tracks the main session's model — used for agents whose tasks span both (cheap on a Sonnet session, strong on an Opus one). Both get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **opus** | Orchestration needs strongest reasoning |
| `planner` | **opus** | Architecture decisions need depth |
| `oracle` | **opus** | Expert Q&A needs nuance |
| `security-reviewer` | **opus** | Can't afford missed vulnerabilities |
| `reviewer` | **opus** | Code review needs careful judgment |
| `implementer` | **opus** | Plans land clean but Sonnet implementation was too often subpar — the workhorse needs strong reasoning |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **inherit** | Simple lookups are Sonnet-fine, but blast-radius/architecture synthesis isn't — inherit tracks the session so deep investigations on an Opus session get Opus synthesis, routine greps stay cheap |
| `deslopper` | **sonnet** | Pattern matching for dead code is straightforward |

Override per-invocation when needed: drop `implementer` to `Agent(implementer, "...", model: "sonnet")` for trivial mechanical edits to save Opus quota, or bump a mechanical agent up — `Agent(explore, "...", model: "opus")` — for a genuinely hard investigation.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (set to `sonnet` in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent rationale table and the main session's pinned model.
