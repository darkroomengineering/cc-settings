# cc-settings

cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows,
safety checks, and proof gates. One installer makes a new machine behave like the rest of the team
without replacing personal configuration that cc-settings does not own.

The practical effect is simple: "fix this bug" gets a cause-first debugging workflow, "review my
changes" stays read-only, and "ship it" must prove the real build and tests before anything is
published.

**New here?** Install it (5 minutes), run one read-only task, then learn the
[daily loop](#the-daily-loop). That is enough to get most of the value. Everything after that
section is reference you can come back to.

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
equivalent. The npm package is only a downloader; the configuration always installs from this
repository's pinned GitHub origin.

**macOS or Linux, without Node:**

```bash
curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash
```

Flags go after `-s --`. Every `setup.sh` flag works remotely, with no clone or download needed:

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
otherwise. `--light` installs a minimal beginner tier; re-run without it to get the full setup.
Clone the repository only when you want a source checkout you own:

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

The result should name its read-only scope, cite evidence, and leave the working tree unchanged.
[Your first session](./docs/first-session.md) shows the expected output, background behavior,
follow-up, and recovery.

## The daily loop

You do not need to memorize commands. Describe the outcome in plain language and cc-settings picks
the matching workflow (a "skill"). Type the skill name only when you want to force a specific one:
`/name` in Claude Code, `$name` in Codex.

Most days are some path through these steps:

| Step | Say something like | Or pin | What you get back |
|---|---|---|---|
| Understand | "how does checkout work here?" | `/explore` | A read-only map with file and line citations |
| Plan | "help me figure out the scope for search" | `/plan-feature` | Interview questions, then a PRD you can hand off |
| Fix | "the login redirect loops on Safari" | `/fix` | The named cause, a reproduction, the smallest fix, and the tests that prove it |
| Build | "add a stats dashboard to the admin page" | `/build` | A GO/NO-GO check, a plan, the implementation, tests, and a review |
| Check | "review my changes" | `/review` | Findings on the current diff by severity, with no edits |
| Prove | "is this review-ready?" | `/proof-of-work` | The project's real typecheck, tests, lint, and a screenshot for UI work |
| Ship | "ship it" | `/ship` | A pushed branch, a PR in the house format, and CI watched until it settles |
| Pause | "done for today" | `/handoff` | Saved state; "continue where we left off" resumes it in a new session |

Claude Code also has a built-in `/review`. When you want the cc-settings one, say "run the
cc-settings local pre-commit review" or pick it from the skill picker.

Big tasks split themselves. Work that spans several files, a long chain of tool calls, or
security-sensitive code gets handed to focused agents (explore, implement, test, review, security)
that run in the background and report back. You can keep talking in the main conversation while
they work.

Every workflow for every situation, including audits, visual QA, Lighthouse, triage of a client
repo, and adversarial verification, is in the [manual](./MANUAL.md). The
[skill guide](./docs/skills.md) says what each one can change and when it stops to ask.

## Set up the projects you work in

cc-settings brings the team standards to every repository. Each project can add its own
instructions on top.

- **Starting a new Darkroom project:** say "new darkroom project" or run `/dr-init`. It creates the
  project from the satus or novus starter. The native `/init` is a different command that only
  writes a `CLAUDE.md`.
- **Giving a project its own instructions:** put them in `AGENTS.md` at the project root. Claude
  Code and Codex both read it. Good content is what an agent cannot learn from the code: the
  commands to run, the environments, the traps, and the decisions that look wrong but are
  deliberate.
- **Existing project with a `CLAUDE.md`:** say "migrate to agents.md" or run `/cc migrate`. Claude
  Code ignores `AGENTS.md` while a `CLAUDE.md` exists, so the two drift apart. The session banner
  tells you when a project needs this.
- **Planned work on GitHub:** `/project` treats the repository's GitHub Issues as the plan of record,
  so agents read the issue and update it as they go.

## Habits that change results

Small habits make the biggest difference in how well sessions go:

1. **Say the outcome, not the steps.** "Fix the flaky checkout test" works better than a list of
   commands. Add constraints you care about ("read only", "don't touch the API").
2. **One task per session.** Run `/clear` between unrelated tasks. Long, mixed sessions get slower,
   cost more, and lose track of details.
3. **Save before you stop or risk something.** `/handoff` at the end of a day or a long session;
   `/checkpoint` before a risky refactor or migration, so you can roll back.
4. **Raise effort only for hard turns.** The default is tuned for everyday work. Use `/effort high`
   or `/effort xhigh` for hard debugging, audits, or migrations, or add `ultrathink` to a single
   message.
5. **Ask for a second opinion when it matters.** "Poke holes in this" (`/poke-holes`) sends independent
   agents to find and disprove problems. "What could go wrong?" (`/oracle`) runs a risk review
   before you commit to a plan.
6. **Read the statusline.** It shows context size and usage limits. When context passes about
   150K tokens, hand off or compact instead of pushing on.
7. **When something feels off, look before you guess.** `whats-on.ts` shows what is installed and
   active; [troubleshooting](./docs/troubleshooting.md) covers hook warnings and install health.

## Make it better for everyone

cc-settings improves when people feed back what they learn. There are three levels, from quickest
to most involved:

1. **Share a lesson.** When you hit a gotcha, a convention, or a decision the team should know,
   say "share this" or run `/share-learning`. It lands in the shared team-knowledge repository, and
   every machine sees it right before the command or file edit it applies to.
2. **Keep a workflow that worked.** When a session found a good way to do something repeatable,
   say "turn this session into a skill" or run `/harvest`. It proposes a skill, rule, or team note
   built from what actually happened.
3. **Look back weekly.** `/retro` reports what you shipped, how sessions went, and quality trends,
   and shows which guardrails fired and whether they helped.

To change cc-settings itself, clone it and read the [maintainer docs](./docs/README.md#maintain-cc-settings).
The short version:

- Settings live in `config/` as fragments that the installer merges into
  `~/.claude/settings.json`. Edit the fragments, never the installed file.
- A new or reworded skill ships with an eval case in `evals/`; see
  [skill authoring](./docs/skill-authoring.md).
- Run `bun test`, `bun run typecheck`, and `bun run lint` before pushing.
- If you only want to suggest something, open an issue with the behavior you saw and what you
  expected.

## Keep it current

- **Update:** say "update cc-settings" or run `/cc update` in a session, or re-run the install
  command. Restart the product afterwards.
- **Auto-update (macOS):** add `--auto-update=on` to the install command for a daily check at
  10:00 local time. `--auto-update=off` removes it.
- **Check health:** `npx darkroom-settings --status` reports installed versus packaged state.
- **Undo:** `bun src/setup.ts --rollback` from a checkout restores the newest backup. The
  [installation reference](./docs/install.md) covers uninstall.

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
  reads; Claude Code gets its copy as [CLAUDE-FULL.md](./CLAUDE-FULL.md), installed as `~/.claude/CLAUDE.md`. Twelve topic rules (TypeScript,
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
installer does not own. Put your own global instructions in `~/.claude/personal.md`: the
installed `CLAUDE.md` imports it, and setup never replaces it (Claude Code only). It does not
grant GitHub, Figma, or browser access, and it does not make the two products identical: see [Claude Code and Codex](./docs/claude-vs-codex.md) for what each
host can and cannot do.

## Choose where to read next

| Goal | Start here |
|---|---|
| Find the workflow for a specific outcome | [Manual](./MANUAL.md) |
| Choose a skill and understand what it can change | [Skill guide](./docs/skills.md) |
| Prove the setup with a harmless first task | [Your first session](./docs/first-session.md) |
| Install safely and understand every side effect | [Installation](./docs/install.md) |
| Compare Claude Code and Codex behavior | [Host parity](./docs/claude-vs-codex.md) |
| Diagnose an installed setup | [Troubleshooting](./docs/troubleshooting.md) |
| Understand the whole system | [System overview](./docs/system-overview.md) |
| Understand why advice becomes an enforced gate | [The flow](./docs/the-flow.md) |
| Browse every user, concept, maintainer, and history document | [Documentation index](./docs/README.md) |

## Why the team maintains it

Written standards, workflows, and proof gates reduce per-machine drift. They also make the codebase
more legible to humans: the conventions an agent needs are the same debt the team owes its
engineers.

[darkroom.engineering](https://darkroom.engineering) | MIT
