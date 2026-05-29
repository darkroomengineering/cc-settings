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

> **Opus 4.8 note**: Claude Opus 4.8 (and 4.7 before it) spawns fewer subagents by default than 4.6 and prefers internal reasoning over tool/agent use. The rules below are **not suggestions** — they are explicit triggers to counter that bias. When a trigger fires, delegate. Do not reason your way out of delegating "because you could do it yourself."

### You MUST delegate (non-negotiable) when:

- **Multi-file exploration spanning 3+ files** → `Agent(explore, "...")`
- **Any task that would require 10+ sequential tool calls** → break into agent tasks
- **Security-sensitive code** (auth, payments, crypto, input validation) → `Agent(security-reviewer, "...")`
- **Writing new test files** → `Agent(tester, "...")`
- **Dead code cleanup or codebase deslop** → `Agent(deslopper, "...")`
- **Parallel independent workstreams** (3+ with no file conflicts) → spawn agents in a single message

### You SHOULD prefer delegation for:

- **Genuinely complex implementation — 3+ files, or 10+ sequential tool calls** → `Agent(implementer, "...")`
- **Architecture decisions or upfront planning** → `Agent(planner, "...")`
- **Scaffolding new components/hooks/pages** → `Agent(scaffolder, "...")`
- **Code review on changes touching 3+ files** → `Agent(reviewer, "...")`
- **Expert second opinions / blast-radius / "why is this here" questions** → `Agent(explore, "...")`
- **Full-feature orchestration across 3+ agents** → `Agent(maestro, "...")`

> **Briefing contract for `implementer`**: as a subagent it gets only your prompt — no conversation context, none of the files you've read — so every prompt MUST contain actual content, not references: the user's ask verbatim, exact file paths and line ranges, the change to make (paste the planner output; never write "based on findings" or "according to plan"), the verification command, and a scope boundary. Thin prompts cause regressions; the agent will refuse them. It runs in the live working tree and leaves changes **uncommitted** for you to review before they land. Full contract: `agents/implementer.md` REQUIRED BRIEFING. This applies equally to `explore` → `implementer` and `planner` → `implementer` chains.

### Act directly ONLY when:

- Reading a specific file you already know the path to
- Small or medium edits spanning 1–2 files, or any change you can finish in under ~10 tool calls
- Running build or test commands
- Simple searches (one grep for a string, one glob for a file pattern)
- Answering a conversational question with no code change

### Enforcement Rules

1. **Parallelize**: when multiple delegations have no dependencies, send all `Agent` calls in a single message — they run concurrently.
2. **Don't narrate the decision**: if a trigger fires, call the Agent tool directly. Don't explain why you're delegating — just delegate.
3. **Match the tool to the size**: the MUST/SHOULD triggers fire only for genuinely heavy work (3+ files, 10+ tool calls, security-sensitive code, new test files). Small and medium edits staying in the main session is the correct default — it keeps the diff reviewable in the working tree before commit. Don't spawn an `implementer` just to prove you delegated.

For full orchestration mode, activate `profiles/maestro.md`. Model routing per agent: see `docs/agent-models.md`.

---

## Effort & Context

**Effort levels** — `low`, `medium`, `high`, `xhigh`, `max`. Default `xhigh` (pinned via `CLAUDE_CODE_EFFORT_LEVEL` in settings.json — guard against silent downgrades). Per-session: `/effort`. Per-agent: `effort` frontmatter.

- `low` — trivial lookups, latency-sensitive
- `medium` — routine edits where depth isn't required
- `high` — non-coding intelligence (writing, analysis)
- `max` — extreme cases only; often overthinks
- `ultracode` — session-only; `xhigh` reasoning plus automatic [dynamic workflow](https://code.claude.com/docs/en/workflows) orchestration. Useful for codebase audits, large migrations, deep research. Set via `/effort ultracode`. Resets on session end. Requires Claude Code v2.1.154+.

**4.8 calibration**: default effort dropped to `high` (was `xhigh` on 4.7). cc-settings pins `xhigh` via `CLAUDE_CODE_EFFORT_LEVEL` so behavior is preserved — but the `xhigh` ladder allocates more thinking tokens on 4.8 than on 4.7 (per-model calibration; see [model-config docs](https://code.claude.com/docs/en/model-config#choose-an-effort-level)). At `low`/`medium` the model still scopes strictly and may under-think. Raise effort rather than prompting around shallow reasoning. Use `ultrathink` keyword for one-turn maximum depth on hard multi-file debugging.

**Context window** — 1M tokens default on Max. Subagents inherit. Use `opus[1m]` / `sonnet[1m]` aliases in settings.json to pin.

- **Manual `/compact` at 65%** — Opus 4.7/4.8's tokenizer is ~1-1.35x heavier per text vs 4.6 (was 70% on 4.6); on 4.8, `xhigh` also allocates more thinking tokens per turn, so context burns faster. Auto-compaction triggers at 95%; don't wait for it.
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
- **Knowledge system** (shared GitHub Project board + local auto-memory) — see `docs/knowledge-system.md`
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

Anthropic's Skills guide flags 20–50 skills as the point where the Skill selector starts struggling to read every description per turn. We sit at 28 cc-settings skills (Tier P1 cleanup May 2026: retired `audit`, `lenis`; merged `create-handoff`+`resume-handoff` → `handoff`, `discovery`+`prd` → `plan-feature`, `ask`+`premortem`+`compare-approaches` → `oracle`, `tdd` folded into `test`, `cc-sync`+`cc-update` → `cc`; folded `long-task` into `orchestrate`; demoted `write-a-skill` to `bun run new-skill` CLI; `nuclear-review` ported from Cursor team-kit May 2026; `share-learning` revived May 2026). **Adding a new skill past 40 requires removing one** — re-evaluate `skills/` for consolidation candidates first. Validate the library with `bun run lint:skills`, which enforces the spec (kebab-case folders, frontmatter contract, no angle brackets, …) and surfaces the cap as a warning when crossed. Drift hides easily; let the linter catch it.
