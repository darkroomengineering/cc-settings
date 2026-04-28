# cc-settings Manual

> Everything you can do with Darkroom's Claude Code setup.
> You don't need to memorize this — just describe what you want and Claude will invoke the right skill.

## Quick Start

```bash
# Install (one command)
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)

# Update
cd ~/.claude/cc-settings && git pull && bash setup.sh

# Interactive update — prompt on each settings conflict
bash setup.sh --interactive
```

After install, start Claude Code in any project. The setup loads automatically.

**Re-installs are non-destructive.** Your hand-added permission rules, custom hooks, local env overrides (`ENABLE_PROMPT_CACHING_1H`, etc.), and custom MCP servers are preserved across updates. See [docs/settings-reference.md#re-install-merge-behavior](./docs/settings-reference.md#re-install-merge-behavior) for the merge policy and what `--interactive` controls.

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

Triggers `/f-thread` — spawns parallel oracle agents, builds weighted scoring matrix, outputs ADR.

### Write a PRD

Say: *"write a PRD for the notification system"*

Triggers `/prd` — clarifying questions → scope → user stories → task breakdown → execution plan.

### Get Expert Advice

Say: *"what should I use for state management?"* or *"advice on caching strategy"*

Triggers `/ask` — delegates to the oracle agent for evidence-based guidance.

### Discover Requirements

Say: *"help me figure out what we need"*

Triggers `/discovery` — structured interview to turn vague ideas into clear requirements.

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

### Security Review

Say: *"security review"* or *"check for vulnerabilities"*

Delegates to the `security-reviewer` agent — OWASP checks, secret scanning, auth audit.

### Visual QA

Say: *"QA check the homepage"* or *"does this look right?"*

Triggers `/qa` — screenshot + accessibility snapshot + structured visual review (layout, typography, contrast, hierarchy, a11y).

### Compare to Figma

Say: *"compare to the figma design"* or *"design fidelity check"*

Triggers `/figma` — connects to Figma desktop, screenshots the design, compares against implementation.

### Performance Audit

Say: *"run a lighthouse audit"* or *"check page speed"* or *"improve web vitals"*

Triggers `/lighthouse` — runs Lighthouse audits (3 mobile + 3 desktop, averaged), optimizes scores, and visually verifies UI isn't broken after each change.

### Debug in Browser

Say: *"take a screenshot"* or *"what does the page look like?"*

Triggers `/debug` — pinchtab browser automation for visual debugging.

---

## Session Management

### Context Window

Say: *"how's my context?"* or *"context usage"*

Triggers `/context`. Watch the statusline:

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

Triggers `/init` — clones Satus starter template with full Darkroom stack.

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

### Consolidate Rules & Skills

Say: *"clean up our rules"* or *"consolidate"* or *"spa day"*

Triggers `/consolidate` — audits rules, skills, and learnings for contradictions, overlap, and bloat. Merges and prunes.

### Store a Learning

Say: *"remember this"* or happens automatically after non-obvious fixes.

Triggers `/learn` — stores learnings that persist across sessions. Supports `--shared` for team knowledge via GitHub Projects.

### Fetch Docs & Check Versions

Say: *"how do I use GSAP ScrollTrigger?"* or *"what's the latest version of gsap?"* — triggered automatically before implementing with or installing a library.

Triggers `/docs` — fetches current documentation via Context7 MCP and surfaces latest version info. Never codes from memory. The `PreToolUse` install hook (`check-docs-before-install.ts`) also nudges you to fetch docs before `bun add` / `npm install`.

### Optimize a Skill

Say: *"autoresearch the build skill"* or *"optimize skill prompt"*

Triggers `/autoresearch` — autonomous skill optimization loop. Mutates a SKILL.md, tests it, keeps improvements, reverts failures. Runs until interrupted.

---

## Advanced

### Long-Running Tasks

Say: *"this is going to be a long task"* or *"overnight refactor"*

Triggers `/l-thread` — phased execution with automatic checkpoints, verification stack, and recovery from interruption.

### Parallel Agent Teams

Say: *"use teams"* or *"split this across parallel agents"*

Triggers `/teams` — coordinates multiple independent Claude Code instances for true parallelism. Use when 3+ independent workstreams.

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
| `nextjs` | Next.js web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps |
| `webgl` | 3D web (R3F, Three.js, GSAP) |

### GitHub Project Sync

Say: *"what am I working on?"* or *"update the issue"*

Triggers `/project` — reads/updates linked GitHub Issues. Auto-detects from branch name (e.g., `feat/123-description`).

### TLDR Code Analysis

Say: *"who calls this function?"* or *"find the auth implementation"*

Triggers `/tldr` — token-efficient codebase analysis. 95% fewer tokens than reading files. Semantic search, impact analysis, call graphs, dead code detection.

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
| `explore` | how does, where is, find, understand |
| `docs` | how to use X, X docs, X API |
| `ask` | advice, guidance, what should I |
| `discovery` | requirements, scope, figure out |
| `prd` | PRD, requirements document, product spec |
| `premortem` | risks, what could go wrong |
| `f-thread` | compare approaches, architecture decision |
| `l-thread` | overnight, long running, autonomous task |
| `orchestrate` | complex task, coordinate |
| `teams` | parallel agents, split work, fan out |
| `project` | project status, update the issue |
| `tldr` | who calls, dependencies, semantic search |
| `component` | create component, new component |
| `hook` | create hook, custom hook |
| `init` | new project, initialize, setup |
| `design-tokens` | type scale, color palette, spacing system |
| `lenis` | smooth scroll, lenis |
| `debug` | screenshot, visual bug |
| `figma` | compare to design, figma |
| `qa` | visual check, accessibility, validate |
| `lighthouse` | lighthouse, performance audit, page speed, web vitals |
| `context` | context window, running out of context |
| `checkpoint` | save state, save progress |
| `create-handoff` | done for today, ending session |
| `resume-handoff` | resume, continue, last session |
| `learn` | remember this, store learning (also auto-triggers) |
| `consolidate` | clean up rules, contradictions, spa day |
| `cc-sync` | sync with claude code, changelog sync, upstream sync |
| `audit` | audit, run audit script |
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

### Hooks (Automatic — 26 Events)

Hook types: `command` (shell), `prompt` (LLM yes/no), `agent` (subagent with tools), `http` (webhook to URL).

| Event | What Happens |
|-------|-------------|
| Session start | Load learnings, check TLDR index |
| Setup | Runs on `--init`, `--init-only`, or `--maintenance` CLI flags |
| User prompt | Skill activation, correction detection |
| Pre-tool (Bash) | Safety net, pre-commit TSC, docs check before install |
| Pre-tool (Edit) | Stale file detection |
| Permission request | When a tool needs user permission |
| Post-tool (Write/Edit) | Post-edit validation, async TSC |
| Post-tool (TLDR) | Usage tracking |
| Post-tool (Bash) | Command audit log |
| Tool failure | Failure tracking |
| Pre-compact | Auto-handoff save |
| Post-compact | After context compaction completes |
| Stop | Learning reminder, compact reminder |
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
