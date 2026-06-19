# Darkroom Engineering — Claude Code

Read `AGENTS.md` for coding standards and guardrails. This file is Claude-Code-specific only.

---

## Edit Strategy

The Edit tool uses exact string matching. Follow these rules:

- **Small edits (<10 lines)**: Use `Edit` with minimal but unique `old_string`
- **Large edits (>15 lines)**: Use `Write` for full file replacement
- **On first Edit failure**: Switch to `Write` immediately
- **Re-read before editing**: If a file was read 2+ tool calls ago, re-read it

---

## Delegation

> **Opus 4.8 note**: Opus 4.8 (and 4.7) under-delegates — it prefers internal reasoning over spawning agents. The heuristic below is calibrated to counter that bias. Do not reason your way out of it "because you could do it yourself."

### The per-decision heuristic

Before each unit of work, ask once: **3+ files, 10+ tool calls, or security-sensitive code?**

**YES → delegate first, then route by shape:**

| Shape | Agent |
|---|---|
| understand / find / map / blast-radius | `explore` |
| build / change / fix across files | `implementer` |
| plan / architecture | `planner` |
| new test files | `tester` (MUST) |
| auth, payments, crypto, input validation | `security-reviewer` (MUST) |
| dead code / deslop | `deslopper` (MUST) |
| 3+ independent workstreams | parallel `Agent` calls in ONE message (MUST) |
| full feature spanning 3+ agents | `maestro` |
| prone to single-window failure — agentic laziness (quitting at 20 of 50 items), self-preferential bias (judging your own output), goal drift across compaction | a [dynamic workflow](https://code.claude.com/docs/en/workflows) / `/effort ultracode` (see `skills/orchestrate/SKILL.md`) |

**NO → act directly.** 1–2 file edits, known-path reads, single greps/globs, build/test runs, conversational answers. Keeping small diffs in the main session is correct — don't spawn an `implementer` to prove you delegated.

**Rules that close the loop:**

1. **Re-ask when scope grows.** Predicted small but it's now 3+ files or 10+ calls? Stop and delegate the remainder — sunk tool calls are not a reason to finish solo.
2. **Overriding a YES requires a stated reason.** One line, in your response, before proceeding (e.g. "12 calls but all sequential edits to one file"). The `tool-cadence` hook escalates on streaks that continue past a reminder with no Agent call.
3. **Delegating needs no narration** — just call the Agent tool.
4. **Parallelize**: independent delegations go in a single message — they run concurrently.

> **Briefing contract for `implementer`**: as a subagent it gets only your prompt — no conversation context, none of the files you've read — so every prompt MUST contain actual content, not references: the user's ask verbatim, exact file paths and line ranges, the change to make (paste the planner output; never write "based on findings" or "according to plan"), the verification command, and a scope boundary. Thin prompts cause regressions; the agent will refuse them. It runs in the live working tree and leaves changes **uncommitted** for you to review before they land. Full contract: `agents/implementer.md` REQUIRED BRIEFING. This applies equally to `explore` → `implementer` and `planner` → `implementer` chains.

For full orchestration mode, activate `profiles/maestro.md`. Model routing per agent: see `docs/agent-models.md`.

---

## Codex pairing (Opus + Codex)

The OpenAI Codex CLI runs as a second model alongside Claude via the `/codex` skill and the `codex-verifier` agent. It's gated — no-ops when `codex` isn't installed or logged in, and the statusline shows availability (`codex ✓ / auth? / ⏳`). Full design: `docs/codex-bridge.md`.

**Quota-aware routing** — Claude meters Opus by wall-time/weekly (scarce, ~22–52h/wk on Max 5x, auto-downshifts to Sonnet); Codex (Pro-class) meters by messages per ~5-hour window (roomy). Route by headroom, not habit:

- **Opus** → planning, synthesis, gate decisions. Never the body of a tight `/loop`.
- **Sonnet** → loop bodies and most fan-out subagents (`CLAUDE_CODE_SUBAGENT_MODEL` is already `sonnet`). There's no `/loop` model setting — pin per-invocation.
- **Codex** → mechanical/bulk execution (`/codex exec`) and independent cross-model verification (`/codex review`, or the `codex-verifier` agent fanned out in parallel). Batch into FEW LARGE calls — it's message-metered, so one whole task beats many steps. Always review Codex's diff before trusting it.

Two roomy pools (Sonnet + Codex) carry volume; the one scarce pool (Opus) does the thinking. If a Codex window drains, fail over to Claude-only rather than stalling.

---

## Effort & Context

**Effort levels** — `low`, `medium`, `high`, `xhigh`, `max`. Default `high` (pinned via `CLAUDE_CODE_EFFORT_LEVEL` in settings.json — matches Anthropic's 4.8 default; a deliberate cost choice over the old `xhigh` pin). Per-session: `/effort xhigh` for deep work; `ultrathink` keyword for one-turn max depth. Per-agent: `effort` frontmatter.

- `low` — trivial lookups, latency-sensitive
- `medium` — routine edits where depth isn't required
- `high` — non-coding intelligence (writing, analysis)
- `max` — extreme cases only; often overthinks
- `ultracode` — session-only; `xhigh` reasoning plus automatic [dynamic workflow](https://code.claude.com/docs/en/workflows) orchestration. Useful for codebase audits, large migrations, deep research. Set via `/effort ultracode`. Resets on session end. Requires Claude Code v2.1.154+.

**4.8/Fable calibration**: Anthropic's 4.8 default effort is `high` (was `xhigh` on 4.7). cc-settings now pins `high` too — the `xhigh` ladder allocates materially more thinking tokens per turn on 4.8/Fable (per-model calibration; see [model-config docs](https://code.claude.com/docs/en/model-config#choose-an-effort-level)), and on a Fable session that cost compounds across every inheriting agent. `high` is the cost-conscious default; raise to `/effort xhigh` per-session for audits/migrations/hard debugging, or use the `ultrathink` keyword for a single deep turn. At `low`/`medium` the model scopes strictly and may under-think — reach for `xhigh`, not prompt workarounds, when depth is missing.

**Context window** — 1M tokens default on Max. Subagents inherit. The cc-settings default model is `opus[1m]` (Claude Opus 4.8, 1M variant) — the interim top tier while **Fable 5 is suspended** (export-control directive, 2026-06-12; see [docs/agent-models.md](docs/agent-models.md)). Opus is not 1M-native, so the `[1m]` pin is required to keep the full window; `sonnet[1m]` pins Sonnet's 1M variant likewise. When Fable access is restored, switch the default back to `fable` (1M-native, no pin needed) and drop the agent pins.

- **Manual `/compact` at 65%** — Opus 4.7/4.8's tokenizer is ~1-1.35x heavier per text vs 4.6 (was 70% on 4.6), so context burns faster. Auto-compaction triggers at 95%; don't wait for it. The prompt cache has a 5-minute TTL — idling past it re-ingests the whole window at full price, so `/clear` between unrelated tasks and `/handoff` instead of marathon sessions both save real tokens on long 1M contexts.
- **Break subtasks to complete within 45%** — conservative budget for 4.7/4.8 tokenization. Prevents context rot mid-task.
- **After compaction**: re-read task plan + active files (see AGENTS.md "Post-Compaction Recovery").

Output token limits: 64K default, 128K upper bound.

---

## Verification Before Recommendation

For hardware, firmware, OS-level, dock, or filesystem-compatibility tasks, web-search the exact model number and platform **before** recommending tooling or steps. Three things must be verified upfront:

1. **The tool exists on the user's platform.** Apple Silicon macOS support is not implied by a Windows or Intel Mac listing.
2. **The hardware actually supports the assumed feature.** exFAT, NTFS, PCIe passthrough, and similar capabilities are licensed or chipset-gated — they are not universal.
3. **Documented platform restrictions.** Apple Silicon's Hypervisor.framework blocks PCIe passthrough required for many firmware flashers; macOS rejects unsigned kexts; iOS blocks raw USB.

Real incidents this rule encodes:
- **TCL C845** lacks exFAT licensing — hours of reformatting wasted before discovery.
- **Dell macOS firmware updater** searched for does not exist on macOS; only Windows and Linux builds ship.
- **WD19TB dock firmware flash** blocked by Hypervisor.framework on Apple Silicon — the vendor tool requires PCIe passthrough that the platform forbids.

Scope: consumer hardware and platform-integration questions specifically. Library and framework questions still go through context7.

---

## Reference

- **Profiles** (specialized workflows: `nextjs`, `react-native`, `tauri`, `webgl`, `maestro`, `react-router`) — see `docs/profiles.md`
- **TLDR** (token-efficient codebase exploration via `llm-tldr`) — see `docs/tldr-cheatsheet.md`
- **Hooks** (29 events, 8 categories, conditional `if` filtering) — see `docs/hooks-reference.md`
- **Agent frontmatter** (`tools`, `disallowedTools`, `maxTurns`, `permissionMode`, `effort`, `isolation`, `hooks`, `mcpServers`, `initialPrompt`) — see `docs/frontmatter-reference.md`
- **Knowledge system** (shared team-knowledge repo + local auto-memory) — see `docs/knowledge-system.md`
- **Agent teams** (parallel independent workstreams, `teammateMode: "auto"`) — see `docs/feature-agents-guide.md`

Skill matching is handled by the native `Skill` tool (v2.1.108).

### Supply-chain hook defense

cc-settings detects post-install tampering of `~/.claude/settings.json` — the
Shai-Hulud worm pattern that compromised 172 npm/PyPI packages in May 2026
by injecting a persistent `SessionStart` hook. Two layers:

- **Fingerprint** — `setup.sh` writes a SHA256 of the merged hooks block. The
  `verify-hooks.ts` SessionStart hook re-hashes on every session and warns
  on mismatch. Silent when fingerprint matches.
- **Audit** — `bun run audit:hooks` classifies every hook command in
  `~/.claude/settings.json` as trusted / unknown / suspicious. Exit 1 on
  suspicious findings, suitable for CI.

Custom hooks are preserved by the installer's merger; after intentionally
adding one, re-run `setup.sh` to refresh the fingerprint. The auditor never
self-refreshes the fingerprint — that would let malware whitelist itself.

Full threat model + remediation: see `SECURITY.md`.

### Skill library soft cap — 40

Anthropic's Skills guide flags 20–50 skills as the point where the Skill selector starts struggling to read every description per turn. We sit at 35 cc-settings skills (Tier P1 cleanup May 2026: retired `audit`, `lenis`; merged `create-handoff`+`resume-handoff` → `handoff`, `discovery`+`prd` → `plan-feature`, `ask`+`premortem`+`compare-approaches` → `oracle`, `tdd` folded into `test`, `cc-sync`+`cc-update` → `cc`; folded `long-task` into `orchestrate`; demoted `write-a-skill` to `bun run new-skill` CLI; `nuclear-review` ported from Cursor team-kit May 2026; `share-learning` revived May 2026; `proof-of-work` + `review-batch` added May 2026 from the Orchestration Tax; `freeze` edit-scope lock ported from gstack June 2026). **Adding a new skill past 40 requires removing one** — re-evaluate `skills/` for consolidation candidates first. Validate the library with `bun run lint:skills`, which enforces the spec (kebab-case folders, frontmatter contract, no angle brackets, …) and surfaces the cap as a warning when crossed. Drift hides easily; let the linter catch it.
