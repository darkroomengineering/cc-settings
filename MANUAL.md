# cc-settings Manual

> Everything you can do with Darkroom's Claude Code setup.
> You don't need to memorize this — just describe what you want and Claude will invoke the right skill.

## Light vs Full

cc-settings ships two install tiers. Both are **supported permanent lanes** — not just onboarding vs advanced.

### Which tier should I use?

| | Light (`--light`) | Full (default) |
|--|---|---|
| **Skills** | `share-learning` only | All 28 headline skills |
| **Agents** | None (raw Claude Code) | All agents (`explore`, `implementer`, `reviewer`, `tester`, `planner`, `scaffolder`, `maestro`, `deslopper`, `security-reviewer`, …) |
| **MCP servers** | None | `context7`, `tldr`, `figma`, `chrome-devtools` |
| **Hooks** | StatusLine only | All hooks active |
| **Effort** | Claude Code default | `xhigh` |
| **CLAUDE.md / AGENTS.md** | Not installed | Full delegation matrix, effort calibration, coding standards |
| **Permissions** | Claude Code defaults | cc-settings allow-list |

**Light is raw Claude Code** with exactly two cc-settings additions: the `statusLine` (shows branch + git status in the prompt bar) and the `share-learning` skill (lets you contribute learnings back to the team knowledge board). Everything else is the Claude Code you get without any configuration.

### How to install

```bash
# Light tier (raw Claude Code + statusLine + share-learning)
bash setup.sh --light

# Full tier (default — full team config)
bash setup.sh
```

On Windows, substitute `.\setup.ps1` for `bash setup.sh` throughout — the PowerShell bootstrap forwards the same flags.

### Switching tiers

Re-running `setup.sh` with the other flag switches tiers idempotently — no manual cleanup needed. A full→light switch strips the cc-settings footprint (CLAUDE.md, AGENTS.md, agents, rules, profiles, docs, MCP servers, hooks, env overrides, permission rules) and leaves only `share-learning` and the statusLine. A light→full switch reinstalls everything.

```bash
# Switch from full → light
bash setup.sh --light

# Switch from light → full
bash setup.sh
```

**Note**: A full→light switch preserves any settings.json content you added yourself (custom MCP servers, custom hook groups, custom env vars you set to a different value than the full baseline). Only cc-settings-managed entries are removed.

### Plugin install (Cowork and Claude Code)

The repo is also installable as a Claude Code plugin — useful in Cowork (the desktop app), where `setup.sh` doesn't apply:

```
/plugin marketplace add darkroomengineering/cc-settings
/plugin install darkroom@cc-settings
```

The plugin carries the **portable surface only**: all skills (namespaced as `/darkroom:<skill>`), agents, and the self-contained MCP connectors (`context7`, `figma`, `chrome-devtools`). It does **not** carry hooks, rules, profiles, CLAUDE.md/AGENTS.md, permission rules, or the `tldr` server (which needs a locally installed binary) — those remain `setup.sh` territory. If you already ran `setup.sh`, you don't need the plugin; installing both registers the MCP servers twice (harmless, but noisy).

---

## Quickstart

**1. Install** (one command, idempotent — re-run it any time):

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
```

> **Requires [Bun](https://bun.sh) ≥ 1.1.30.** The bootstrap auto-installs Bun via `curl -fsSL https://bun.sh/install | bash` (or `irm bun.sh/install.ps1 | iex` on Windows) if you don't have it. Hooks, scripts, and the installer itself all run on Bun — there's no Node.js fallback. If your environment blocks `curl`-installs (corporate sandboxes), install Bun manually first.

Re-installs are non-destructive: hand-added permission rules, custom hooks, local env overrides, and custom MCP servers all survive. Update later via `cd ~/.claude/cc-settings && git pull && bash setup.sh`. Pass `--interactive` to be prompted on each settings conflict, or `--migrate-only` to run just the merger (settings.json clean-up) and skip the file-copy phase.

**2. Start a new Darkroom project** (or skip if you have one):

```
> /dr-init my-project
```

You'll be asked to pick a starter — **satus** (Next.js, content sites) or **novus** (React Router 7, app-leaning SPAs). cc-settings auto-detects which one each project uses from `package.json` for everything that follows.

**3. Open Claude Code in any project directory.** The team config loads automatically. Just describe what you want:

| You say | What happens |
|---|---|
| *"fix the login redirect"* | `/fix` — explore → tester → implementer → reviewer |
| *"add a dashboard with stats"* | `/build` — research gate → plan → scaffold → implement → test |
| *"create a Button component"* | `/component` — stack-aware scaffold (Next.js or RR shape) |
| *"how do I use react-router loaders?"* | Context7 MCP — fetches current docs (always before adding new deps) |
| *"ship it"* / *"create a PR"* | `/ship` — typecheck → build → test → lint → review → commit → PR |
| *"review my changes"* | `/review` — checks against TypeScript / React / a11y / performance rules |
| *"audit my recent activity"* | `bun run claude-audit` — analyzes Bash command logs |

**4. Don't memorize skills.** Just talk normally. The `Skill` tool auto-matches the right one. To see all 34 cc-settings skills, scroll to [All Skills](#all-skills) below. (Native Claude Code skills like `/loop`, `/schedule`, `/code-review`, `/review`, `/init`, `/security-review`, and any plugins like `sanity:*` or `vercel:*` load in addition — your session typically sees 60–80 skills total.)

**5. When something is unclear**, ask Claude directly: *"what skill handles X?"* or *"what just changed in cc-settings?"*. The setup is self-describing.

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

### Nuclear Review (Whole-Codebase Code-Judo Pass)

Say: *"nuclear review"* / *"thermonuclear review"* / *"code judo"* / *"harsh maintainability review"* / *"whole codebase review"*

Triggers `/nuclear-review` — unusually strict **whole-codebase** structural audit. Structural rubric adapted from Cursor's internal `thermo-nuclear-code-quality-review` (their most-used skill); cc-settings extends it with whole-codebase scope and a **context7-driven dependency audit** (currency, deprecated API usage, redundant deps, missed maintainer-recommended patterns). Flags every 1k-line file, every thin wrapper, every leaked-logic boundary, and pushes "code-judo" moves that delete whole branches instead of rearranging them. Run on major version cuts, after extended velocity sprints, or before load-bearing migrations. Distinct from `/review` (per-PR Darkroom checklist) and `/zero-tech-debt` (edits a single patch); nuclear-review is read-only and covers the whole repo.

### Refactor

Say: *"refactor the payment logic"* or *"clean up this module"*

Triggers `/refactor` — explore → plan → implement → test → review. Preserves behavior.

### Rework to End-State

Say: *"rewrite this as if from scratch"* or *"delete the compat layer"* or *"too many flags"*

Triggers `/zero-tech-debt` — rework a patch from the intended end-state, not from the historical path. Deletes compatibility cruft and mode flags no one calls. Sibling to `/refactor` (out-of-diff restructuring) — this one targets the patch in front of you. (Note: Claude Code 2.1.147 renamed native `/simplify` to `/code-review`, dropping the cleanup-and-fix behavior.)

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
Fable 5 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
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

### Create a New Skill

```bash
bun run new-skill <skill-name>
```

Scaffolds `skills/<name>/SKILL.md` with valid frontmatter. Then edit the description and body per `docs/skill-authoring.md`. After editing, run `bun run lint:skills` and register in `MANAGED_SKILLS` + `MANUAL.md`.

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

Triggers `/effort` — adjusts reasoning depth. Levels: `low`, `medium`, `high`, `xhigh`, `max`. cc-settings pins **`xhigh`** as the default via `CLAUDE_CODE_EFFORT_LEVEL` — on Opus 4.8 the model's own default is `high`, and the pin overrides it to hold reasoning depth steady across model upgrades. `ultracode` is a session-only mode (`/effort ultracode`) that layers automatic [dynamic-workflow](https://code.claude.com/docs/en/workflows) orchestration on top of `xhigh`; it can't be persisted as an effort level. Workflows use more tokens than a single window — cap one by prompting a budget (e.g. _"use a workflow, budget 10k tokens"_).

### Model on AWS / Bedrock / Vertex / Foundry

The `xhigh` default above only buys you Opus 4.8's deeper reasoning if you're actually *on* 4.8. On the Anthropic API and claude.ai Max, the `opus` alias resolves to 4.8 automatically. On Claude Platform on **AWS** `opus` still resolves to 4.7, and on **Bedrock / Vertex / Foundry** to 4.6 — pin it explicitly:

```bash
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8
```

Without the pin you silently run an older model whose `xhigh` thinking-token behavior differs. Full model table + ARN examples: `docs/settings-reference.md`.

The cc-settings default model is now `fable` (`claude-fable-5`), available on the first-party API and claude.ai Max. On AWS / Bedrock / Vertex / Foundry, where Fable 5 may not yet be offered, set `model` to `opus` and pin `claude-opus-4-8` (as above) until Fable is available there.

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

### GitHub Project Sync

Say: *"what am I working on?"* or *"update the issue"*

Triggers `/project` — reads/updates linked GitHub Issues. Auto-detects from branch name (e.g., `feat/123-description`).

### TLDR Code Analysis

Say: *"who calls this function?"* or *"find the auth implementation"*

Triggers `/tldr` — token-efficient codebase analysis. 95% fewer tokens than reading files. Semantic search, impact analysis, call graphs, dead code detection.

### MCP servers (core vs optional)

cc-settings ships a **core** set of MCP servers — installed automatically by `setup.sh` into `~/.claude.json`. These power the skills cc-settings advertises.

| Server | Purpose | Used by |
|---|---|---|
| `context7` | Library / framework documentation lookup | Auto-triggered by the server's own instructions on any library question; every skill that fetches docs before adding deps |
| `tldr` | Semantic codebase analysis (call graphs, impact) | `/tldr`, `/explore` |
| `figma` | Figma Dev Mode MCP — design tokens, component props | Auto-triggered by the server's own instructions on figma.com URLs; `/qa` for design-fidelity checks |
| `chrome-devtools` | Chrome DevTools (perf traces, network, console, screenshots, a11y tree, click/fill, lighthouse) | `/lighthouse`, `/qa`, `/fix`, `tester` agent, Figma-MCP design-vs-implementation diffs |
| `Sanity` | Sanity CMS operations (GROQ queries, etc.) | satus / novus projects with Sanity integration |

**Optional** servers — not installed by default; add manually to `~/.claude.json` if you want them. Listed in `mcp-configs/recommended.json`:

| Server | Purpose | Why optional |
|---|---|---|
| `github` | GitHub issues / PRs / projects | `gh` CLI covers most of this with lower context cost |
| `vercel` | Deployment management | Stack-specific (Vercel-only) |
| `memory` | Persistent cross-session memory | cc-settings has its own `~/.claude/memory/` system |

The post-install summary groups MCP servers by status (`core` / `optional` / `user-added`) so a new joiner can tell which came from cc-settings vs which they added themselves.

---

## Guardrails (Always Active)

These are enforced automatically — no skill needed:

- **2-iteration limit** — fails twice? Stop, pivot, present alternatives
- **Bug fix scope** — only touch files related to the bug
- **Pre-commit verification** — tsc + build + tests must pass before any commit
- **Post-compaction recovery** — re-read plan + active files after compaction
- **Neutral exploration** — agents investigate without bias toward expected outcomes
- **No AI attribution** — stealth mode in all commits and PRs
- **Never fake measurements** — no fabricated Lighthouse/test/build output

---

## Reference

### All Skills

| Skill | Triggers On |
|-------|-------------|
| `fix` | bug, broken, error, not working |
| `build` | build, create, implement, add feature |
| `ship` | ship it, create PR, /pr |
| `review` | review, check, PR, changes |
| `nuclear-review` | nuclear review, thermonuclear, code judo, whole codebase review, harsh maintainability review, 1k-line, thin wrapper, stale dependencies |
| `refactor` | refactor, clean up, reorganize |
| `zero-tech-debt` | rewrite as if from scratch, delete compat layer, kill legacy path, too many flags |
| `test` | test, write tests, coverage, TDD, test-first, red-green-refactor |
| `verify` | verify, double check, prove it |
| `proof-of-work` | proof of work, review-ready, verify before review, prove it is green |
| `review-batch` | review batch, review all the agents, what's pending review, catch up on agent work |
| `oracle` | advice, what should I, risks, what could go wrong, compare approaches, trade-off analysis |
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
| `context-doc` | domain glossary, ADR, shared vocabulary, context doc |
| `autoresearch` | autoresearch, optimize skill, improve skill prompt |
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
| `maestro` | Multi-agent orchestration | all of the above |

### Hooks (Automatic)

cc-settings wires scripts into a subset of Claude Code's 29 hook events — see `docs/hooks-reference.md` for the full taxonomy.

Hook types: `command` (shell), `prompt` (LLM yes/no), `agent` (subagent with tools), `http` (webhook to URL).

| Event | What Happens |
|-------|-------------|
| Session start | Load learnings, check TLDR index |
| Setup | Runs on `--init`, `--init-only`, or `--maintenance` CLI flags |
| User prompt | Delegation breadth detection (`delegation-detector.ts`), session title |
| Pre-tool (Bash) | Safety net, pre-commit TSC, docs check before install |
| Pre-tool (Edit) | Stale file detection |
| Permission request | When a tool needs user permission |
| Post-tool (Write/Edit) | Post-edit validation, async TSC |
| Post-tool (Bash) | Command audit log |
| Post-tool (all) | Tool cadence: non-Agent call counter + review-queue backpressure (`tool-cadence.ts`) |
| Tool failure | Failure tracking |
| Pre-compact | Auto-handoff save |
| Post-compact | After context compaction completes |
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
