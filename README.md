# cc-settings

cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows,
safety checks, and proof gates. One installer makes a new machine behave like the rest of the team
without replacing personal configuration that cc-settings does not own.

The practical effect is simple: "fix this bug" gets a cause-first debugging workflow, "review my
changes" stays read-only, and "ship it" must prove the real build and tests before anything is
published.

## Five-minute first success

### 1. Install the product you plan to use

Install and authenticate [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started),
[Codex CLI](https://developers.openai.com/codex/cli/), or both. cc-settings configures those
products; it does not install a subscription or account.

### 2. Install cc-settings

**Any platform (Node 18+):**

```bash
npx darkroom-settings
```

Every installer flag works: `npx darkroom-settings --light --auto-update=on`. `bunx darkroom-settings` is
equivalent. The npm package is only a downloader — the configuration always installs from this
repository's pinned GitHub origin.

**macOS or Linux, without Node:**

```bash
curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash
```

Flags go after `-s --`. Every `setup.sh` flag works remotely — no clone or download needed:

```bash
curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash -s -- --light --auto-update=on
```

**Windows PowerShell:**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1 | iex"
```

To pass flags remotely on Windows, invoke the downloaded script as a script block:

```powershell
powershell -ExecutionPolicy Bypass -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.ps1))) --light"
```

The default target installs both products when `codex` is on `PATH`, and Claude Code only
otherwise. Clone the repository only when you want a source checkout you own:

```bash
git clone https://github.com/darkroomengineering/cc-settings.git
cd cc-settings
bash setup.sh --target=both --dry-run
bash setup.sh --target=both
```

Review all requirements, tiers, system changes, prompts, managed paths, and undo behavior in the
[installation reference](./docs/install.md).

### 3. Restart and inspect

Restart every selected product. In Codex full installs, open `/hooks` and review the installed
plugin hooks once. Claude users can inspect the installed user-scope configuration from any
directory:

```bash
bun ~/.claude/src/scripts/whats-on.ts
```

That report shows what is installed and shaping Claude user scope. It does not identify which skill
handled a previous prompt or fully resolve project overrides.

### 4. Run one harmless task

Open a repository and say:

```text
Explain where this project's configuration is loaded. Read only. Cite the files and lines.
```

Natural language works in both products. To pin the workflow, use `/explore` in Claude Code or
`$explore` in standalone Codex. The result should name its read-only scope, cite evidence, and leave
the working tree unchanged. [Your first session](./docs/first-session.md) shows the expected output,
background behavior, follow-up, and recovery.

## What cc-settings adds on top of a vanilla install

A fresh Claude Code or Codex install is a capable general assistant with no memory of how this
team works. cc-settings installs that memory, plus the checks that make "done" mean the same thing
on every machine. The same request behaves differently once it is installed:

| You say | Vanilla Claude Code or Codex | With cc-settings |
|---|---|---|
| "Fix this bug" | Edits the first plausible cause and reports done | Reproduces first, names the cause before the fix, keeps the change inside the bug's scope, runs the real tests afterwards |
| "Review my changes" | May start editing while it reviews | Stays read-only, checks the diff against the team checklist, reports by severity |
| "Ship it" | Pushes whatever is in the tree | Runs the repository's own type check, build, tests, and lint, opens the PR in the house style, watches CI |
| "Build a header component" | Writes a component its way | Uses the Darkroom starter conventions: CSS modules, no manual memoization, the accessibility and performance rules |
| `git push --force origin main` | Runs it | A permission rule denies it; a hook blocks `rm -rf` and other destructive commands before they execute |
| `bun drizzle-kit push` on a project with data | Runs it | A hook surfaces the team note that this command can truncate production tables |
| Working in a large repo | Reads files one at a time | Delegates to focused agents for exploration, implementation, testing, review, and security, on cheaper models |
| Something worth remembering for the team | Lost when the session ends | `/share-learning` posts it to the shared knowledge repo, and later sessions on every machine are reminded of it when it applies |

### The pieces

- **Standards.** [AGENTS.md](./AGENTS.md) holds the coding standards and guardrails every tool
  reads; Claude Code gets its copy as [CLAUDE.md](./CLAUDE.md). Twelve topic rules (TypeScript,
  React, performance, accessibility, security, git, motion, style) load only for the files they
  cover, and six stack profiles (Next.js, React Router, React Native, Tauri, WebGL, orchestration)
  add the specifics of each starter.
- **38 skills.** Named workflows selected from ordinary language or pinned with `/name` in Claude
  and `$name` in Codex: fix, build, review, ship, audit, lighthouse, qa, verify, handoff, and the
  rest. The [skill guide](./docs/skills.md) lists what each one changes and when it asks.
- **10 role agents.** Planner, explorer, implementer, tester, reviewer, security reviewer,
  scaffolder, deslopper, orchestrator, and a cross-model verifier. Big work is divided instead of
  held in one conversation, and each role runs on the model tier its job needs.
- **36 hooks on 18 lifecycle events.** Small programs that run around tool calls, commits, pushes,
  compaction, and session start or end. They block destructive commands, require proof before a
  PR, remind about docs before an install, nudge when unreviewed agent output piles up, and inject
  context the model would otherwise never see. Claude gets the full set; Codex gets the compatible
  plugin subset and asks you to review it once through `/hooks`.
- **Model routing.** Effort pinned to medium, subagents on Sonnet, planning and decisions on the
  session model, bulk or mechanical work and one cross-model review per PR or direct push routed to Codex when
  the bridge is installed. The statusline shows the usage limits that drive that routing.
- **Connected tools.** In Claude, four MCP servers: Context7 for current library docs, a TypeScript
  code map for call graphs and blast radius, Figma, and Chrome DevTools for screenshots and
  Lighthouse. Codex gets the Figma server only and reports a missing capability instead of faking
  the rest.
- **Verbatim compaction.** With a TypeSafe key, long sessions compact near the 200K working
  ceiling by removing stale tool output that Jev scores as no longer needed, while every user and
  assistant message stays word for word. Without a key, native summary compaction applies. See
  [verbatim compaction with Jev](./docs/hooks-reference.md#verbatim-compaction-with-jev).
- **Team knowledge.** A shared repository of decisions, conventions, and gotchas that every
  machine reads. Notes are posted with `/share-learning` and surface automatically before the
  command or file edit they apply to.
- **Ownership and rollback.** The installer records what it owns, keeps a backup per product,
  fingerprints its hooks, and can preview, roll back, or uninstall without touching your own
  configuration. Read [SECURITY.md](./SECURITY.md) if a session ever warns about hook trust.

### What it leaves alone

Your login and subscription, your permission mode, your personal memory, and any setting the
installer does not own. It does not grant GitHub, Figma, or browser access, and it does not make
the two products identical: see [Claude Code and Codex](./docs/claude-vs-codex.md) for what each
host can and cannot do.

## Choose where to read next

| Goal | Start here |
|---|---|
| Install safely and understand every side effect | [Installation](./docs/install.md) |
| Prove the setup with a harmless first task | [Your first session](./docs/first-session.md) |
| Choose a skill and understand what it can change | [Skill guide](./docs/skills.md) |
| Compare Claude Code and Codex behavior | [Host parity](./docs/claude-vs-codex.md) |
| Understand the whole system | [System overview](./docs/system-overview.md) |
| Diagnose an installed setup | [Troubleshooting](./docs/troubleshooting.md) |
| Browse every user, concept, maintainer, and history document | [Documentation index](./docs/README.md) |
| Work from a task-oriented reference | [Manual](./MANUAL.md) |
| Understand why advice becomes an enforced gate | [The flow](./docs/the-flow.md) |

## Why the team maintains it

Written standards, workflows, and proof gates reduce per-machine drift. They also make the codebase
more legible to humans: the conventions an agent needs are the same debt the team owes its
engineers.

[darkroom.engineering](https://darkroom.engineering) | MIT
