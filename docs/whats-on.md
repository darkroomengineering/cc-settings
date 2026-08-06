# What's On

```
bun ~/.claude/src/scripts/whats-on.ts
```

That's the command that works for everyone, whether or not you kept the
cc-settings repo checkout around — the installer copies the TS tree to
`~/.claude/src/`, and this script lives there like every other installed
script. If you do have the repo checked out, `bun run whats-on` (below) is
the same script, shorter to type.

`whats-on` answers a different question than `bun src/setup.ts --status`:
status answers install health (version drift, present/missing counts,
"38/38 skills", auto-update enrollment). `whats-on` answers what is actually
shaping the current session — one line per thing, what it does, and how to
turn it off.

It reads the USER-SCOPE INSTALLED state at `~/.claude` (settings.json,
output-styles/, CLAUDE.md, AGENTS.md, rules/, agents/, skills/) — never the
repo checkout — and never writes anything. That's a real caveat, not just
phrasing: a project-level `.claude/settings.json`, `.claude/settings.local.json`,
managed policy, or a CLI flag can all override what's reported here without
changing anything this report shows. The report detects and flags a
project-level `.claude/settings.json` in your current directory (presence
only — it doesn't merge or resolve full precedence).

## Running it

- **From anywhere, without the repo** — `bun ~/.claude/src/scripts/whats-on.ts`
- **From a cc-settings checkout** — `bun run whats-on`

## When to run it

- Before you assume a reply's tone/behavior comes from the model rather than
  a configured output style, hook, or always-on instruction file.
- After `setup.sh`, to see what actually got wired up.
- When onboarding a teammate who's asking "what does this thing even do to my
  session" — this is the report to hand them.

## What it covers

1. **Output style** — the configured style (or "Default" if unset), whether a
   file in `output-styles/` actually resolves to it (matched against
   frontmatter `name:` first, then filenames case-insensitively — the same
   resolution order Claude Code itself uses), and that it only applies to the
   main conversation (subagents run their own system prompt) and needs
   `/clear` or a new session to take effect.
2. **Always-on instructions** — `CLAUDE.md` (genuinely always injected, every
   turn) vs. `AGENTS.md` (present but NOT auto-loaded by Claude Code —
   `CLAUDE.md` merely *instructs* the model to read it) vs. `rules/`, split
   into always-on rule files (no `paths:` frontmatter key — injected every
   turn, same as `CLAUDE.md`) and path-conditioned ones (has `paths:` — only
   loaded when a matching file is in play). Always-on rule files are named,
   since they cost context every turn.
3. **Model & effort** — `model`, `CLAUDE_CODE_EFFORT_LEVEL`,
   `CLAUDE_CODE_SUBAGENT_MODEL`.
4. **Hooks** — total group/event counts, then one row per cc-settings-managed
   hook script actually referenced in `settings.json`, with the event(s) it's
   wired to and a one-line effect description pulled from the script's own
   leading comment (never fabricated — a script with no comment prints its
   name alone).
5. **Inventory** — skills/agents/MCP-server counts and permission allow/deny
   counts, plus a pointer to `bun run permissions:check "<cmd>"` for a
   permission dry-run.
6. **Footer** — pointers to `MANUAL.md` (full inventory) and
   `bun src/setup.ts --status` (install health).

## Flags

- `--json` — same data as a machine-readable JSON dump, e.g.
  `bun run whats-on --json | jq '.outputStyle'`.

Read-only: it never mutates `~/.claude` or any installed file.
