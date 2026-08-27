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

**macOS or Linux:**

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

## What cc-settings adds

### Shared standards and skills

- [AGENTS.md](./AGENTS.md) contains portable coding standards for Codex and other compatible tools.
  Claude Code receives its product-specific copy through [CLAUDE.md](./CLAUDE.md).
- 38 shared skills turn ordinary requests into repeatable workflows. The
  [skill guide](./docs/skills.md) explains the value, effects, approval points, output, run style,
  prerequisites, host behavior, and nearby alternatives for every skill.
- Role agents divide planning, exploration, implementation, testing, review, security, and
  orchestration so one conversation does not have to hold every concern.

Many Claude skills work in a forked background context and return by task notification. The main
conversation remains usable while they run. Codex keeps the same outcome and safety boundary through
its own agent controls, but its interface and tool set differ.

### Automatic safety and proof

A lifecycle hook is a small program that runs before or after an event such as a tool call, commit,
push, or session end. Claude receives the full hook set. Codex receives the compatible plugin subset
and asks the user to review its trust through `/hooks`.

Hooks guard destructive commands and require evidence at important boundaries. Proof gates run the
repository's actual type check, build, tests, lint, and visual checks when relevant. A failing
configured suite stays a failure.

### Connected tools

MCP, the Model Context Protocol, lets an AI product call external tool providers. The full Claude
profile configures Context7 for current library docs, TLDR for code maps, Figma, and Chrome DevTools.
The full Codex profile automatically configures only the fixed HTTPS Figma server. Codex workflows
use native fallbacks or report a missing capability instead of pretending the Claude tool exists.

See [Claude Code and Codex](./docs/claude-vs-codex.md) for the full parity matrix.

### Ownership, rollback, and trust

Each product gets a sentinel, which is a small version and ownership record. It lets reinstall,
rollback, and uninstall distinguish cc-settings files from unrelated user files. Backups and
ownership are product-specific.

Claude setup fingerprints its hooks and installed scripts. If a session warns about suspicious
hooks, inspect with the installed command:

```bash
bun ~/.claude/src/scripts/audit-hooks.ts
```

Read [SECURITY.md](./SECURITY.md) before refreshing trust. The installer can preview, report status,
roll back, and uninstall through the same target selector.

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
