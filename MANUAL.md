# cc-settings Manual

> Everything you can do with Darkroom's Claude Code setup.
> You don't need to memorize this — just describe what you want and Claude will invoke the right skill.

## Quickstart

**1. Install** (one command, idempotent — re-run it any time):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

> **Requires [Bun](https://bun.sh) ≥ 1.1.30.** The bootstrap auto-installs Bun via `curl -fsSL https://bun.sh/install | bash` if you don't have it. Hooks, scripts, and the installer itself all run on Bun — there's no Node.js fallback. If your environment blocks `curl`-installs (corporate sandboxes), install Bun manually first.

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
| *"audit my recent activity"* | `/audit` — analyzes Bash command logs |

**4. Don't memorize skills.** Just talk normally. The `Skill` tool auto-matches the right one. To see all 36 cc-settings skills, scroll to [All Skills](#all-skills) below. (Native Claude Code skills like `/loop`, `/schedule`, `/simplify`, `/review`, `/init`, `/security-review`, and any plugins like `sanity:*` or `vercel:*` load in addition — your session typically sees 60–80 skills total.)

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

### Refactor

Say: *"refactor the payment logic"* or *"clean up this module"*

Triggers `/refactor` — explore → plan → implement → test → review. Preserves behavior.

---

## Research & Planning

### Explore the Codebase

Say: *"how does auth work?"* or *"where is the routing logic?"*

Triggers `/explore` — read-only investigation, returns file locations and summaries.

### Compare Approaches

Say: *"compare Zustand vs Jotai"* or *"which approach is better?"*

Triggers `/compare-approaches` — spawns parallel oracle agents, builds weighted scoring matrix, outputs ADR. (Renamed from `/f-thread`.)

### Write a PRD

Say: *"write a PRD for the notification system"*

Triggers `/prd` — clarifying questions → scope → user stories → task breakdown → execution plan.

### Get Expert Advice

Say: *"what should I use for state management?"* or *"advice on caching strategy"*

Triggers `/ask` — delegates to the oracle agent for evidence-based guidance.

### Discover Requirements

Say: *"help me figure out what we need"*

Triggers `/discovery` — structured interview to turn vague ideas into clear requirements.

### Build the Domain Glossary

Say: *"set up a context doc"* or *"create a glossary"* or *"record this as an ADR"*

Triggers `/context-doc` — grilling interview that produces a project-level `CONTEXT.md` (domain language) and `docs/adr/` (architecture decisions). Other skills (`/explore`, `/tdd`) read these files so agent output stays aligned with your project's vocabulary across sessions. Stops agent drift toward generic terminology.

### Zoom Out

Say: *"zoom out"* or *"give me the bigger picture"* or *"where does this fit"*

Triggers `/explore` (upward-zoom mode) — focused map listing immediate callers, sibling modules, and where this area sits in the system, using `CONTEXT.md` vocabulary when present. (Folded in from former `/zoom-out`.)

### Premortem

Say: *"what could go wrong with this approach?"*

Triggers `/premortem` — analyzes failure modes before they happen.

---

## Quality & Safety

### Adversarial Verification

Say: *"double check this is correct"* or *"verify the auth logic"* or *"prove it"*

Triggers `/verify` — three-agent adversarial pattern: finder (finds issues) → adversary (disproves them) → referee (judges). For high-stakes code.

### Run Tests

Say: *"test the payment module"* or *"add test coverage"*

Triggers `/test` — delegates to tester agent for writing and running tests.

### Test-Driven Development

Say: *"TDD this"* or *"red-green-refactor"* or *"test-first"*

Triggers `/tdd` — strict red → green → refactor discipline. Sibling to `/build` (which scaffolds tests after impl). Use this when you want tests to drive the design, or when the failure mode is "tests pass but behavior is wrong."

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

Triggers `/create-handoff` (context-window runbook now lives inside the handoff skill). Watch the statusline:

```
Opus 4.7 | my-project | main*↑ | ▊░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 70-79% | Consider wrapping up or handing off |
| 80-89% | Start wrapping up |
| 90%+ | Run `/create-handoff` now |

### Save Progress (Checkpoint)

Say: *"save a checkpoint"* or *"checkpoint before this refactor"*

Triggers `/checkpoint` — lightweight JSON snapshot of task state. Used mid-session for quicksaves.

### End Session (Handoff)

Say: *"done for today"* or *"save state"*

Triggers `/create-handoff` — full markdown session transfer with decisions, files, next steps. Syncs with GitHub Issues if branch is linked.

### Resume Work

Say: *"resume"* or *"continue where we left off"*

Triggers `/resume-handoff` — loads handoff + checks linked GitHub Issue for shared context.

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

Say: *"generate a type scale"* or *"create a color palette"*

Triggers `/design-tokens` — generates tokens as Tailwind config or CSS custom properties.

### Smooth Scroll

Say: *"set up Lenis"* or *"add smooth scrolling"*

Triggers `/lenis` — installs and configures Lenis smooth scroll.

---

## Maintenance

### Sync with Claude Code Releases

Say: *"sync with claude code"* or *"changelog sync"* or *"upstream sync"*

Triggers `/cc-sync` — audits cc-settings against the official Claude Code changelog, identifies new features to adopt and native functionality that now duplicates our code, and produces a categorized plan for human review. Stops for approval before any edits, then executes the approved subset, runs validation, and commits + pushes.

### Update Your cc-settings Install

Say: *"update cc-settings"* or *"upgrade cc-settings"* or *"pull the latest"*

Triggers `/cc-update` — compares your installed version against the latest on `origin/main`, shows the commits and CHANGELOG entries that you'd be applying, warns about uncommitted changes in your cc-settings checkout, runs the installer with non-destructive merge, and prompts you to restart Claude Code. Pairs with `/cc-sync`: `/cc-sync` keeps the repo in sync with Claude Code upstream (maintainers); `/cc-update` keeps your local install in sync with the repo (everyone).

### Create a New Skill

Say: *"create a skill"* or *"write a new skill"*

Triggers `/write-a-skill` — scaffolds a new cc-settings skill with the right frontmatter, file layout, and registration. Writes `skills/<name>/SKILL.md`, optional reference docs, and updates `MANAGED_SKILLS` + `MANUAL.md` so the installer ships it.

### Consolidate Rules & Skills

Say: *"clean up our rules"* or *"consolidate"* or *"spa day"*

Triggers `/consolidate` — audits rules, skills, and learnings for contradictions, overlap, and bloat. Merges and prunes.

### Store a Learning

Say: *"remember this"* — the auto-memory system in `~/.claude/CLAUDE.md` captures personal notes automatically (types: `user`, `feedback`, `project`, `reference`). For team-wide gotchas, decisions, and conventions: *"share this with the team"* → triggers `/share-learning`, posts to the GitHub Project board.

### Fetch Docs & Check Versions

Say: *"how do I use GSAP ScrollTrigger?"* or *"what's the latest version of gsap?"* — triggered automatically before implementing with or installing a library.

Handled directly by the Context7 MCP server, which prompts itself in for any library question. The `PreToolUse` install hook (`check-docs-before-install.ts`) nudges you to fetch docs before `bun add` / `npm install`. (The dedicated `/docs` skill was retired May 2026 — Context7's own instructions cover the trigger.)

### Optimize a Skill

Say: *"autoresearch the build skill"* or *"optimize skill prompt"*

Triggers `/autoresearch` — autonomous skill optimization loop. Mutates a SKILL.md, tests it, keeps improvements, reverts failures. Runs until interrupted.

---

## Advanced

### Long-Running Tasks

Say: *"this is going to be a long task"* or *"overnight refactor"*

Triggers `/long-task` — phased execution with automatic checkpoints, verification stack, and recovery from interruption. (Renamed from `/l-thread`.)

### Parallel Agent Teams

Say: *"use teams"* or *"split this across parallel agents"*

Triggers `/orchestrate` (teams mode) — coordinates multiple independent Claude Code instances for true parallelism. Use when 3+ independent workstreams. (Merged in from former `/teams`.)

### Full Orchestration

Say: *"orchestrate this"* or *"coordinate all the agents"*

Triggers `/orchestrate` — delegates to Maestro for multi-agent coordination.

### Effort Level

Say: *"think harder"* or *"quick fix"*

Triggers `/effort` — adjusts reasoning depth. Levels: `low`, `medium`, `high` (default).

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

Scaffolding skills (`/component`, `/hook`, `/dr-init`, `/build`, `/lenis`) auto-detect your project's stack from `package.json` and emit the right shape — Next.js conventions for satus repos, React Router conventions for novus repos. Performance rules (`web-vitals`, `react-perf`, `performance`, `react`) lead with stack-agnostic principles and include framework-specific subsections; the model picks the right pattern from your file's visible imports.

The detector lives in `src/lib/stack.ts` if you need to extend it to a new framework.

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
| `refactor` | refactor, clean up, reorganize |
| `test` | test, write tests, coverage |
| `verify` | verify, double check, prove it, audit |
| `ask` | advice, guidance, what should I |
| `discovery` | requirements, scope, figure out |
| `prd` | PRD, requirements document, product spec |
| `premortem` | risks, what could go wrong |
| `compare-approaches` | compare approaches, architecture decision, decide between, trade-off analysis |
| `long-task` | overnight, long running, autonomous task, marathon |
| `orchestrate` | complex task, coordinate, parallel agents, split work, fan out, multi-instance |
| `project` | project status, update the issue |
| `tldr` | who calls, dependencies, semantic search |
| `component` | create component, new component |
| `hook` | create hook, custom hook |
| `dr-init` | new darkroom project, satus, novus, scaffold from starter (`dr-` prefix = Darkroom-specific) |
| `design-tokens` | type scale, color palette, spacing system |
| `lenis` | smooth scroll, lenis |
| `qa` | visual QA, accessibility, contrast, touch target |
| `lighthouse` | lighthouse, performance audit, page speed, web vitals |
| `checkpoint` | snapshot, before risky op, restore checkpoint, rollback to |
| `create-handoff` | done for today, ending session, context window, running out of context |
| `resume-handoff` | resume, continue, last session |
| `explore` | how does, where is, find, understand, zoom out, bigger picture |
| `share-learning` | share with team, post to knowledge base, everyone should know |
| `consolidate` | clean up rules, contradictions, spa day |
| `cc-sync` | sync with claude code, changelog sync, upstream sync |
| `cc-update` | update cc-settings, upgrade cc-settings, pull the latest |
| `context-doc` | domain glossary, ADR, shared vocabulary, context doc |
| `tdd` | TDD, test-first, red-green-refactor |
| `write-a-skill` | create a skill, write a new skill |
| `audit` | slash-only (`/audit`) |
| `autoresearch` | autoresearch, optimize skill, improve skill prompt |

### All Agents

| Agent | Role | Delegates To |
|-------|------|-------------|
| `planner` | Task breakdown, architecture | — |
| `implementer` | Write and edit code | — |
| `reviewer` | Code review, quality checks | — |
| `tester` | Write and run tests | — |
| `scaffolder` | Boilerplate generation | — |
| `explore` | Read-only codebase navigation | — |
| `oracle` | Expert Q&A, deep analysis | — |
| `security-reviewer` | OWASP, secrets, auth audit | — |
| `deslopper` | Dead code removal, cleanup | scanners (team mode) |
| `maestro` | Multi-agent orchestration | all of the above |

### Hooks (Automatic — 27 Events)

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
| Post-tool (TLDR) | Usage tracking |
| Post-tool (Bash) | Command audit log |
| Post-tool (all) | Consecutive non-Agent call counter (`parallelmax-nudge.ts`) |
| Tool failure | Failure tracking |
| Pre-compact | Auto-handoff save |
| Post-compact | After context compaction completes |
| Stop | Learning reminder; Haiku delegation judge (`parallelmax-judge.ts`) |
| Stop failure | Turn ends due to API error (rate limit, auth failure) |
| Session end | TLDR stats, auto-handoff |
| Subagent start/stop | Swarm logging |
| Teammate idle | Agent Teams teammate goes idle |
| Task completed | Task marked completed |
| Notification | Desktop notification |
| Instructions loaded | CLAUDE.md or rules loaded |
| Config change | Configuration file changes during session |
| Elicitation / result | MCP server requests structured user input |
| Worktree create/remove | Worktree lifecycle management |
