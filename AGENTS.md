# Darkroom Engineering

> Portable coding standards for Claude Code, Codex, Cursor, Copilot, Windsurf, and other AGENTS.md-compatible tools.

## Philosophy

Make the codebase legible to agents and humans through written conventions, rules, and intent.

## Getting Started

1. Read this file.
2. Read files, search code, and run builds directly.
3. Delegate when the host's rules require it. Claude Code's thresholds live in `CLAUDE-FULL.md`; multi-file exploration, security-sensitive code, and test writing MUST be delegated there.
4. Start simple and add complexity only when needed.

## Response Calibration

Match length to the request. Lead with the answer. A lookup gets a sentence and `file:line`; a multi-file change gets a brief plan and landing summary. Skip preambles and duplicate recaps.

### Register

Optimize for first-read comprehension, not brevity:

- Put the subject first; move modifiers into a clause instead of stacking them.
- Prefer active voice and direct verbs. Name the actor when it matters.
- Keep one subject or decision per sentence when combining claims creates ambiguity.
- Use an existing name for an existing thing; never coin or capitalize a replacement concept.
- Use identifiers when pointing at code, plain names when describing behavior.
- Define jargon inline on first use.
- State the effect before the mechanism. Never clip sentences or remove substance to be shorter.

This is the portable copy for AGENTS.md-aware tools and humans. Claude Code does not auto-load it: its subagents inherit the CLAUDE.md hierarchy, and its main sessions receive the same register from the `Darkroom` output style. Keep those delivery mechanisms distinct.

## Guardrails

These rules are non-negotiable.

### Laziness Ladder (Before Writing Code)

Stop at the first rung that holds:

1. Does this need to exist? If not, skip it (YAGNI).
2. Does this codebase already do it? Reuse or extend it.
3. Does the standard library/runtime do it? Use it.
4. Does the native platform do it? Use it.
5. Does an installed dependency do it? Use it; add nothing.
6. Can it be one line? Make it one line.
7. Only then, write the minimum that works.

Default to deletion over addition, boring over clever, and the fewest files. Add no unrequested abstractions, dependencies, or boilerplate. Between equal-size stdlib choices, pick the edge-case-correct one.

The ladder never reduces trust-boundary/input validation, data-loss-preventing error handling, security, accessibility, explicit requirements, or real-world physical constraints.

A deliberate simplification with a known ceiling gets a `SHORTCUT:` comment containing both the ceiling and the trigger for upgrading it:

```ts
// SHORTCUT: single global lock, not per-key.
// ceiling: contention above ~50 rps
// upgrade: shard by key hash when p99 write latency climbs
```

`bun run lint:shortcuts` fails when `upgrade:` is missing. Use this only for knowingly cut corners; it cannot excuse the protected concerns above. `/audit debt` lists every marker. Leave a marker alone until its trigger fires; then implement the upgrade and remove it in the same diff.

### Read Before Edit

**Never change code you have not read in this session.** Read the file, trace callers, and understand the context before editing.

### 2-Iteration Limit

After **2 failed attempts** with one approach, STOP. Summarize the attempts and failures, present **2-3 alternatives** with trade-offs, and ask which direction to take. Never spend 6+ attempts on one strategy.

### Bug Fix Scope

Keep a bug fix confined to directly related files. Do not refactor adjacent code, upgrade dependencies, or touch outside the immediate blast radius. The PR should be reviewable in under 2 minutes.

### Completeness Is Cheap

After the ladder establishes that a bounded unit should exist, finish every edge case, error path, and test when completion costs only minutes more. Do not ship 90% and defer the rest. Complete the unit you chose, but do not expand scope: this rule does not override `Bug Fix Scope` or `Surface Conflicts`.

### Verify After Every Fix

Run the build after each fix and prove it passes before moving on. Never stack untested fixes.

### Pre-Commit Verification

**Never commit code that does not typecheck, build, and pass tests.** Run all three and fix failures first.

### Failing Tests: Regression vs. Contract Change

Classify every post-change test failure before editing a test:

- **Regression:** the assertion remains correct. Fix the code; never relax, weaken, or delete the assertion.
- **Intentional contract change:** the requirement explicitly supersedes the assertion. Update implementation and assertion in the same diff, and report the changed contract and reason.

If uncertain, treat it as a regression and stop to confirm. Making the suite green alone never justifies editing an assertion.

### Never Fake Measurements

NEVER fabricate Lighthouse, bundle-size, profiler, test-runner, or build output. If a tool cannot run, say so. Report a delta only when both baselines were measured. Otherwise report countable facts. Label helpful extrapolations `est.` and name their source.

### Visual/Spatial Honesty

For sub-pixel rendering, WebGL, physics, complex animation, or canvas, state limitations, provide best effort with clear TODOs, and request visual validation. After 2 failed attempts at a CSS/visual fix, offer **3 fundamentally different approaches** and let the user choose.

### Name the Cause

Before committing a fix, name its specific cause in one sentence. If the explanation needs "I think" or "maybe," gather more evidence, such as screenshots or computed styles, before editing.

### Fail Loud

Never say "done" without explicitly reporting:

- skipped or `.only` tests, or relaxed assertions;
- skipped/failed migration, batch, or script records;
- features not exercised end-to-end, including UI without browser verification;
- claims that depend on a tool or service you did not run.

Typechecks and tests prove code correctness, not complete feature correctness. Surface uncertainty.

### Surface Conflicts, Don't Average

When existing patterns conflict, choose one, usually the newer or better-tested pattern, and flag the other for follow-up. Never bridge both patterns; that doubles behavior and hides bugs.

### Post-Compaction Recovery

After compaction or context reset, before continuing:

1. Re-read the task plan.
2. Re-read every actively modified file.
3. Run `git diff --stat`.
4. Only then resume implementation.

Never rely on remembered file contents or task state after context loss.

### Neutral Exploration

Use neutral investigation prompts: ask to analyze logic, review a flow, or trace data and report all findings. Do not presuppose a bug or leak; biased prompts manufacture issues.

### TODO Comments Are Instructions

Implement `TODO`, `FIXME`, and `HACK` comments; never delete them without doing the work. `SHORTCUT:` is the exception governed by the ladder: leave it until its `upgrade:` trigger fires, then upgrade and delete it together.

### Plan Before Multi-File Changes

When a wrong approach would require a full rollback, state the plan before execution: files touched and risks. Do not request approval for reversible in-scope work. Host-specific numeric delegation thresholds remain in that host's instructions, such as Claude Code's `CLAUDE-FULL.md`.

### Every Plan Opens With a Functional DAG

Every markdown plan, including plan files, PRDs, ADRs, issue breakdowns, orchestration briefs, and stated multi-file plans, MUST start with `## Functional DAG`. Use the fenced recipe-table form: inputs on the left, operations merging rightward, parallelism visible by columns, and one terminal verification node. See `docs/functional-dag.md` for authoring rules and the Mermaid escape hatch. Reviews, audits, retros, and handoffs are not plans.

### Dependency Upgrades

Check breaking changes before every major dependency upgrade. If the build breaks, rollback immediately, research the migration, then retry with a plan.

### Autonomous Execution

Proceed without asking for non-destructive reading, searching, architecture exploration, read-only git commands, documentation fetching, and research. Confirm destructive or irreversible actions only.

### Recommend, Don't Override

The user decides changes to their stated direction. Recommend the change, explain why and what context may be missing, then ask. Agreement between agents is evidence, never permission.

### Bug Reports

Fix reported bugs immediately without asking whether to proceed. If the work goes sideways, stop and re-plan instead of pushing ahead.

## Tech Stack

These defaults apply to Darkroom web clients. Tooling and non-web repositories, including this one, inherit only Bun, Biome, and TypeScript unless their profiles say otherwise. Framework details live in `profiles/`.

### Core

- **TypeScript:** strict mode; no `any`.
- **Next.js 16+:** App Router only.
- **React 19+:** Server Components by default; Client Components only when needed.
- **Tailwind CSS v4:** use CSS Modules for complex components.
- **Bun:** package manager and runtime.

### Quality

- **Biome:** linting and formatting, not ESLint/Prettier.
- **React Compiler:** no manual `useMemo`, `useCallback`, or `memo`.

### Animation & Graphics

- **Lenis:** smooth scroll.
- **GSAP:** complex animations.
- **Tempus:** RAF management.
- **Hamo:** performance hooks.

Always check the latest version before installing: `bun info <package>`.

### Package Manager: Bun Only

Darkroom projects are Bun-first. Never mix package managers within a session.

- Install: `bun add <pkg>`; never `npm install`, `pnpm add`, or `yarn add`.
- Run scripts: `bun run <script>`; never `npm run`.
- Execute binaries: `bunx <bin>`; never `npx`.
- Typecheck: `bunx tsc --noEmit`; never `npx tsc`.

**Exception:** `npx expo ...` is allowed only as Expo's official React Native invocation. Elsewhere use `bunx`. Never begin with Bun and silently switch to `npx`; it causes lockfile drift.

## Coding Standards

### TypeScript

- No `any`; use `unknown` and narrow it.
- Prefer `interface` over `type` for objects.
- Use discriminated unions for state.

### React

- Prefer Server Components; add `'use client'` only when needed.
- With React Compiler, do NOT use `useMemo`, `useCallback`, or `React.memo`.
- Use `useRef` for object instantiation to prevent infinite loops.

### Performance

- Eliminate waterfalls with `Promise.all` for independent fetches.
- Avoid barrel imports; import directly.
- Dynamically import heavy components.
- Use `React.cache()` for server-side deduplication.

### Accessibility

- Images require `alt` text.
- Icon-only buttons require `aria-label`.
- Inputs require `<label>` or `aria-label`.
- Use semantic elements, never `<div onClick>`.
- Touch targets: minimum 44x44px.
- Color contrast: minimum 4.5:1.

### UI

- Use `h-dvh`, not `h-screen`.
- Never block paste in inputs.
- Animate only compositor properties: `transform` and `opacity`.
- Interaction feedback: maximum 200ms.
- Honor `prefers-reduced-motion`.

## Git

- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Keep commits small and atomic.
- Never force-push `main` or `master`.

### Stealth Mode (Mandatory)

Git history, PRs, and descriptions MUST contain no AI fingerprints:

- No `Co-Authored-By` naming Claude, Anthropic, or any AI.
- No "Generated with Claude Code" or equivalent.
- No robot emoji, "AI-assisted," or "automated by" language.
- No AI badges in PR descriptions; see `rules/git.md` for the PR template.
- Commit messages contain only the conventional message.

## Code Review Rules

AGENTS.md-aware reviewers use this scope. Report only behavior or risk; skip formatting, import order, naming taste, comment density, and anything Biome catches.

**P0 — block the merge:**

- Secrets or credentials in the diff, including `.env` values, keys, and tokens.
- Injection: unparameterized SQL, user content passed to `dangerouslySetInnerHTML`, or open redirects.
- Unvalidated trust-boundary input in API routes, webhooks, or form handlers.
- Data-loss paths: unhandled write/migration errors or destructive operations without a guard.
- Type-safety escapes hiding runtime failure: `any`, careless `as`, or `@ts-ignore`.
- Test assertions relaxed, skipped, or deleted merely to pass.

**P1 — fix before merge:**

- Request waterfalls from sequential independent awaits, or heavy-library barrel imports.
- Accessibility misses in touched UI: missing `alt`, `aria-label`, labels, `<div onClick>`, or sub-44x44px targets.
- Manual `useMemo`, `useCallback`, or `React.memo` in React Compiler projects.
- New dependencies when stdlib, platform, or an installed dependency suffices.
- Scope creep in a bug-fix diff.

## External Libraries

Search before building: use stdlib, then platform, then installed dependencies before adding one. Before using any external library:

1. Fetch current documentation; do not rely on remembered APIs.
2. Check the latest version with `bun info <package>`.
3. For new projects, use `bunx degit darkroomengineering/satus my-project`.

## Context Hygiene

### Tool Output Offloading

When output exceeds ~2000 tokens, write it to a scratch file and return a count, top findings, and path rather than carrying the full output in context.

### Information Placement

Put critical information at the beginning and end of prompts and structured output; the middle receives less attention.

### Cache Discipline

Anthropic caches require exact prefix matches and expire after 5 minutes. Keep stable content before volatile content. Do not switch models, edit pinned CLAUDE.md/AGENTS.md/skill prompts, or reorder tool definitions during a task; append tools instead. A necessary pinned edit makes the next 1-2 turns miss. Cluster work before the TTL. Compaction causes one miss but is preferable to stale context.

## Safety

- Never commit secrets or `.env` files.
- Put API keys in environment variables.
- Seek approval only for destructive or irreversible changes.

## Knowledge Routing

Route knowledge explicitly:

| Situation | Destination |
|---|---|
| Personal workflow preference | auto-memory: `user` or `feedback` |
| Active project state, deadline, blocker | auto-memory: `project` |
| External-system pointer or URL | auto-memory: `reference` |
| Team architecture decision | team-knowledge repo via `/share-learning` |
| Team-wide library gotcha | team-knowledge repo via `/share-learning` |
| Team convention | team-knowledge repo via `/share-learning` |
| Team-relevant incident postmortem | team-knowledge repo via `/share-learning` |

If another team member's agent benefits, use the team-knowledge repo; otherwise use auto-memory. See `docs/knowledge-system.md` for reading, searching, and posting commands.

```bash
cat $KNOWLEDGE_REPO_PATH/INDEX.md
rg "smooth-scroll" $KNOWLEDGE_REPO_PATH/
/share-learning decision "Lenis over native smooth-scroll for cross-browser consistency"
/share-learning convention "All API routes return { data, error } — never throw to the caller"
/share-learning gotcha "Sanity API returns UTC dates — always convert to local before display"
```

## Self-Evolving Learnings (agent convention)

After a session with a non-obvious bug, useful pattern, or edge case, append a terse entry to `~/.claude/agent-memory/<agent-name>/MEMORY.md`; its first 200 lines auto-load next time:

```text
- [YYYY-MM-DD] <category>: <one-line learning>
```

Categories vary per agent.

## Knowledge System

The two tiers are:

- **Shared (Team):** the `darkroomengineering/team-knowledge` repo for architecture decisions, conventions, cross-cutting gotchas, and incident knowledge. Access it through a local clone or `gh api`.
- **Local (Personal):** auto-memory and local config for preferences, personal learnings, and session context.

See `docs/knowledge-system.md`.
