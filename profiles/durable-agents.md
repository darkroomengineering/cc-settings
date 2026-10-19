---
name: durable-agents
description: Building an agent, bot, assistant, or autonomous job inside a product that must survive crashes, restarts, and unattended triggers
---

# Durable Agents Profile (Agents Inside Products)

> Darkroom conventions for agents that ship inside a product: webhook bots, cron jobs, Slack assistants, in-app copilots. This profile does not cover the coding assistant's own sessions; `/orchestrate`, `/handoff`, and `/checkpoint` cover those.

## Posture

Durable behavior is the requirement; the runtime is chosen per project. Pi Durable (`@earendil-works/pi-durable`) is the reference implementation. It is experimental, so adopt it per project, never by default.

- An agent that runs longer than one request, starts without a human (webhook, cron, queue, Slack event), or performs external side effects must be durable: its state is persisted, it resumes after a crash or restart, and it never repeats a side effect.
- Classify every tool before writing it. Read-only or idempotent tools are replay-safe. Side-effecting tools (email, payment, PR, deploy, message post) are not, unless the tool carries its own idempotency key that the external system checks.
- Approvals, timers, and waits live in durable state, never in process memory.
- Autonomous triggers dedupe at intake: one external event id (for example a Sentry issue id) maps to at most one run and one PR, however often the event fires. Confirm the event belongs to a tracked project before starting a run.
- Client and user-facing repos never auto-merge agent PRs. Agent output passes the normal `/review` and `/proof-of-work` gates.
- The model and provider come from config, never hardcoded in code or in this profile.

## Structure

- When using Pi Durable, storage is a SQLite file for long-running Node or Bun hosts, Durable Object SQLite on Cloudflare, and `MemoryStorage` only in tests. Avoid JSONL for long-running agents: it keeps the whole history in memory.
- When using Pi Durable, one process owns a storage at a time. There is no cross-process locking, so never share a storage across processes or replicas.
- When using Pi Durable, declare each tool's `replay` policy next to the tool. Keep tools as plain functions, one module per area.
- When using Pi Durable, every client (CLI, web, Slack) watches the same conversation. Do not build a per-client state store.
- When using Pi Durable, reuse a stable `requestId` on resubmission so a restart does not admit the same input twice; reacquire an in-flight submission with `harness.submission(id)`.

## Gotchas

| Pitfall | Fix |
|---------|-----|
| Remembered API shapes are stale | When using Pi Durable: it is experimental and changes without notice. Before writing code, read the matching example in `packages/durable/test/examples` (recovery, reload and restart, late join, foreground and background subagents, child tasks, compaction, plan mode, reviewer, tool override). Find examples by topic; the numbering can change |
| Harness closes after a storage error | When using Pi Durable: pending waits reject with `SessionFailed` and nothing retries. The host watches for close and reopens the storage; resubmit with the same `requestId` |
| Interrupted tool does not rerun | When using Pi Durable: a tool not declared `replay: "safe"` returns an `interrupted` error to the model after a crash. Design the prompt and tool so the model can recover from it |
| Newest commit lost on power failure | When using Pi Durable: Node SQLite runs WAL with `synchronous = NORMAL`. Commits survive process crashes; the newest may be lost on power or host failure |
| Node SQLite adapter fails on Bun | When using Pi Durable: `openNodeSqliteStorage` is Node-only. On Bun, use the portable `/storage/sqlite` core with a `SqliteDatabase` adapter |
| Replay-safe tool repeats a nested call | Any runtime: a replay-safe tool that calls external APIs still needs idempotency for those nested calls |
| Same alert opens many PRs | Any runtime: dedupe on the external event id before the run starts, not after |

## Pre-Implementation Checklist

- [ ] Each tool is listed as replay-safe or not, with the reason
- [ ] Each autonomous trigger names its dedupe key
- [ ] The durable runtime is named. If it is Pi Durable, its exact version is pinned (this profile was checked against 1.3.0; check `bun info @earendil-works/pi-durable`) and the APIs and storage backend used are checked against that version's README and examples. Otherwise the chosen runtime's versioning policy is recorded
- [ ] The storage backend and the runtime's concurrency and ownership requirements are documented. When using Pi Durable, name the single process that owns each storage
- [ ] Approvals and waits are durable, and no agent PR auto-merges on a client or user-facing repo

## Evaluating a Migration

For "should this project's agent become durable?", run a read-only pass and change no code:

1. Read the chosen runtime's docs and examples (Pi Durable by default: the package README and `test/examples`).
2. Map the existing code the runtime would replace: message storage, work queues, UI streaming, mid-run steering, approvals, retries, summarization of old messages, app-state sync.
3. Describe what happens today when the process dies mid-task, next to the durable behavior.
4. List each tool as replay-safe or not, with the reason.
5. Give a step-by-step migration with the risks of each step.
6. Cite the doc section or example that backs each claim.
