# cc-settings manual

> **Audience:** people doing daily work with Darkroom's Claude Code or Codex setup
> **Purpose:** choose the right workflow from the outcome you want
> **Status:** canonical task-oriented manual

You do not need to memorize commands. Describe the outcome and let the host choose. Pin a shared
skill as `/skill-name` in Claude Code or `$skill-name` in standalone Codex when you need an exact
workflow.

## Contents

- [Start here](#start-here)
- [Build and change code](#build-and-change-code)
- [Understand, plan, and decide](#understand-plan-and-decide)
- [Review, proof, and diagnosis](#review-proof-and-diagnosis)
- [Coordinate and preserve work](#coordinate-and-preserve-work)
- [Maintain cc-settings and team knowledge](#maintain-cc-settings-and-team-knowledge)
- [Automatic guardrails](#automatic-guardrails)
- [Inspect and troubleshoot](#inspect-and-troubleshoot)
- [Reference routes](#reference-routes)

New users should follow [installation](./docs/install.md) and then
[your first session](./docs/first-session.md). Maintainers should start from the
[documentation index](./docs/README.md#maintain-cc-settings).

## Start here

Open Claude Code or Codex in a project and say the outcome:

| You say | What happens |
|---|---|
| "fix the login redirect" | The `fix` workflow finds the cause, reproduces it, lands a narrow fix, and verifies it. |
| "add a dashboard with stats" | The `build` workflow checks feasibility, plans, implements, tests, and reviews. |
| "where does auth happen?" | The `explore` workflow maps the code read-only with file and line evidence. |
| "review my changes" | The cc-settings `review` workflow reads the current diff and returns findings. |
| "is this review-ready?" | `proof-of-work` runs the real type, test, lint, and relevant visual gates. |
| "poke holes in this" | `verify` asks independent agents to find, disprove, and judge issues. |
| "does this look right?" | `qa` captures and checks the rendered interface when a browser path is available. |
| "first pass on this client repo" | `triage` returns ranked findings and stays read-only on external repositories. |
| "audit the whole codebase" | `audit` performs a deep repository-wide review and reports evidence. |
| "save this for tomorrow" | `handoff` records the session so another session can continue it. |

Several of these workflows inspect code, but they answer different questions:

- `review` asks whether this diff introduced a problem.
- `proof-of-work` asks whether machine-verifiable gates pass.
- `verify` asks whether independent agents can disprove a specific claim.
- `qa` asks whether the rendered interface works visually and accessibly.
- `triage` asks what is visibly risky in an unfamiliar repository.
- `audit` asks what is wrong across a repository, system, or documented journey.

Claude skills that use a forked context normally work in the background and return through a task
notification. You can keep using the main conversation. Codex uses its native agent surfaces, so
the interface may differ even when the outcome contract is the same. See the
[host parity guide](./docs/claude-vs-codex.md).

Claude's native `/review` name can overlap with the cc-settings skill. Ask for "the cc-settings
local pre-commit review" or choose the cc-settings skill visibly when you need that exact workflow.

## Build and change code

### Fix a bug

Say: "fix the login redirect", "this is broken", or "debug this error".

`fix` uses a cause-first path: investigate, reproduce with a regression test, implement the
smallest related change, run the build, and review the result. It does not refactor adjacent code.

### Build a feature

Say: "build a user dashboard" or "add coupon validation".

`build` begins with a GO/NO-GO research gate. A viable feature moves through plan, scaffold,
implementation, test, and review. A missing product decision returns to you before the code chooses
for you.

### Create one known unit

- Say "create a Button component" for `component`.
- Say "create useAuth" for `hook`.
- Say "create or consolidate design tokens" for `design-tokens`.
- Say "start a Darkroom project" for `dr-init`, which asks you to choose satus or novus when the
  request does not already decide.

These workflows inspect `package.json` and visible imports. Profile files document stack intent;
there is no supported `settings.json` switch that activates a profile. See
[profiles](./docs/profiles.md).

### Refactor or simplify a patch

Use `refactor` for behavior-preserving restructuring outside the current diff. Use
`zero-tech-debt` when the current patch has accumulated compatibility layers, flags, or wrappers
that the intended end state no longer needs.

### Write tests

Say "add regression tests", "check coverage", or "TDD this". The `test` workflow writes and runs
tests. It never weakens, skips, or deletes a valid assertion to make a suite pass.

### Ship

Say "ship it", "create a PR", or "land this PR". The `ship` workflow runs type checking, build,
one configured full test suite, lint, relevant web checks, review, and then the requested GitHub
operation. A real test failure cannot fall through to a narrower runner.

Shipping changes remote state. The workflow respects host permission prompts and the repository's
publication policy. External or agency repositories remain report-only unless the user explicitly
owns that action under the team rules.

## Understand, plan, and decide

### Explore the codebase

Say "how does auth work?", "where is routing?", or "zoom out". `explore` stays read-only and
returns file locations, callers, and architecture with evidence.

Use `tldr` when the question is specifically about call graphs, imports, or blast radius. Claude
uses the installed TLDR MCP server. Standalone Codex falls back to `rg` and native code navigation.

### Plan a feature

Say "help define this feature" or "write a PRD". `plan-feature` interviews for missing decisions,
then produces the requirements and a dependency-aware plan.

### Generate, compare, or challenge ideas

- `adhd` widens the option space beyond the obvious answers.
- `oracle` gives bounded engineering advice, a premortem, or a weighted comparison.
- `strategist` connects product vision, positioning, and architecture.
- `plan-ceo-review` challenges whether an existing plan should be built at all.

These are recommendations. The user owns product direction.

### Align domain language

Say "create our glossary" or "record this decision as an ADR". `context-doc` interviews for the
real domain terms, then writes `CONTEXT.md` and architecture decision records.

## Review, proof, and diagnosis

### Review a diff

Say "review my changes". The cc-settings `review` skill returns only behavior or risk findings that
matter under the Darkroom review rules. Formatting and naming taste are not findings.

### Prove the work is green

Say "prove this is review-ready". `proof-of-work` runs the repository's actual commands and reports
their actual output. It does not fabricate a gate that could not run.

### Verify a claim adversarially

Say "double check this", "are you sure?", or "poke holes in this". `verify` gives separate agents
competing incentives: find an issue, disprove it, and judge the remaining evidence.

### Visual and performance checks

Use `qa` for screenshots, layout, accessibility, touch targets, and design fidelity. Use
`lighthouse` for a measured page-performance improvement loop. Claude's full profile supplies
Chrome DevTools MCP. Codex needs a configured browser path or must report that visual verification
is unavailable. Neither workflow may invent a screenshot or score.

### Triage an unfamiliar repository

`triage` inspects the current checkout and returns at most 15 ranked findings. On an external
repository it never checks out, pulls, fetches, commits, pushes, or opens a PR. Use `audit codebase`
when the first pass shows that depth is warranted.

### Audit a whole repository

`audit` has eight modes. It reads the repository and writes its full report under `docs/audits/`;
optional GitHub issue filing is a separate external-state action:

- **Codebase:** asks whether the code should exist and whether it does what it promises.
- **Docs:** checks current documentation against the implementation and human reading order.
- **Process:** walks documented journeys and maps the real state machine and dead ends.
- **Performance:** reports only measured findings and names the budget or leverage behind severity.
- **Threat model:** maps trust boundaries, attacker capabilities, abuse paths, and mitigations.
- **Motion:** reviews animation leverage, interruption, performance, and accessibility.
- **SEO:** reviews search and answer-engine discoverability.
- **Debt:** collects `SHORTCUT:` markers into a ledger, with missing upgrade triggers first.

The substantive modes use stable finding IDs, concrete failure scenarios, and a disproof pass.

## Coordinate and preserve work

### Orchestrate a broad task

Say "coordinate this", "split this across agents", or "this is a long-running task".
`orchestrate` builds a dependency graph, delegates independent work, serializes conflicting
writers, tracks progress, integrates, and verifies. The user's review bandwidth remains the limit;
more agents are not useful when the work cannot be reviewed coherently.

### Save a checkpoint or handoff

Use `checkpoint` for a reversible mid-task snapshot. Use `handoff` to transfer decisions, files,
failures, and next actions to another session. The canonical lifecycle is:

| Context use | Action |
|---|---|
| Below ~120K tokens | Work normally |
| ~120-150K | Save a checkpoint; compact or prepare a handoff |
| ~150-200K | Stop expanding scope and run `handoff` |
| 200K+ | Run `handoff` immediately — past 200K input every request bills at the long-context premium |

### Restrict edit scope

`freeze` enforces one edit directory in Claude Code. Standalone Codex cannot enforce the hook, so
file ownership there is only a convention and the skill reports that limitation.

### Review several agents at once

`review-batch` gathers real diffs and re-entry cards so several completed tasks can be reviewed in
one sitting without trusting prose-only summaries.

## Maintain cc-settings and team knowledge

### Update or synchronize cc-settings

Say "update cc-settings" for `cc` update mode. It validates the installed source, shows the change,
and refreshes the selected product. Maintainers can say "sync with Claude Code upstream" for the
separate repository-maintenance mode.

The installer's macOS auto-update option, schedule, trust boundary, disable command, and rollback
behavior live in [installation](./docs/install.md) and [security](./SECURITY.md).

### Create or improve a skill

Run `bun run new-skill <name>`, then follow [skill authoring](./docs/skill-authoring.md). Register the
new name in `ACTIVE_SKILLS` in `src/lib/managed-skills.ts`; `MANAGED_SKILLS` is a derived wipe set,
not the authoring registry.

Use `harvest` to turn measured, repeated behavior into a reviewed artifact. Use `autoresearch` to
optimize a skill prompt through a controlled Claude loop. `autoresearch` is unsupported in
standalone Codex until that host has an equivalent measured harness.

### Consolidate configuration

Say "clean up redundant rules and skills". `consolidate` finds contradictions, duplication, dead
instructions, and context bloat. Installed caches are diagnostic copies, not source files to edit.

### Share a team learning

Say "share this gotcha with the team". `share-learning` checks for a duplicate, shows the proposed
note, asks before posting, and returns the GitHub link. It requires the `gh` CLI, authenticated
access, and permission to read and write the team-knowledge repository. Personal preferences and
local project state stay in local memory. See [knowledge](./docs/knowledge-system.md).

## Automatic guardrails

No skill name is required for these behaviors:

- Stop after two failed attempts and offer a different approach.
- Keep bug fixes inside the direct blast radius.
- Name a specific cause before committing a fix.
- Treat a failing assertion as a regression unless a new requirement explicitly changes it.
- Verify each fix before stacking another one.
- Re-read the plan, active files, and diff after compaction.
- Keep external repositories read-only unless the team policy authorizes action.
- Never fabricate builds, tests, screenshots, performance numbers, or savings.
- Keep AI fingerprints out of commits and public text.

Claude implements many of these through lifecycle hooks, which run around session and tool events.
Codex installs the compatible plugin subset. See [hooks](./docs/hooks-reference.md) for the canonical
event list.

## Inspect and troubleshoot

Claude users can inspect installed user-scope behavior from any directory:

```bash
bun ~/.claude/src/scripts/whats-on.ts
```

This reports what is installed and shaping Claude user scope. It is not an invocation history and
does not fully resolve project or managed-policy overrides. Codex has no exact equivalent; use
`/status` for native session state and `/hooks` for plugin-hook trust.

For install health, run `bash setup.sh --target=<target> --status` from a checkout, or
`npx darkroom-settings --status` from anywhere. For hook-integrity
warnings, run `bun ~/.claude/src/scripts/audit-hooks.ts`. Follow
[troubleshooting](./docs/troubleshooting.md) before refreshing trust or rolling back.

## Reference routes

- [All 38 skills, effects, approvals, output, prerequisites, and host behavior](./docs/skills.md)
- [Installation flags, tiers, paths, side effects, rollback, and uninstall](./docs/install.md)
- [Claude Code and Codex parity](./docs/claude-vs-codex.md)
- [Models, effort, advisor, and quota policy](./docs/agent-models.md)
- [Settings and merge behavior](./docs/settings-reference.md)
- [Skill authoring](./docs/skill-authoring.md)
- [Complete documentation index](./docs/README.md)
- [Release history](./CHANGELOG.md)
