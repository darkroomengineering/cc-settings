# `mcp-needs-auth-cache.json` has no TTL, latches forever after a single 401

**Target**: [anthropics/claude-code](https://github.com/anthropics/claude-code/issues)
**Version seen**: Claude Code 2.1.117 (sdk-cli), macOS 25.5.0, Node 24.3.0
**Reproducer project**: `/Users/frz/Developer/@darkroom/cc-settings`
**Status**: workaround shipped locally (TTL prune hook, see below)

## Summary

When an HTTP MCP server returns a 401 / auth-required on startup, Claude
Code records the server name in `~/.claude/mcp-needs-auth-cache.json` with
a wall-clock timestamp. From that point on, every new session logs

    Skipping connection (cached needs-auth)

for that server and never attempts to connect again. The cache has no
TTL: entries are only cleared by an explicit re-auth via `/mcp`. In
practice this means one transient 401 permanently removes a server from
every future session until the user notices and manually re-auths.

## Impact

- OAuth MCP servers whose short-lived refresh tokens briefly fail (network
  blip, scope change, server 5xx during refresh) get latched "needs auth"
  forever, even after their tokens come back good.
- Users perceive this as "Figma / Sanity always want to re-authenticate".
  What is actually happening is that the CLI never retries the connection;
  `mcp list` shows ✓ Connected only after an explicit `/mcp` re-auth.
- Stdio servers are not immune: I have one session log
  (`2026-04-22T11:47:24-643Z`) where `Skipping connection (cached
  needs-auth)` fires for `figma`, `Sanity`, `claude-ai-Gmail`,
  `claude-ai-Drive`, `claude-ai-Calendar`, and `claude-ai-Mercury` — four
  of which had been working in a session a few hours earlier.

## Reproduction

1. Configure an HTTP MCP server in `~/.claude.json` (e.g. Sanity or
   Figma).
2. Complete OAuth once; confirm `claude mcp list` shows ✓ Connected.
3. Let the refresh token expire or revoke it on the provider side.
4. Start a Claude Code session. The CLI records the server in
   `~/.claude/mcp-needs-auth-cache.json` with `{ "timestamp": <now> }`.
5. Restore the token on the provider side (or wait for a transient issue
   to resolve).
6. Start a new Claude Code session. Observe in
   `~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-<server>/`:

       { "debug": "Skipping connection (cached needs-auth)" }

   Observe that `claude mcp list` still reports "Needs authentication"
   even though the credentials are now valid.
7. `rm ~/.claude/mcp-needs-auth-cache.json` and restart — server
   reconnects normally.

## Evidence from this machine

`~/.claude/mcp-needs-auth-cache.json` at time of report:

    {
      "claude.ai Google Drive": { "timestamp": 1776882834906 },
      "claude.ai Gmail":        { "timestamp": 1776882834905 },
      "claude.ai Google Calendar": { "timestamp": 1776882834905 },
      "claude.ai Mercury":      { "timestamp": 1776882835274 }
    }

Session 2026-04-22T11:47:24-643Z MCP logs for **figma** and **Sanity**
both contain three `Skipping connection (cached needs-auth)` entries and
zero reconnect attempts. The very next session (2026-04-22T18:31:49) —
after the user manually re-auth'd — shows full successful connects for
both. Nothing else changed.

## Proposed fix

Add a TTL to the needs-auth cache. Two reasonable knobs:

1. **Time-based expiry** — entries older than N minutes become eligible
   for retry. 15–60 minutes is probably right: long enough that a genuine
   auth-required server doesn't spam the user with prompts on every
   session, short enough that a recovered token is picked up quickly.
2. **Bounded retry** — on session start, attempt connection once per
   previously-flagged server. On success, clear the entry. On failure,
   update the timestamp and continue skipping.

Option 2 is strictly better UX (zero user wait on healthy servers, no
spam on broken ones) and is what most browsers do for failed fetches of
cached resources.

Either fix should be paired with cleaning up malformed cache files
instead of refusing to connect (currently a corrupt JSON here blocks
everything).

## Local workaround in this repo

`cc-settings` ships a SessionStart hook that prunes entries older than
`MCP_NEEDS_AUTH_TTL_MS` (default 1 hour):

- Script: `src/scripts/prune-mcp-auth-cache.ts`
- Wired in: `src/scripts/session-start.ts` (Phase 1 background task)
- Tests: `tests/phase2-scripts.test.ts` → `describe("prune-mcp-auth-cache.ts")`

This is a client-side pure-Bun script and will be removed as soon as
upstream gains a TTL.

## Related logs

- `~/Library/Caches/claude-cli-nodejs/<project-slug>/mcp-logs-<server>/*.jsonl`
  — per-session connection traces, contain the "Skipping connection"
  evidence.
- `~/.claude/mcp-needs-auth-cache.json` — the cache itself.
