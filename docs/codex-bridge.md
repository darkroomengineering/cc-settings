# Codex Bridge

Pair Claude Code (Opus) with the OpenAI Codex CLI. Opus plans and synthesizes; Codex executes bulk work and provides independent cross-model verification — a second opinion from a different model family that Claude self-review can't replicate.

---

## Architecture

```
src/lib/codex.ts              Core bridge logic (detection, execution, caching)
  └─ src/scripts/codex-run.ts CLI entry point — subcommands: exec / review / ask
                               Invoked as: bun "$HOME/.claude/src/scripts/codex-run.ts" <subcommand> "..."
                               Also exposed as the /codex skill
  └─ src/hooks/codex-verify.ts SessionStart hook — probes availability, feeds statusline badge
  └─ agents/codex-verifier.md  Agent that fans out a parallel cross-model verification pass
```

---

## Detection Ladder

Availability is probed in three levels, cheapest first:

| Level | Check | Cost |
|-------|-------|------|
| L0 | `codex` on PATH | Free — OS lookup |
| L1 | `codex login status` | Free — local credential check, no model call |
| L2 | First real `codex exec` | One API call — entitlement and quota only knowable here |

There is no endpoint that tells you whether an account has Codex access. Entitlement and quota are only surfaced by attempting a call. L2 failures are classified and cached (see States below).

---

## States and Statusline Badge

| State | Badge | Behavior |
|-------|-------|----------|
| available | `codex ✓` | Bridge fully operational |
| unauthenticated | `codex auth?` | L1 failed — run `codex login` |
| no-access | `codex auth?` | L2 failed with entitlement error — sticky, re-checked daily |
| rate-limited | `codex ⏳` | L2 failed with quota error — transient, clears in ~5h |
| not-installed | *(hidden)* | L0 failed — badge suppressed entirely |
| unknown | *(hidden)* | One-off error — badge suppressed; safe to retry |

Note: `unauthenticated` and `no-access` share the `codex auth?` badge — both are resolved by re-authenticating, and the statusline keeps the surface minimal. The precise state (and remediation) is in the `/codex` preflight message and the verdict cache.

**Known gotcha**: Codex's "Quota exceeded / usage limit" error is sometimes actually an auth/workspace mismatch, not a real quota exhaustion. If the rate-limited badge appears unexpectedly, try:

```bash
codex logout && codex login
```

---

## Quota Routing

This is the core reason to use the bridge. Claude and Codex meter differently:

| Pool | Meter | Capacity |
|------|-------|----------|
| Opus | Wall-time / weekly | Scarce — ~22–52h/wk on Max 5x; auto-downshifts to Sonnet when exhausted |
| Sonnet | Per-turn subagent budget | Roomy — `CLAUDE_CODE_SUBAGENT_MODEL` is already `sonnet` |
| Codex (Pro-class) | Messages per 5h window | Roomy — resets every 5h |

**Routing convention** (not config — there is no `/loop` model key; routing is per-invocation):

- **Opus** — planning, synthesis, gates only. The single scarce pool does the thinking.
- **Sonnet** — `/loop` bodies, heavy fan-out subagents. Already the default subagent model.
- **Codex** — bulk execution and verification, batched into as few large calls as possible.

Two roomy pools (Sonnet + Codex) carry volume. The one scarce pool (Opus) directs traffic.

---

## Usage

### `/codex` skill subcommands

```bash
# Execute a task via Codex
/codex exec "refactor all API handlers to use the new response format"

# Cross-model review of the current diff
/codex review

# Ask Codex a question without executing
/codex ask "what are the edge cases in this auth flow?"
```

### `codex-verifier` agent

For parallel cross-model verification after a risky implementer pass:

```
> have codex verify the changes
> cross-check with codex
> second model on this diff
```

Opus delegates to the `codex-verifier` agent, which runs `codex review` and returns findings grouped by severity (Critical / High / Medium / Low / Info).

---

## Setup Caveat

The `codex-verify.ts` hook runs on `SessionStart`. Adding it changes the fingerprinted hooks block in `~/.claude/settings.json`. After installing the bridge, re-run the installer to refresh the fingerprint:

```bash
bash setup.sh
```

Without this step, `verify-hooks.ts` will warn about a fingerprint mismatch at the start of every session. See `SECURITY.md` for the full threat model.

---

## Related: native config import (the other direction)

This bridge is *runtime* interop — Claude calls Codex per-task. Codex also offers *config* interop in the opposite direction: **Settings → General → Import other agent setup** ([docs](https://developers.openai.com/codex/import)) ingests an existing agent's `AGENTS.md`, `settings.json`, MCP servers, hooks, slash commands, and subagents, converting them to Codex-native equivalents.

Because cc-settings already treats `AGENTS.md` as the portable source of truth (installed to `~/.claude/AGENTS.md`), a teammate working standalone in Codex can import it and inherit the Darkroom standards without this bridge at all. The two are complementary:

- **Bridge** (this doc) — drive Codex *from* a Claude session for cross-model exec/review/ask.
- **Import** — mirror the cc-settings config *into* Codex so a standalone Codex session behaves like a Darkroom setup.

After importing, review tool restrictions and any MCP servers using custom auth — Codex flags these for re-authentication.
