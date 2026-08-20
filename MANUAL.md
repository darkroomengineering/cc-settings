# cc-settings Manual

> Everything you can do with Darkroom's Claude Code and Codex setup.
> You do not need to memorize commands. Describe the outcome and the selected TUI will invoke the right workflow.

## Quickstart

**1. Install** (one idempotent command; re-run it any time):

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
```

> **Requires [Bun](https://bun.sh) 1.2.21 or newer.** The bootstrap installs Bun when needed. Hooks, scripts, and the installer all run on Bun; there is no Node.js fallback. Install Bun manually first when your environment blocks script-based installers.

The default `auto` target installs both products when `codex` is on `PATH`, and Claude Code only
otherwise. Clone the repository when you need to pass flags:

```bash
bash setup.sh --target=auto
bash setup.sh --target=claude
bash setup.sh --target=codex
bash setup.sh --target=both
```

The same selector works with `--dry-run`, `--status`, `--rollback`, and `--uninstall`. Reinstalls are
ownership-aware and preserve unrelated user configuration. Restart every selected TUI after install.
In Codex, review the installed plugin hooks once through `/hooks`; the fixed HTTPS Figma MCP may ask
you to authenticate. Unknown or invalid flags fail closed. `--migrate-only` rejects
`--target=codex`; `--target=both` runs the Claude migration and skips Codex.

**2. Start a new Darkroom project** (or skip if you have one):

```
> /dr-init my-project
```

You'll be asked to pick a starter: **satus** for Next.js content sites, or **novus** for React Router
7 app-leaning SPAs. cc-settings detects the stack from `package.json` for later workflows.

**3. Open Claude Code or Codex in any project directory.** The team config loads automatically.

**There is nothing to memorize.** cc-settings responds to outcomes described in ordinary language.
The slash names below let you pin a workflow when needed. The rest of this manual explains what ran
and why.

Say what you want. The right thing runs:

| You say | What runs |
|---|---|
| *"fix the login redirect"* | `/fix` — explore → tester → implementer → reviewer |
| *"add a dashboard with stats"* | `/build` — research gate → plan → scaffold → implement → test |
| *"create a Button component"* | `/component` — stack-aware scaffold (Next.js or RR shape) |
| *"how do I use react-router loaders?"* | context7 MCP — current docs, always before adding a new dep |
| *"where does auth happen?"* | `/explore` — read-only map, file:line citations |
| *"ship it"* / *"create a PR"* | `/ship` — typecheck → build → test → lint → review → commit → PR |
| *"review my changes"* | `/review` — your diff against the Darkroom checklist |
| *"is this ready to merge?"* | `/proof-of-work` — the machine gate: typecheck, test, lint, screenshot |
| *"poke holes in this"* / *"are you sure?"* | `/verify` — three competing agents: finder, disprover, judge |
| *"does this look right?"* | `/qa` — screenshot-first visual and a11y critique |
| *"what's wrong with this repo?"* (unfamiliar or client code) | `/triage` — ranked first-pass sweep, read-only |
| *"should this code exist?"* | `/audit` — whole-repo structural audit |
| *"I'm running out of context"* | `/handoff` — save state now, resume cleanly next session |

Those middle rows are the ones worth skimming twice. Several skills look at code and tell you something, and they differ by *what you're asking*, not by how thorough they are: `/review` reads your diff, `/proof-of-work` proves it's green, `/verify` tries to break a specific claim, `/qa` looks at pixels, `/triage` handles a repo you didn't write, `/audit` sweeps everything. Say the question and the right one loads.

**4. When something is unclear**, ask Claude directly: *"what skill handles X?"* or *"what just changed in cc-settings?"*. Or run `bun run whats-on` — it prints every behavior currently shaping your session and how to switch each one off. See [What's on](#whats-on--and-how-to-turn-it-off).

> Your session sees more than cc-settings' 38 skills. Native Claude Code skills (`/loop`, `/schedule`, `/code-review`, `/init`, `/security-review`) and any plugins (`sanity:*`, `vercel:*`) load alongside them — typically 60–80 total. Since Claude Code 2.1.223 the native `/review` is an alias of `/code-review`; cc-settings' own `/review` is the local pre-commit diff check. Full list: [All Skills](#all-skills).

> **For maintainers / contributors:** see `CLAUDE.md` (project-level guidance) and `CHANGELOG.md` for the per-version delta. The merge policy and `--interactive` semantics live in [docs/settings-reference.md](./docs/settings-reference.md#re-install-merge-behavior).

---

## Daily Workflows

### Fix a Bug

Say: *"fix the login redirect"* or *"this is broken"* or *"debug the auth error"*

Triggers `/fix` — spawns explore → tester → implementer → reviewer agents.

### Build a Feature

Say: *"build a user dashboard"* or *"add coupon validation"*

Triggers `/build` — research (GO/NO-GO gate) → plan → scaffold → implement → test.

### Ship / Create PR

Say: *"ship it"* or *"create a PR"*

Triggers `/ship` — type check → build → test → lint → web quality gate → review → commit → PR.

### Review Code

Say: *"review my changes"* or *"check this before merge"*

Triggers `/review` — reviews against Darkroom standards (TypeScript, React, a11y, performance).

### Audit (Eight-Mode Whole-Repo Audit)

Say: *"nuclear review"* / *"thermonuclear review"* / *"code judo"* / *"whole codebase review"* / *"adversarial audit"* / *"audit the codebase"* / *"perf audit"* / *"why is the app slow"* / *"docs audit"* / *"process audit"* / *"walk the journeys"* / *"threat model"* / *"attack surface"*

Triggers `/audit` — whole-repo audit in eight modes. **Codebase mode** is one merged audit with two lenses on the same read. The structure lens (adapted from Cursor's internal `thermo-nuclear-code-quality-review`, their most-used skill; formerly the separate Maintainability mode) asks "should this code exist?" — flags every 1k-line file, thin wrapper, and leaked-logic boundary, pushes "code-judo" moves that delete whole branches instead of rearranging them, and runs a **context7-driven dependency audit** (currency, deprecated API usage, redundant deps). The behavior lens (from the fable audit goal-spec trio; formerly the standalone `/adversarial-audit` codebase mode) asks "does it do what it promises?" — correctness bugs, incoherences, affordance mismatches, expectation gaps. **Docs** audits documentation as a product: drift vs the code, inverted-pyramid violations, oversized documents, missing diagrams. **Process** walks every documented journey empirically in throwaway workspaces — twice, as a human and as an agent — and maps the real state machine, dead ends included. **Performance mode** is empirical-only: a finding does not exist until a number confirms it. It measures client runtime (via the same Lighthouse protocol `/lighthouse` uses), bundle and build, server and data, and code-level hot paths; static reading only generates hypotheses, each confirmed or discarded by a measurement, with unmeasurable leads quarantined in an ungraded appendix. Severity anchors on budgets (CWV thresholds, per-route bundle limits) for measured limits and on leverage (measured cost × path frequency) for the rest. Single-page CWV fix loops stay with `/lighthouse`; this mode reports repo-wide and hands fixes off. **Threat-Model mode** (adapted from openai/skills `security-threat-model`, Apache-2.0) writes a standing repo-grounded threat model: trust boundaries, calibrated attacker capabilities with explicit non-capabilities, abuse paths tied to attacker goals, and mitigations mapped one-to-one to components — run it before a security-sensitive launch or a new internet-facing surface. **Motion** and **SEO** modes audit animation leverage and search/answer-engine discoverability respectively. All modes share the contract that made the July 2026 cc-settings audit land: stable finding IDs, CONFIRMED/PLAUSIBLE status (performance mode drops PLAUSIBLE entirely), concrete failure scenarios, disprove-before-reporting, optional filing of findings as GitHub issues. Run on major version cuts, after extended velocity sprints, or before load-bearing migrations. Distinct from `/review` (per-PR Darkroom checklist) and `/zero-tech-debt` (edits a single patch); `/audit` is read-only and covers the whole repo. **Debt mode** is the odd one out: a mechanical grep that collects `SHORTCUT:` markers (deliberate corners cut, each naming a ceiling and an upgrade trigger) into one ledger, no-trigger entries first. The bare phrase "audit the codebase" routes straight to codebase mode — the merge removed the old maintainability-vs-correctness clarifying question.

### Refactor

Say: *"refactor the payment logic"* or *"clean up this module"*

Triggers `/refactor` — explore → plan → implement → test → review. Preserves behavior.

### Rework to End-State

Say: *"rewrite this as if from scratch"* or *"delete the compat layer"* or *"too many flags"*

Triggers `/zero-tech-debt` — rework a patch from the intended end-state, not from the historical path. Deletes compatibility cruft and mode flags no one calls. Sibling to `/refactor` (out-of-diff restructuring) — this one targets the patch in front of you. (Note: Claude Code 2.1.147 renamed native `/simplify` to `/code-review`, dropping the cleanup-and-fix behavior. As of 2.1.223, native `/review` is simply an alias of `/code-review`, which reviews the current diff or a PR via `/code-review <level> <pr#>`, with `/code-review ultra` for a deep cloud review; calling it with no level reuses the last level you typed. Since 2.1.218 it runs as a background subagent — invoke it and keep working, the review lands as a task notification instead of taking over your conversation.)

---

## Research & Planning

### Explore the Codebase

Say: *"how does auth work?"* or *"where is the routing logic?"*

Triggers `/explore` — read-only investigation, returns file locations and summaries.

### Plan a Feature

Say: *"help me figure out what we need"* or *"write a PRD for X"* or *"define requirements"*

Triggers `/plan-feature` — two-phase: structured discovery interview to clarify scope, then compiles a full PRD with user stories, task breakdown, and parallel execution plan.

### Get Expert Advice / Risks / Compare

Say: *"what should I use for state management?"* / *"what could go wrong?"* / *"compare Zustand vs Jotai"*

Triggers `/adhd` — parallel divergent ideation, ported from [UditAkhourii/adhd](https://github.com/UditAkhourii/adhd) (MIT). Five isolated generator agents run in parallel, each under a different cognitive frame (regulator, biology, speedrunner, 10-year-old, zero-budget, ...), banned from evaluating and banned from the three obvious answers. A critic pass then scores each idea (novelty/viability/fit), clusters by underlying angle, flags traps, and deepens the top 3 with risks and first steps. Expensive by design (~10 Agent calls) — a pre-flight gate answers directly instead when the question is canonical, low-stakes, or phrased for a quick answer. Generators run on the Sonnet subagent pool; only the synthesis costs Opus/Fable. Use `/adhd` to generate the option space, `/oracle` compare to weigh options you already have.

Triggers `/oracle` — three modes:
- **Advice** (`what should I`, `how should I`, `advice on`) — authoritative architectural guidance
- **Risks** (`what could go wrong`, `premortem`, `potential issues`) — failure-mode analysis before you build
- **Compare** (`compare approaches`, `which is better`, `trade-off analysis`) — parallel oracle agents + weighted scoring matrix → ADR

### Build the Domain Glossary

Say: *"set up a context doc"* or *"create a glossary"* or *"record this as an ADR"*

Triggers `/context-doc` — grilling interview that produces a project-level `CONTEXT.md` (domain language) and `docs/adr/` (architecture decisions). Other skills (`/explore`, `/test`) read these files so agent output stays aligned with your project's vocabulary across sessions. Stops agent drift toward generic terminology.

### Zoom Out

Say: *"zoom out"* or *"give me the bigger picture"* or *"where does this fit"*

Triggers `/explore` (upward-zoom mode) — focused map listing immediate callers, sibling modules, and where this area sits in the system, using `CONTEXT.md` vocabulary when present. (Folded in from former `/zoom-out`.)

---

## Quality & Safety

### Adversarial Verification

Say: *"double check this is correct"* or *"verify the auth logic"* or *"prove it"*

Triggers `/verify` — three-agent adversarial pattern: finder (finds issues) → adversary (disproves them) → referee (judges). For high-stakes code.

### Run Tests / TDD

Say: *"test the payment module"* / *"add test coverage"* / *"TDD this"* / *"red-green-refactor"*

Triggers `/test` — delegates to tester agent for writing and running tests. Includes a TDD variant (strict red → green → refactor, test-first discipline) for when tests should drive the design or when the failure mode is "tests pass but behavior is wrong."

### Security Review

Say: *"security review"* or *"check for vulnerabilities"*

Delegates to the `security-reviewer` agent — OWASP checks, secret scanning, auth audit.

### Visual QA

Say: *"QA check the homepage"* or *"does this look right?"*

Triggers `/qa` — screenshot + accessibility snapshot + structured visual review (layout, typography, contrast, hierarchy, a11y).

### Compare to Figma

Say: *"compare to the figma design"* or *"design fidelity check"*

Routes directly to the Figma MCP — `mcp__figma__get_design_context` returns structured specs (tokens, dimensions, component props) and the MCP server's built-in instructions cover URL parsing and the design-to-code workflow. No cc-settings slash command needed (the dedicated `/figma` skill was retired May 2026 — the MCP server handled the workflow on its own).

### Performance Audit

Say: *"run a lighthouse audit"* or *"check page speed"* or *"improve web vitals"*

Triggers `/lighthouse` — runs Lighthouse audits (3 mobile + 3 desktop, averaged), optimizes scores, and visually verifies UI isn't broken after each change.

### Debug in Browser

Say: *"take a screenshot"* or *"what does the page look like?"*

Use the `chrome-devtools` MCP directly (`mcp__chrome-devtools__navigate_page`, `take_screenshot`, `take_snapshot`, `click`, `fill`, …) — there is no longer a dedicated skill for this. The `/qa` skill is the structured-review entry point; for ad-hoc browser debugging, the MCP tools are available to any agent or directly to you in a session. (For general code-level bug fixing use `/fix`.)

---

## Session Management

### Context Window

Say: *"how's my context?"* or *"context usage"* or *"running out of context"*

Triggers `/handoff` (context-window runbook lives inside the handoff skill). Watch the statusline:

```
Opus 4.8 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 70-79% | Consider wrapping up or handing off |
| 80-89% | Start wrapping up |
| 90%+ | Run `/handoff` now |

### Save Progress (Checkpoint)

Say: *"save a checkpoint"* or *"checkpoint before this refactor"*

Triggers `/checkpoint` — lightweight JSON snapshot of task state. Used mid-session for quicksaves.

### End Session (Handoff)

Say: *"done for today"* or *"save state"*

Triggers `/handoff` (save mode) — full markdown session transfer with decisions, files, next steps. Syncs with GitHub Issues if branch is linked.

Handoffs also carry an observed artifact trail — `Files Modified`, `Files Read`, and `Tool Failures` — recorded as the session runs. This is why a file you edited *and committed* hours ago still shows up: `git status` has long forgotten it, but the ledger has not. On the compaction path the Session Summary is filled in automatically from Claude Code's own compaction summary.

### Resume Work

Say: *"resume"* or *"continue where we left off"*

Triggers `/handoff` (resume mode) — loads handoff + checks linked GitHub Issue for shared context.

### Checkpoint vs Handoff

| | Checkpoint | Handoff |
|--|-----------|---------|
| Format | JSON | Markdown |
| Weight | Lightweight quicksave | Full session transfer |
| When | Mid-session, before risky ops | End of session, before compaction |
| GitHub sync | No | Yes |

---

## Creation

### New Component

Say: *"create a Button component"*

Triggers `/component` — scaffolds `components/button/index.tsx` + `button.module.css` with Darkroom conventions.

### New Hook

Say: *"create a useLocalStorage hook"*

Triggers `/hook` — scaffolds `lib/hooks/use-local-storage.ts` with typed options/return interfaces.

### New Project

Say: *"start a new project"*

Triggers `/dr-init` — clones Satus starter template with full Darkroom stack.

### Design Tokens

Say: *"generate a type scale"*, *"create a color palette"*, or *"reduce/dedupe our tokens"*

Triggers `/design-tokens` — generates tokens as Tailwind config or CSS custom properties, or **consolidates** an over-grown Tailwind v4 token set (audit → live-set → rename-map → verify) for fewer tokens with identical render.

### Smooth Scroll

Both satus and novus starters ship Lenis pre-wired — no setup needed for Darkroom projects. For non-Darkroom projects, see the Lenis note in `/dr-init` or check `git log --all -- skills/lenis/` for the retired skill's implementation guide.

---

## Maintenance

### Audit Bash Logs

```bash
bun run claude-audit
```

Analyzes Claude's Bash command logs — categories, repeats, security signals.

### Sync with Claude Code Releases

Say: *"sync with claude code"* or *"changelog sync"* or *"upstream sync"*

Triggers `/cc` (sync mode) — audits cc-settings against the official Claude Code changelog, identifies new features to adopt and native functionality that now duplicates our code, and produces a categorized plan for human review. Stops for approval before any edits, then executes the approved subset, runs validation, and commits + pushes.

### Update Your cc-settings Install

Say: *"update cc-settings"* or *"upgrade cc-settings"* or *"pull the latest"*

Triggers `/cc` (update mode) — compares your installed version against the latest on `origin/main`, shows the commits and CHANGELOG entries that you'd be applying, warns about uncommitted changes in your cc-settings checkout, runs the installer with non-destructive merge, and prompts you to restart Claude Code. Pairs with sync mode: sync keeps the repo in sync with Claude Code upstream (maintainers); update keeps your local install in sync with the repo (everyone).

### Auto-Update (macOS)

cc-settings can update itself automatically instead of you running `/cc` by hand. `setup.sh` registers a macOS `launchd` job that runs daily at **10:00 local time**: it pulls the cc-settings repo, re-runs the installer non-interactively, and sends a desktop notification — either "cc-settings vX installed — restart Claude Code sessions to apply" on success, or a failure notice pointing at the log. Sessions already running pick up the update on restart; the statusline shows a `⟳ v<X> installed — restart Claude to apply` banner in the meantime.

**One-time prompt.** The first time you run `setup.sh` interactively, it asks once: *"Enable daily auto-update? Pulls cc-settings and re-runs setup at 10am"*. Whatever you answer is remembered — you're never asked again, and non-interactive runs (CI, the nightly job itself) never change that decision.

**The flag** overrides the decision anytime, interactively or not:
```bash
bun src/setup.ts --auto-update=on    # enable
bun src/setup.ts --auto-update=off   # disable
```

`bun src/setup.ts --status` reports whether you're enrolled, whether the launchd plist is present, and the timestamp + outcome of the last nightly run.

Safety notes: the job skips itself (and notifies) if your cc-settings checkout has uncommitted changes, never auto-rolls-back a failed update, and macOS-only for now (Linux/Windows: no-op, nothing enrolled). Full threat-model note in [SECURITY.md](SECURITY.md#the-auto-update-launchd-job--a-persistence-surface-outside-the-four-layers).

### Create a New Skill

```bash
bun run new-skill <skill-name>
```

Scaffolds `skills/<name>/SKILL.md` with valid frontmatter. Then edit the description and body per `docs/skill-authoring.md`. After editing, run `bun run lint:skills` and register in `MANAGED_SKILLS` + `MANUAL.md`.

### Harvest a Workflow

Say: *"harvest this workflow"* or *"turn this session into a skill"* or *"capture what the model did before we lose it"*

Triggers `/harvest` — extracts the repeatable procedure behind an unusually good session (a stronger or temporary model, a one-off deep-dive, a teammate's transcript) and lands it as a reviewed artifact: skill, rule, profile section, AGENTS.md diff, or team learning. It works as a **measured ratchet**: a witnessed-behavior census records how many times each behavior repeated (multi-witness vs single-witness), what varied, what evidence was inspected, and what is not proven. That feeds a filled [harvest contract](skills/harvest/CONTRACT.md) — procedure, failure modes, quality bar, trap prompts, required tools — that ends in a **PASS / FAIL / INCONCLUSIVE** verdict. The verdict gates promotion: single-witness never reaches a shared standard on its own, a failed trap blocks promotion, and missing evidence is marked INCONCLUSIVE rather than written up as fact (unknown numbers stay `null`, never aspirational). When the artifact is a skill, harvest seeds `skills/<name>/RESEARCH.md` from the traps + quality bar so `/autoresearch` can optimize it later (blind-run preserved; shape checked with `bun run lint:research`). Stops for approval before touching shared standards or posting team knowledge. Pairs with `/autoresearch`, `/share-learning`, and `/verify` or `/oracle` (the fallback when a behavior is real but can't be measured into a verdict).

### Consolidate Rules & Skills

Say: *"clean up our rules"* or *"consolidate"* or *"spa day"*

Triggers `/consolidate` — audits rules, skills, and learnings for contradictions, overlap, and bloat. Merges and prunes.

### Store a Learning

Say: *"remember this"* — the auto-memory system in `~/.claude/CLAUDE.md` captures personal notes automatically (types: `user`, `feedback`, `project`, `reference`). For team-wide gotchas, decisions, and conventions: use `/share-learning` (see `AGENTS.md` Knowledge Routing section) or describe what to share and the agent will format and post it to the team-knowledge repo.

### Fetch Docs & Check Versions

Say: *"how do I use GSAP ScrollTrigger?"* or *"what's the latest version of gsap?"* — triggered automatically before implementing with or installing a library.

Handled directly by the Context7 MCP server, which prompts itself in for any library question. The `PreToolUse` install hook (`check-docs-before-install.ts`) nudges you to fetch docs before `bun add` / `npm install`. (The dedicated `/docs` skill was retired May 2026 — Context7's own instructions cover the trigger.)

### Optimize a Skill

Say: *"autoresearch the build skill"* or *"optimize skill prompt"*

Triggers `/autoresearch` — autonomous skill optimization loop. Mutates a SKILL.md, tests it, keeps improvements, reverts failures. Runs until interrupted.

---

## Advanced

### Long-Running or Parallel Tasks

Say: *"this is going to be a long task"* / *"overnight refactor"* / *"use teams"* / *"split this across parallel agents"*

Triggers `/orchestrate` — handles both multi-agent fan-out (3+ independent workstreams) and phased long-running execution (checkpoints, verification stack, recovery from interruption).

### Full Orchestration

Say: *"orchestrate this"* or *"coordinate all the agents"*

Triggers `/orchestrate` — delegates to Maestro for multi-agent coordination.

### Review-Queue Backpressure

The statusline shows `⚠ N review` when you've spawned **N agents since your last commit** — your unreviewed-work queue. It's yellow under your review rate and red at/over it, and Claude gets a nudge to stop fanning out and close the loop once you hit the threshold. Committing resets it to 0 (a commit = you reviewed + integrated).

The idea (from the "Orchestration Tax"): your review throughput is the real bottleneck, not how many agents you can spawn — so this applies backpressure when production outruns review. It's the consumer-side counterpart to the delegation nudges. Tune the threshold with `CC_MAX_UNREVIEWED` (default `5`) in the `env` block of `config/10-core.json`.

### Effort Level

Say: *"think harder"* or *"quick fix"*

Triggers `/effort` — adjusts reasoning depth. Levels: `low`, `medium`, `high`, `xhigh`, `max`. cc-settings pins **`high`** as the default via `CLAUDE_CODE_EFFORT_LEVEL` — matching Opus 4.8's own default, a deliberate cost choice: the `xhigh` ladder allocates materially more thinking tokens per turn on 4.8/Fable, and that compounds across every inheriting subagent. Raise to `/effort xhigh` per session for audits, migrations, or hard debugging, or use the `ultrathink` keyword for one deep turn. `ultracode` is a session-only mode (`/effort ultracode`) that layers automatic [dynamic-workflow](https://code.claude.com/docs/en/workflows) orchestration on top of `xhigh`; it can't be persisted as an effort level. Workflows use more tokens than a single window — cap one by prompting a budget (e.g. _"use a workflow, budget 10k tokens"_).

### Model on AWS / Bedrock / Vertex / Foundry

The `high` default above only buys you Opus 4.8's deeper reasoning if you're actually *on* 4.8. On the Anthropic API and claude.ai Max, the `opus` alias resolves to 4.8 automatically. On Claude Platform on **AWS** `opus` still resolves to 4.7, and on **Bedrock / Vertex / Foundry** to 4.6 — pin it explicitly:

```bash
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8
```

Without the pin you silently run an older model whose thinking-token behavior at a given effort level differs. Full model table + ARN examples: `docs/settings-reference.md`.

The cc-settings standing default model is `claude-opus-5` (Opus 5, released 2026-07-24). It runs the full 1M context natively on Max plans, so the `[1m]` pin `opus[1m]` needed on Opus 4.8 is gone — no suffix required. Pricing is unchanged at $5/$25 per MTok, and Opus 5 lands near Fable 5's frontier quality at half the price; it requires Claude Code **v2.1.219+**. Fable 5 (`claude-fable-5`) is generally available but priced at $10/$50 (2× Opus 5) — reach for it per session (`/model fable`) when you specifically want the top of the range, not as the shipped default. History: Fable was suspended on 2026-06-12 by a US government export-control directive ([announcement](https://www.anthropic.com/news/fable-mythos-access)); the interim committed default through that suspension was `opus[1m]` (Opus 4.8). Opus 5 replaces that interim pin as a strict upgrade at the same price. The config pins the full `claude-opus-5` id (not the `opus` alias) for portability: on Microsoft Foundry the `opus` alias may still resolve to an older release (Opus 4.6), whereas the pinned id is unambiguous everywhere it's available.

### Advisor (strong model on call, cheap model at the wheel)

Claude Code can attach a stronger **advisor** model to a cheaper session (v2.1.98+): the session model decides when to consult it, the advisor reads the full transcript server-side and returns a short plan or course correction mid-turn, and the session continues at its own cheaper rate. It runs on subscription plans — advisor tokens count toward your Max usage (`/usage`), no API key needed — but Anthropic API only, so it's unavailable on the Bedrock / Vertex / Foundry routes above.

The recommended shape is **workhorse mode**: `/model sonnet` for the session plus `/advisor opus` (or `/advisor fable` while you have Fable access — needs v2.1.170+). You get near-top-tier planning while burning mostly Sonnet quota — a typical advisor reply is a few hundred tokens, so dozens of consults cost less than one Opus session — and subagents inherit the advisor too.

Not shipped as a default on purpose: our standing model is `claude-opus-5`, where an advisor is marginal, and a Fable session only accepts a Fable advisor. Turn it on per session with `/advisor <model>`, persist it with `"advisorModel"` in `settings.json`, or disable it entirely with `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`. Pairing rules, quota rationale, and caveats (including why Fable-as-advisor advice is unreadable to you): `docs/agent-models.md`.

### Profiles

Activate specialized workflows in `settings.json`:

| Profile | For |
|---------|-----|
| `maestro` | Full orchestration mode |
| `nextjs` | Next.js web apps (satus starter) |
| `react-router` | React Router 7 web apps (novus starter) |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps |
| `webgl` | 3D web (R3F, Three.js, GSAP) |

### Stack-aware skills

Scaffolding skills (`/component`, `/hook`, `/dr-init`, `/build`) auto-detect your project's stack from `package.json` and emit the right shape — Next.js conventions for satus repos, React Router conventions for novus repos. Performance rules (`react-perf`, `performance`, `react`) lead with stack-agnostic principles and include framework-specific subsections; the model picks the right pattern from your file's visible imports.

### Nested `.claude/` directories (monorepos)

As of Claude Code v2.1.178, skills in a nested `.claude/skills` directory load when you work on files under that directory, and on a name clash with a root skill the nested one appears as `<dir>:<name>` so both stay reachable. For agents, workflows, and output-styles the **closest-to-cwd** definition wins on a name collision (v2.1.178). This matters in monorepos that keep a repo-level `.claude/` alongside cc-settings' user-level skills — a package-local skill of the same name no longer shadows silently; it coexists under a directory-qualified name. Sub-agents can also spawn their own sub-agents up to 5 levels deep (v2.1.172), so orchestration skills (`/orchestrate`, `maestro`) can nest fan-outs.

### GitHub Project Sync

Say: *"what am I working on?"* or *"update the issue"*

Triggers `/project` — reads/updates linked GitHub Issues. Auto-detects from branch name (e.g., `feat/123-description`).

### TLDR Code Analysis

Say: *"who calls this function?"* or *"find the auth implementation"*

Triggers `/tldr` for token-efficient codebase analysis. It provides call graphs, impact analysis, and import tracing by default (`native-ts`, TS/JS only); semantic search and dead-code detection need `CC_CODE_INTEL_ENGINE=llm-tldr`.

### MCP servers (core vs optional)

cc-settings ships a **core** set of MCP servers — installed automatically by `setup.sh` into `~/.claude.json`. These power the skills cc-settings advertises.

| Server | Purpose | Used by |
|---|---|---|
| `context7` | Library / framework documentation lookup | Auto-triggered by the server's own instructions on any library question; every skill that fetches docs before adding deps |
| `tldr` | Codemap analysis — call graphs, impact, imports (`native-ts` default; semantic search via opt-in `llm-tldr`) | `/tldr`, `/explore` |
| `figma` | Figma Dev Mode MCP — design tokens, component props | Auto-triggered by the server's own instructions on figma.com URLs; `/qa` for design-fidelity checks |
| `chrome-devtools` | Chrome DevTools (perf traces, network, console, screenshots, a11y tree, click/fill, lighthouse) | `/lighthouse`, `/qa`, `/fix`, `tester` agent, Figma-MCP design-vs-implementation diffs |

That table describes the Claude Code install. Codex automatically receives only the fixed HTTPS
Figma MCP. It does not run Context7 or Chrome DevTools from mutable, unpinned registry packages.
Codex users may configure reviewed and pinned versions themselves.

`context7` installs **keyless**, which is its lower tier. A free key raises the rate limits and adds private-repo lookups — run `bunx ctx7 setup --claude --mcp` (key from [context7.com/dashboard](https://context7.com/dashboard)). Your entry wins over the shipped one on every reinstall, so it survives updates.

The install summary flags this **while the shipped keyless entry is the one running**. Replacing it with any context7 entry of your own silences the reminder — cc-settings doesn't inspect your entry for a key, because the auth shape is context7's to define, not ours to sniff. So a hand-written keyless entry also goes quiet; the reminder targets the default nobody chose, not every keyless setup.

**Optional** servers — not installed by default; add manually to `~/.claude.json` if you want them. Listed in `mcp-configs/recommended.json`:

| Server | Purpose | Why optional |
|---|---|---|
| `github` | GitHub issues / PRs / projects | `gh` CLI covers most of this with lower context cost |
| `vercel` | Deployment management | Stack-specific (Vercel-only) |
| `memory` | Persistent cross-session memory | cc-settings has its own `~/.claude/memory/` system |
| `Sanity` | Sanity CMS operations (GROQ queries, etc.) | Project-specific (satus / novus with Sanity) — not in `config/20-mcp.json`, so `setup.sh` never installs it |

The post-install summary groups MCP servers by status (`core` / `optional` / `user-added`) so a new joiner can tell which came from cc-settings vs which they added themselves.

---

## Guardrails (Always Active)

These are enforced automatically — no skill needed:

- **2-iteration limit** — fails twice? Stop, pivot, present alternatives
- **Bug fix scope** — only touch files related to the bug
- **Pre-commit verification** — `tsc --noEmit` is hooked and blocks `git commit` on type errors; build + tests are not hooked — run them yourself via `bun run proof` or the relevant skill before committing
- **Post-compaction recovery** — re-read plan + active files after compaction
- **Neutral exploration** — agents investigate without bias toward expected outcomes
- **No AI attribution** — stealth mode in all commits and PRs
- **Never fake measurements** — no fabricated Lighthouse/test/build output
- **The `Darkroom` output style** — how replies are written; see below

<a id="whats-on"></a>

### What's on — and how to turn it off

Run `bun run whats-on`. It prints every behavior currently shaping your session — output style, always-on instruction files, model and effort, each wired hook, skill/agent/MCP/permission counts — with the off-switch for each. Different question from `bun src/setup.ts --status`, which reports install health (version drift, missing skills, counts).

### The `Darkroom` output style

Default since v13.6.0. Installed to `~/.claude/output-styles/darkroom.md`, selected by `"outputStyle": "Darkroom"`. It carries two rule sets:

- **Register** — subject first, no stacked modifiers, active voice and direct verbs, one unambiguous subject or decision per sentence, no coined terms for things that already have names, identifiers only when pointing at code, jargon defined inline. It targets comprehension, not word count: it will not make replies terse, and explaining at length stays allowed.
- **Shape** — lead with the next action, number multi-step work, restate progress, no preamble or closers. These are the former "Action-First Output" rules, moved here unchanged (adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT).

**Why an output style and not CLAUDE.md.** A `CLAUDE.md` instruction arrives as a user message after the system prompt, so it competes with the system prompt and fades after a couple of turns — the reason a hand-written `communication_style.md` "works for 1–2 turns then reverts". An output style *is* part of the system prompt, and Claude Code re-issues adherence reminders during the conversation.

Two limits. It applies to the **main conversation only** — subagents run their own system prompt and never receive an output style. What they do receive is the CLAUDE.md hierarchy, so the register rules are duplicated into `CLAUDE.md` as the copy delegated work actually reads (`AGENTS.md` carries a third copy for Codex, Cursor, and humans — Claude Code does not auto-load it). And it loads **once per session**: a change needs `/clear` or a new session.

**To turn it off:** `/config` → Output style → Default, or set your own `outputStyle` in `~/.claude/settings.json` (user scope wins over the shipped value).

Claude Code v2.1.237 ships a built-in "Concise" style (leads with results, skips preamble). Darkroom stays the default here: Concise targets brevity only, while Darkroom carries the register rules too — the gap that made every brevity-only experiment (`/caveman`, `/tldr`, `i-have-adhd`) shorter but no clearer.

---

## Install Tiers (Light vs Full)

cc-settings supports light and full profiles for both products. The full profile is the default.
`--light` keeps a smaller native footprint, but its contents differ by product.

### Claude Code tiers

| Surface | Light (`--light`) | Full (default) |
|---|---|---|
| **Skills** | `share-learning` only | All 38 shared skills |
| **Agents** | None | All Claude role agents, including `codex-verifier` |
| **MCP servers** | None | `context7`, `tldr`, `figma`, `chrome-devtools` |
| **Hooks** | Statusline only | Full Claude hook set |
| **Instructions and permissions** | Claude Code defaults | Darkroom instructions, rules, profiles, and allowlist |

Claude light is raw Claude Code plus the custom statusline and `share-learning` skill.

### Codex tiers

| Surface | Light (`--light`) | Full (default) |
|---|---|---|
| **Managed Darkroom block in `AGENTS.md`** | Yes | Yes |
| **Runtime source and sentinel** | Yes | Yes |
| **Plugin and MCP servers** | None | `darkroom@cc-settings` with the fixed HTTPS Figma MCP |
| **Native role agents** | None | All shared roles except `codex-verifier` |
| **Command rule** | None | `rules/darkroom.rules` |

Codex light keeps the Darkroom instructions and runtime source. It skips the plugin, native role
agents, and command rule. Claude light and Codex light are therefore not exact equivalents.

Codex does not bundle `tldr`; shared workflows fall back to `rg` and native search. `/freeze`
enforcement, `/autoresearch`'s Claude subprocess loop, Claude agent teams, dynamic workflows, and
the custom statusline remain Claude-only. See [docs/codex.md](./docs/codex.md#platform-boundaries).

### Install or switch tiers

```bash
# Light profile for the selected product
bash setup.sh --target=claude --light
bash setup.sh --target=codex --light
bash setup.sh --target=both --light

# Full profile for the selected product
bash setup.sh --target=claude
bash setup.sh --target=codex
bash setup.sh --target=both
```

On Windows, substitute `.\setup.ps1` for `bash setup.sh`. Re-running with or without `--light`
switches tiers without manual cleanup. Only cc-settings-owned entries are removed. Claude user
settings survive. Codex user agents, rules, and text outside the marked `AGENTS.md` block survive.

### Standalone Claude plugin install

Cowork and Claude Code can also install the portable Claude plugin when `setup.sh` does not apply:

```text
/plugin marketplace add darkroomengineering/cc-settings
/plugin install darkroom@cc-settings
```

The portable Claude plugin includes the skills, agents, and self-contained `context7`, `figma`, and
`chrome-devtools` MCP connectors. It does not include the full installer-managed Claude hooks,
rules, profiles, instructions, permissions, or `tldr` server. The native Codex installer manages
its own plugin automatically in the full profile.

---

## Reference

### All Skills

| Skill | Triggers On |
|-------|-------------|
| `fix` | bug, broken, error, not working |
| `build` | build, create, implement, add feature |
| `ship` | ship it, create PR, /pr |
| `review` | review, check, PR, changes |
| `audit` | nuclear review, thermonuclear, code judo, whole codebase review, harsh maintainability review, 1k-line, thin wrapper, stale dependencies, adversarial audit, fable audit, audit the codebase, perf audit, performance audit, why is the app slow, bundle audit, build is slow, docs audit, doc drift, process audit, walk the journeys, expectation gaps |
| `refactor` | refactor, clean up, reorganize |
| `zero-tech-debt` | rewrite as if from scratch, delete compat layer, kill legacy path, too many flags |
| `test` | test, write tests, coverage, TDD, test-first, red-green-refactor |
| `verify` | verify, double check, prove it |
| `proof-of-work` | proof of work, review-ready, verify before review, prove it is green |
| `review-batch` | review batch, review all the agents, what's pending review, catch up on agent work |
| `oracle` | advice, what should I, risks, what could go wrong, compare approaches, trade-off analysis |
| `adhd` | /adhd, brainstorm, ideate, widen the option space, divergent ideas |
| `plan-feature` | help me figure out, vague scope, define requirements, PRD, requirements document, product spec |
| `orchestrate` | complex task, coordinate, parallel agents, overnight, long running, autonomous task, marathon |
| `project` | project status, update the issue |
| `tldr` | who calls, dependencies, semantic search |
| `component` | create component, new component |
| `hook` | create hook, custom hook |
| `dr-init` | new darkroom project, satus, novus, scaffold from starter (`dr-` prefix = Darkroom-specific) |
| `design-tokens` | type scale, color palette, spacing system, reduce/dedupe/consolidate tokens |
| `qa` | visual QA, accessibility, contrast, touch target |
| `lighthouse` | lighthouse, performance audit, page speed, web vitals |
| `checkpoint` | snapshot, before risky op, restore checkpoint, rollback to |
| `handoff` | done for today, ending session, context window, running out of context, resume, continue, last session |
| `explore` | how does, where is, find, understand, zoom out, bigger picture |
| `consolidate` | clean up rules, contradictions, spa day |
| `cc` | sync with claude code, changelog sync, update cc-settings, upgrade cc-settings, pull the latest |
| `codex` | codex exec, codex review, codex ask, cross-model verification, second opinion, bulk execution via Codex CLI — see `docs/codex-bridge.md` |
| `context-doc` | domain glossary, ADR, shared vocabulary, context doc |
| `autoresearch` | autoresearch, optimize skill, improve skill prompt |
| `harvest` | harvest this workflow, capture what the model did, turn this session into a skill, preserve this behavior, model handoff |
| `share-learning` | share this learning, post to team knowledge, team-wide finding |
| `freeze` | freeze edits, lock editing scope, restrict edits to, only edit this folder, unfreeze |
| `plan-ceo-review` | ceo review, founder review, product review, is this the right approach, should we even build this |
| `retro` | retro, retrospective, weekly review, how was my week, engineering metrics, what did I ship |
| `strategist` | strategist, product strategy, market positioning, what should we build, product direction |

### All Agents

| Agent | Role | Delegates To |
|-------|------|-------------|
| `planner` | Task breakdown, architecture | — |
| `implementer` | Write and edit code | — |
| `reviewer` | Code review, quality checks | — |
| `tester` | Write and run tests | — |
| `scaffolder` | Boilerplate generation | — |
| `explore` | Read-only codebase navigation | — |
| `security-reviewer` | OWASP, secrets, auth audit | — |
| `deslopper` | Dead code removal, cleanup | scanners (team mode) |
| `codex-verifier` | Independent cross-model verification (Codex CLI) | — |
| `maestro` | Multi-agent orchestration | all of the above |

### Hooks (Automatic)

cc-settings wires scripts into a subset of Claude Code's 29 hook events — see `docs/hooks-reference.md` for the full taxonomy.

Hook types: `command` (shell), `prompt` (LLM yes/no), `agent` (subagent with tools), `http` (webhook to URL).

| Event | What Happens |
|-------|-------------|
| Session start | Load learnings, check TLDR index |
| User prompt | Delegation breadth detection (`delegation-detector.ts`), session title |
| Pre-tool (Bash) | Safety net, pre-commit TSC, docs check before install |
| Pre-tool (Edit) | Stale file detection |
| Permission request | When a tool needs user permission |
| Post-tool (Write/Edit) | Post-edit validation, async TSC |
| Post-tool (Bash) | Command audit log |
| Post-tool (all) | Tool cadence: non-Agent call counter + review-queue backpressure (`tool-cadence.ts`) |
| Post-tool batch | Session ledger: records which files the batch read/changed (`ledger-record.ts`) |
| Tool failure | Failure tracking + exact tool/error into the session ledger |
| Pre-compact | Auto-handoff save (with session provenance) |
| Post-compact | Persists the compaction summary into that session's handoff |
| Stop | Learning reminder (`stop-summary.ts`) |
| Stop failure | Turn ends due to API error (rate limit, auth failure) |
| Session end | Auto-handoff |
| Subagent start/stop | Swarm logging |
| Teammate idle | Agent Teams teammate goes idle |
| Task completed | Task marked completed |
| Notification | Desktop notification |
| Instructions loaded | CLAUDE.md or rules loaded |
| Config change | Configuration file changes during session |
| Elicitation / result | MCP server requests structured user input |
| Worktree create/remove | Worktree lifecycle management |
