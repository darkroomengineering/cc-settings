# Troubleshooting cc-settings

> **Audience:** installed users and administrators
> **Purpose:** diagnose setup, host, skill, prerequisite, hook-trust, and recovery problems
> **Status:** canonical troubleshooting guide

Start by classifying the problem. Session state, installation health, invocation history, and hook
trust are different questions and use different evidence.

## Installation or session state

From a checkout, preview and inspect the selected product:

```bash
bash setup.sh --target=claude --status
bash setup.sh --target=codex --status
bash setup.sh --target=both --dry-run
```

Claude users can inspect installed user-scope behavior from any directory:

```bash
bun ~/.claude/src/scripts/whats-on.ts
```

That report does not identify which skill handled a past prompt. It also does not fully resolve
project settings, managed policy, or command-line overrides. Codex has no exact equivalent; use
`/status` for native session state and `/hooks` for installed plugin-hook trust.

Restart the selected product after installation or a tier change. Output-style changes in Claude
need `/clear` or a new session because the style loads once per session.

## A skill did not run or behaved differently

1. Use ordinary language first. State the desired outcome and safety boundary.
2. Pin the exact skill with `/skill-name` in Claude or `$skill-name` in standalone Codex.
3. Check the [skill guide](./skills.md) for prerequisites and host limits.
4. Check for a project-local skill with the same name.
5. Ask the host which workflow it selected. Treat the answer as current-turn context, not a durable
   invocation log.

Claude's native `/review` name can overlap with the cc-settings local review skill. Ask for "the
cc-settings local pre-commit review" or select it visibly from the skill picker.

If Codex warns that skill descriptions were shortened, run `bun run migrate:codex-skills` from a
cc-settings checkout. A former `/import` may have placed duplicate names in `~/.agents/skills` in
addition to the installed plugin. Review the dry-run list, then use `--apply` to move only those
overlaps into a timestamped backup.

Codex Desktop can recreate the duplicates when `[desktop]
external-agent-import-sync-enabled = true` in `$CODEX_HOME/config.toml`, or
`~/.codex/config.toml` when `CODEX_HOME` is unset. The preview warns when this is the cause, and
`--apply` refuses without moving anything or creating a backup. Disable the setting yourself, quit
and restart Codex completely, then rerun the preview and apply. cc-settings reads this setting but
never edits `config.toml`. Malformed TOML and non-boolean values fail closed with the config path.
The migration does not delete skills or touch non-overlapping directories. See
[Codex support](./codex.md#if-codex-says-skill-descriptions-were-shortened).

## A prerequisite is missing

Some skills need capabilities the installer cannot grant:

| Capability | Check | Used by |
|---|---|---|
| GitHub CLI authentication | `gh auth status` | `share-learning`, project and PR workflows |
| Team knowledge access | `gh api repos/darkroomengineering/team-knowledge --jq .full_name` | `share-learning` |
| Claude core MCP servers | `bun ~/.claude/src/scripts/whats-on.ts` | Context7, TLDR, QA, Lighthouse |
| Codex plugin trust | `/hooks` | Codex lifecycle hooks |
| Browser capture | Host browser tools or configured Chrome DevTools MCP | QA and Lighthouse |

The full Codex profile installs only the fixed HTTPS Figma MCP. It does not automatically install
Context7, TLDR, or Chrome DevTools. A Codex workflow must use its documented fallback or say that the
capability is unavailable.

## Claude reports suspicious hooks

Run the installed scanner, which does not require a repository checkout:

```bash
bun ~/.claude/src/scripts/audit-hooks.ts
```

Review every unknown or suspicious command before refreshing trust. If the change is legitimate,
use a fresh, verified checkout to reinstall and refresh the fingerprint:

```bash
git clone https://github.com/darkroomengineering/cc-settings.git
cd cc-settings
bash setup.sh --target=claude
```

Do not assume `~/.claude/cc-settings` exists. Do not refresh the fingerprint before you understand
the changed hook, because that would mark the new bytes trusted. Follow the full
[security runbook](../SECURITY.md#hook-warning-runbook).

## Roll back or uninstall

Preview first:

```bash
bash setup.sh --target=both --dry-run
```

Then select the smallest affected target:

```bash
bash setup.sh --target=claude --rollback
bash setup.sh --target=codex --rollback
bash setup.sh --target=both --uninstall
```

Rollback restores the scheduler state captured in that backup. After a Claude rollback, check the
auto-update setting explicitly and override it when needed:

```bash
bash setup.sh --target=claude --auto-update=off
```

Uninstall removes managed state and leaves product-specific backups. It does not uninstall Claude
Code, Codex, Bun, Git, `jq`, or the GitHub CLI. See [installation](./install.md) for the exact
ownership and side-effect table.

## Report a reproducible problem

Include the selected target and tier, operating system, installer command, exit code, full error,
and the relevant read-only status output. Never include credentials, `.env` contents, tokens, or a
private repository's source.
