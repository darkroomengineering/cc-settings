# Agent Model Routing

Opus is reserved for tasks requiring deep reasoning. Sonnet handles mechanical work to conserve Opus quota. Both get 1M context on Max plans.

| Agent | Model | Rationale |
|-------|-------|-----------|
| `maestro` | **opus** | Orchestration needs strongest reasoning |
| `planner` | **opus** | Architecture decisions need depth |
| `oracle` | **opus** | Expert Q&A needs nuance |
| `security-reviewer` | **opus** | Can't afford missed vulnerabilities |
| `reviewer` | **opus** | Code review needs careful judgment |
| `implementer` | **sonnet** | Code writing is well-defined work |
| `tester` | **sonnet** | Test writing follows clear patterns |
| `scaffolder` | **sonnet** | Boilerplate generation is mechanical |
| `explore` | **sonnet** | File search/read doesn't need deep reasoning |
| `deslopper` | **sonnet** | Pattern matching for dead code is straightforward |

Override per-invocation when needed: `Agent(implementer, "...", model: "opus")` for complex implementations.

**Agent Teams teammates** route separately from the table above: the `CLAUDE_CODE_SUBAGENT_MODEL` env var (set to `sonnet` in `config/10-core.json`, upstream v2.1.147) picks the model for teammate subprocesses spawned under `teammateMode: "auto"` — independent of both the per-agent rationale table and the main session's pinned model.
