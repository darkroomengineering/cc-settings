---
title: "cc-settings: Darkroom's setup for Claude Code and Codex"
description: "cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows, safety checks and proof gates. Install it with npx darkroom-settings."
url: "https://cc-settings.darkroom.engineering/"
---

# cc-settings

cc-settings gives Claude Code and Codex the Darkroom engineering team's standards, task workflows, safety checks, and proof gates. One installer makes a new machine behave like the rest of the team without replacing personal configuration that cc-settings does not own.

## Any platform (Node 18+)

`$ npx darkroom-settings`

## macOS or Linux, without Node

`$ curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh | bash`

Install and sign in to Claude Code, Codex CLI, or both first: cc-settings configures them and does not include a subscription. Restart them after the install. Windows PowerShell, every installer flag and how to undo it are in the [installation reference](https://github.com/darkroomengineering/cc-settings/blob/main/docs/install.md). Free and open source under MIT, [on GitHub](https://github.com/darkroomengineering/cc-settings).

## The same request, done the team's way

- "Fix this bug" reproduces first, names the cause before the fix, keeps the change inside the bug's scope, and runs the real tests afterwards.
- "Review my changes" stays read-only, checks the diff against the team checklist, and reports by severity.
- "Ship it" runs the repository's own type check, build, tests and lint, opens the PR in the house style, and watches CI.

## What it installs

- Coding standards and guardrails every tool reads, twelve topic rules, and six stack profiles.
- 24 skills, named workflows picked from plain language: fix, build, review, land, audit, handoff and the rest.
- 9 role agents, so big work is split between a planner, explorer, implementer, tester, reviewer and others.
- 22 hooks on 16 lifecycle events. They block destructive commands such as `rm -rf`, and a permission rule denies a force push to main.

## What it leaves alone

- Your login and subscription, your permission mode, your personal memory, and any setting the installer does not own.
- Your own global instructions in `~/.claude/personal.md`, which setup never replaces.
- The installer records what it owns and keeps a backup per product, so it can preview, roll back or uninstall.
