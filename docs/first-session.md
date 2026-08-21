# Your first cc-settings session

> **Audience:** people who have just installed cc-settings
> **Purpose:** prove the setup with one harmless task and explain what happens next
> **Status:** canonical first-use guide

Your first success should be read-only. Do not test a new coding setup by asking it to publish,
delete, or rewrite anything.

## 1. Restart and inspect the host

Restart every product selected during installation.

For Claude Code, inspect the user-scope configuration that is shaping the session:

```bash
bun ~/.claude/src/scripts/whats-on.ts
```

The report describes installed instructions, output style, model settings, hooks, skills, agents,
MCP servers, and permissions. It does not show invocation history and it does not fully resolve
project or managed-policy overrides.

For Codex, run `/status` for native session state. If the full cc-settings plugin was installed,
open `/hooks` and review its hooks once. Codex has no exact equivalent of Claude's `whats-on`
report.

## 2. Ask one harmless question

Open a repository and say:

```text
Explain where this project's configuration is loaded. Read only. Cite the files and lines.
```

Natural language works in both products. To pin the workflow explicitly, use `/explore` in Claude
Code or `$explore` in standalone Codex.

You should receive:

- a statement that the task stayed read-only;
- the relevant files and line references;
- a short explanation of how they connect;
- uncertainty called out when the repository does not prove an answer.

The exact wording can differ. The important contract is evidence, scope, and no file changes.

## 3. Understand background work

Many Claude skills run in a forked context, which is a separate working conversation for the task.
The main conversation remains available while that work runs.

```text
request -> skill selected -> prerequisite or approval -> background work -> notification -> result
```

You may keep talking while a forked skill runs. Completion returns as a task notification and then a
human-readable result. Follow-up work should continue the same task or agent when possible, because
starting a fresh one discards its reasoning and context.

Standalone Codex uses its own agent and background surfaces. A shared skill keeps the same outcome
and safety boundary, but the panes, notifications, and agent mechanics do not have to match Claude.

Inline skills stay in the current conversation. The [skill guide](./skills.md) marks the normal run
style and explains what each skill can change.

## 4. Know the control points

You normally describe the outcome. Explicit names are useful when two workflows are close:

| Intent | Claude Code | Standalone Codex |
|---|---|---|
| Let the host choose | Say the outcome | Say the outcome |
| Pin a shared skill | `/skill-name` | `$skill-name` |
| Inspect the current session | Native statusline and `/status` where available | `/status` |
| Review installed plugin hooks | Claude settings and hook docs | `/hooks` |
| Inspect installed cc-settings user scope | `bun ~/.claude/src/scripts/whats-on.ts` | No exact equivalent |

Claude's native `/review` name can overlap with the cc-settings `review` skill. Say "run the
cc-settings local pre-commit review" or select the cc-settings skill from the skill picker when you
need that exact workflow. The documentation does not assume an unverified command-precedence rule.

## 5. Protect long sessions

The active Claude guidance uses 65 percent as the manual compaction point. Save state before the
window becomes crowded.

| Context use | Action |
|---|---|
| Below 65% | Work normally |
| 65-79% | Save a checkpoint; compact or prepare a handoff |
| 80-89% | Stop expanding scope and run `/handoff` |
| 90%+ | Run `/handoff` immediately |

Use `checkpoint` for a reversible mid-task snapshot. Use `handoff` to transfer the whole session to
a later session. In Codex, pin those skills with `$checkpoint` and `$handoff`.

## 6. If the first task does not behave as expected

1. Run the installed-state or native-status checks above.
2. Confirm the invocation syntax in [Claude Code and Codex](./claude-vs-codex.md).
3. Check prerequisites in the [skill guide](./skills.md).
4. Use the [troubleshooting guide](./troubleshooting.md) for hook warnings and installation health.
5. Preview rollback or uninstall from a checkout before changing state:

   ```bash
   bash setup.sh --target=claude --dry-run
   bash setup.sh --target=codex --dry-run
   ```

The [installation reference](./install.md) explains every managed path and undo operation.
