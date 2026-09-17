# Darkroom Engineering

> Portable coding standards for Claude Code, Codex, Cursor, Copilot, Windsurf, and other AGENTS.md-aware tools.

## Philosophy

Make the codebase legible to agents and humans through written conventions, rules, and intent.

## Getting Started

1. Read this file.
2. Delegate when the host's rules require it; thresholds live in each host's instructions.
3. Start simple and add complexity only when needed.

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

A deliberate simplification with a known ceiling gets a `SHORTCUT:` comment naming the ceiling and the upgrade trigger (`// SHORTCUT: one global lock. ceiling: ~50 rps. upgrade: shard by key when p99 write latency climbs`). `bun run lint:shortcuts` fails when `upgrade:` is missing. Use this only for knowingly cut corners; it cannot excuse the protected concerns above. `/audit debt` lists every marker. When a trigger fires, implement the upgrade and remove the marker in the same diff.

### Read Before Edit

**Never change code you have not read in this session.** Read the file, trace callers, and understand the context before editing.

### 2-Iteration Limit

After **2 failed attempts** with one approach, stop using it. Summarize the attempts, pick the best of **2-3 alternatives**, and continue, saying so; ask only when the choice changes the user's stated direction or is hard to reverse. Never spend 6+ attempts on one strategy.

### Stop-Loss on Environment Blockers

The 2-iteration limit does not fire on an OS, device, vendor, or network blocker, because every attempt is a new approach. Cap that investigation at about 20 minutes or 30 tool calls, then write a diagnosis instead of the next attempt: what was ruled out with evidence, the most likely cause, and 2 to 3 next options ranked by effort, including the one that needs the user's hands or a vendor.

### Bug Fix Scope

Keep a bug fix confined to directly related files. Do not refactor adjacent code, upgrade dependencies, or touch outside the immediate blast radius. The PR should be reviewable in under 2 minutes.

### Completeness Is Cheap

Once the ladder says a bounded unit should exist, finish its edge cases, error paths, and tests when that costs only minutes more; do not ship 90% and defer the rest. Complete the unit without expanding scope (`Bug Fix Scope` and `Surface Conflicts` still apply). Commit tests only where the task asks or the repository already keeps tests for that kind of change, sized like the neighbors; scratch checks stay scratch.

### Verify After Every Fix

The repository's local checks (typecheck, tests, lint, build) are safe to run without asking. Prove each fix passes them before stacking the next one.

### Pre-Commit Verification

**Never commit code that does not typecheck, build, and pass tests.** Run all three and fix failures first.

### Failing Tests: Regression vs. Contract Change

Classify every post-change test failure before editing a test:

- **Regression:** the assertion remains correct. Fix the code; never relax, weaken, or delete the assertion.
- **Intentional contract change:** the requirement explicitly supersedes the assertion. Update implementation and assertion in the same diff, and report the changed contract and reason.

If uncertain, treat it as a regression and stop to confirm. Making the suite green alone never justifies editing an assertion.

### Never Fake Measurements

NEVER fabricate Lighthouse, bundle-size, profiler, test-runner, or build output. If a tool cannot run, say so. Report a delta only when both baselines were measured; otherwise report countable facts. Label extrapolations `est.` and name their source.

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

Typechecks and tests prove code, not the feature. Surface uncertainty.

### Surface Conflicts, Don't Average

When existing patterns conflict, choose one, usually the newer or better-tested pattern, and flag the other for follow-up. Never bridge both patterns; that doubles behavior and hides bugs.

### Post-Compaction Recovery

After compaction or a context reset, re-read the task plan and every actively modified file and run `git diff --stat` before resuming. Never rely on remembered file contents or task state after context loss.

### Neutral Exploration

Use neutral investigation prompts: ask to analyze logic, review a flow, or trace data and report all findings. Do not presuppose a bug or leak; biased prompts manufacture issues.

### TODO Comments Are Instructions

Implement `TODO`, `FIXME`, and `HACK` comments; never delete them without doing the work. `SHORTCUT:` is the exception governed by the ladder: leave it until its `upgrade:` trigger fires, then upgrade and delete it together.

### Clarify Before Full Work Mode

A non-trivial task opens with one interactive round of clarifying questions, then the work starts. Non-trivial means the delegation bar (3+ files, 12+ tool calls, security-sensitive code) or a request whose readings lead to materially different work, including which repository, host, or branch it targets. At most 4 questions, each with 2 to 4 concrete options and the recommended one first, asked through the host's interactive question tool, never as a prose list. One round, then proceed; a second only when an answer opens a new fork. A lookup, a one-file fix, or a request that already names the files and the change skips it. Read before asking: ask only what the user alone knows.

### Plan Before Multi-File Changes

When a wrong approach would require a full rollback, state the plan (files touched and risks), then proceed without waiting for approval on reversible in-scope work. Numeric delegation thresholds live in each host's instructions, such as Claude Code's `CLAUDE-FULL.md`.

### Every Plan Opens With a Functional DAG

Every markdown plan (plan files, PRDs, ADRs, issue breakdowns, orchestration briefs, stated multi-file plans) MUST start with `## Functional DAG`: a fenced recipe table with inputs on the left, operations merging rightward, parallelism visible by columns, and one terminal verification node. See `docs/functional-dag.md` for authoring rules and the Mermaid escape hatch. Reviews, audits, retros, and handoffs are not plans.

### Dependency Upgrades

Check breaking changes before every major dependency upgrade. If the build breaks, rollback immediately, research the migration, then retry with a plan.

### Autonomous Execution

Proceed without asking for non-destructive reading, searching, exploration, read-only git commands, documentation fetching, and research. Confirm destructive or irreversible actions only.

### Shell Commands

Quote every glob and path argument. Use absolute paths instead of `cd` chains; a wrong relative `cd` fails the whole command. Put each destructive step (delete, force, reset, drop) in its own command so a failure or a denial stops exactly one thing, and so the harness can judge it on its own.

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

`bun add`, `bun run`, `bunx`, `bunx tsc --noEmit`; never `npm`, `pnpm`, `yarn`, or `npx`. The one exception is `npx expo ...`, Expo's official invocation. Switching package managers mid-session causes lockfile drift.

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
- Native iOS/macOS animation: springs, built-in animatable modifiers, no timer-driven motion; full bar in `rules/swift-animation.md`.

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

### History Belongs in Git, Not in Code

Code and docs read as if the current state is the only one that ever existed. Remove, don't annotate: text describing what changed ("replaces X", "no longer", "previously", "renamed from", "current violations: 0") gets deleted or reworded to present tense, and the repo swept for the same pattern in one pass. Delete artifact files (a "Fixed Violations" ledger, a "moved to X" tombstone) and whatever enforced them. Keep "why" comments that prevent a bad future edit, minus the historical framing. History lives in `CHANGELOG.md`.

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

## Context Hygiene

### Tool Output Offloading

When output exceeds ~2000 tokens, write it to a scratch file and return a count, top findings, and path rather than carrying the full output in context.

### Information Placement

Put critical information at the beginning and end of prompts and structured output; the middle receives less attention.

### Cache Discipline

Prompt caches need an exact prefix match. Keep stable content before volatile content; during a task do not switch models, edit pinned CLAUDE.md/AGENTS.md/skill prompts, or reorder tool definitions. Compaction costs one miss but beats stale context.

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
| Team decision, convention, library gotcha, incident postmortem | team-knowledge repo via `/share-learning` |

If another team member's agent benefits, use the team-knowledge repo; otherwise use auto-memory. Matching notes surface before Bash and Edit calls; `docs/knowledge-system.md` has the read and post commands.

## Self-Evolving Learnings (agent convention)

After a session with a non-obvious bug, pattern, or edge case, append one line, `- [YYYY-MM-DD] <category>: <learning>`, to `~/.claude/agent-memory/<agent-name>/MEMORY.md`; its first 200 lines auto-load next time.

