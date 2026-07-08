# Security

How cc-settings defends Claude Code against the supply-chain attack class
that emerged in 2026, and what to do if you suspect compromise.

## Threat model — the Shai-Hulud worm pattern

In May 2026, the "Mini Shai-Hulud" npm/PyPI worm compromised 172 packages
across @tanstack, @mistralai, @guardrails-ai, @uipath, @opensearch-project
and others. The persistence mechanism specifically targets AI developer
tooling:

1. Compromised package's `postinstall` runs a 2.3 MB obfuscated payload.
2. Payload writes a `SessionStart` hook into `~/.claude/settings.json`
   (and a task into `.vscode/tasks.json`).
3. The hook re-executes the payload on every Claude Code session — even
   after `npm uninstall` removes the package from `node_modules`.
4. The payload exfiltrates credentials, scans for more secrets, and
   propagates to packages the developer publishes.

**Why this works:** Claude Code hooks are advisory shell commands that run
on every event. There is no per-hook signing, sandboxing, or allowlist in
the base product. Anything that can write `settings.json` can persist.

## How cc-settings defends

Four layers, all installed by `setup.sh`:

### 1. Hooks-block fingerprint (`SessionStart` integrity check)

At install time, `setup.sh` writes a SHA256 of the canonicalized `hooks`
section of your merged `~/.claude/settings.json` to
`~/.claude/.cc-settings-hooks-fingerprint`.

On every `SessionStart`, the `verify-hooks.ts` hook re-hashes the current
`hooks` block and compares. **Mismatch surfaces a loud terminal warning**
with remediation steps. Match is silent.

Source: `src/lib/hooks-fingerprint.ts`, `src/hooks/verify-hooks.ts`.

### 2. Installed-src content manifest

The fingerprint covers hook *entries*, not the *content* of the scripts
they point at. Two bypasses motivated this layer:

- **Dropped payload** — malware writes `~/.claude/src/hooks/evil.ts` and
  registers it. The fingerprint trips, but a path-shape-only auditor would
  have classified the new hook "trusted" and downgraded the alarm.
- **Patched payload** — malware appends code to an already-registered
  shipped script. `settings.json` is untouched, so the fingerprint never
  trips at all.

At install time, right after the TS sources are copied, `setup.sh` writes a
SHA256 manifest of every `~/.claude/src/**/*.ts` file to
`~/.claude/.cc-settings-src-manifest`. On every `SessionStart`,
`verify-hooks.ts` re-hashes the installed tree and **warns loudly on any
modified, removed, or unexpected new file**. The auditor (layer 3) also
gates its "trusted" classification on this manifest.

Like the fingerprint, the manifest is refreshed only by `setup.sh` — never
by the auditor or the verify hook — so malware can't whitelist itself.

Source: `src/lib/hooks-fingerprint.ts` (manifest write/verify),
`src/hooks/verify-hooks.ts`, `src/setup.ts`.

### 3. Command auditor (`bun run audit:hooks`)

A standalone scanner that classifies every hook command in
`~/.claude/settings.json` into:

| Severity | Meaning |
|---|---|
| **trusted** | Matches the cc-settings shipped pattern `bun "$HOME/.claude/src/{scripts,hooks,lib}/<name>.ts"` (or a compound of those) **and** the referenced file's content hash matches the install manifest. Path shape alone is never enough. |
| **unknown** | Doesn't match the trusted pattern — user-added hooks land here; review manually, then either remove or re-run `setup.sh` to fingerprint them. Shipped-pattern commands also land here when no install manifest exists yet (pre-manifest install): content can't be verified, so they are not promoted to trusted. |
| **stale** | Matches the cc-settings shipped pattern but the script file no longer exists on disk — a leftover from a hook rename or removal in a past cc-settings release. Harmless but noisy. Re-run `setup.sh` to prune the entry and refresh the fingerprint. Exit code 0. |
| **suspicious** | Matches a known supply-chain malware signature: `curl \| sh`, `wget \| bash`, base64 decode + exec, `eval $(...)`, `node -e`, `python -c`, `/tmp/<exec>`, hidden `node_modules/.bin/`, `atob(...)`, opaque base64 blob (>250 char single-token). Also: a shipped-pattern command whose file **exists on disk** but is missing from the install manifest (possible dropped payload) or whose content hash differs from it (possible patched payload). Exit code 1. |

Exit code is non-zero on any suspicious finding so CI can gate on this. Stale-only results exit 0.

Source: `src/lib/audit-hooks.ts`, `src/scripts/audit-hooks.ts`.

**Also scanned, in their own report section:** `env` values and `mcpServers`
command/args are matched against the same malware-signature bank
(`curl | sh`, base64 decode + exec, `node -e`, etc.) and printed under a
separate `ENV/MCP SUSPICIOUS` heading when something matches. This is
**pattern-match classification only** — there is no shipped-pattern/manifest
concept for env vars or MCP server definitions, so nothing here is ever
"trusted", and a clean scan is not an integrity guarantee the way a "trusted"
hook finding is. See the scope note below for exactly what this does and
doesn't buy you.

### 4. The allowlist convention

Every hook command that cc-settings ships starts with
`bun "$HOME/.claude/src/{scripts,hooks,lib}/<name>.ts"`. This is the
structural invariant the auditor keys on — but since the content manifest
landed, the shape only *selects* the verification path; trust comes from
the content hash. Injected hooks from compromised packages either don't
match this shape (inline Node/Python, decoded base64, `/tmp/` payloads) or
match it and fail content verification. Either way they surface.

Future hook additions to `config/40-hooks.json` must follow the same
convention. If a third-party tool needs a hook, wrap it in a cc-settings
script under `src/scripts/` rather than referencing the third-party binary
directly.

## What to do if `verify-hooks` warns at session start

```
⚠  cc-settings: hooks-block fingerprint mismatch — SUSPICIOUS HOOKS DETECTED
```

**Step 1 — Audit.** Run `bun run audit:hooks` from anywhere. It will print
every hook in `~/.claude/settings.json` grouped by severity, with the
reasons each suspicious entry was flagged.

**Step 2 — Triage.**

- If the suspicious entry is a tool you knowingly installed (e.g., a CI
  helper), that's a false positive — see Step 4.
- If you don't recognize it, you're likely compromised. **Continue to Step 3.**

**Step 3 — Remediate compromise.**

```bash
# 1. Back up the current settings.json before touching it.
cp ~/.claude/settings.json ~/.claude/settings.json.compromised-$(date +%s)

# 2. Open settings.json in your editor.
$EDITOR ~/.claude/settings.json

# 3. Manually delete every entry the auditor flagged as suspicious.
#    Keep the legitimate cc-settings entries (bun "$HOME/.claude/src/...").

# 4. Re-run setup.sh from your cc-settings clone to refresh the fingerprint
#    against the now-clean hooks block.
cd ~/.claude/cc-settings && bash setup.sh

# 5. Investigate which package introduced the malicious hook.
#    Recent installs are the place to start:
grep -l "postinstall" node_modules/*/package.json | xargs -I{} dirname {} | xargs -I{} basename {} | sort -u | tail -20

# 6. Rotate any credentials that were on disk while the hook had a chance
#    to run: ~/.aws/credentials, ~/.npmrc auth tokens, ~/.config/gh/hosts.yml,
#    SSH keys, .env files in active projects.
```

**Step 4 — False positive (legitimate custom hook).**

If the unknown/suspicious entry is something you added intentionally:

```bash
# Re-run setup.sh — the merger preserves your custom hooks AND refreshes
# the fingerprint. After this, the warning clears on the next session.
cd ~/.claude/cc-settings && bash setup.sh
```

The fingerprint and the src manifest are deliberately refreshed only by
`setup.sh`, never by the auditor itself. If `audit:hooks` could update
either, malware could call it to whitelist itself.

## Adding custom hooks safely

If you maintain personal hooks alongside cc-settings:

1. Add the entry to `~/.claude/settings.json`.
2. Run `bun run audit:hooks` — confirm only your new entry shows up as
   "unknown" (not "suspicious"). Suspicious means your pattern overlaps
   with a known-bad signature; rewrite it.
3. Run `setup.sh` to fingerprint the new state.
4. Or: contribute the hook upstream to cc-settings as a `src/scripts/`
   script and propose a `config/40-hooks.json` entry — it then ships as
   "trusted" without needing per-user fingerprint refresh.

## Don't disable hooks wholesale

When the fingerprint warns, surgically remove the suspicious entries from
`~/.claude/settings.json` (Step 3 above) rather than flipping
`disableAllHooks` or `allowManagedHooksOnly`. Wholesale-disabling hooks
also disables features built on the hooks system — most visibly
[`/goal`](https://code.claude.com/docs/en/goal), which is a session-scoped
prompt-based `Stop` hook and reports itself unavailable if hooks are off
at any settings level. The verify-hooks fingerprint and the `/goal`
evaluator coexist cleanly: the fingerprint hashes only the persisted
`hooks` block in `settings.json`, not the in-memory session-scoped hook
that `/goal` installs for its lifetime.

## Enforcement boundary: the permissions deny-list, not safety-net

The enforcement boundary for dangerous Bash commands is the permission
deny-list (`config/30-permissions.json`) evaluated by Claude Code's own
permission matcher. That layer decides what is blocked.

`src/hooks/safety-net.ts` is **advisory defense-in-depth, fail-open by
design**: it pattern-matches on a best-effort regex parse of the command
and nudges/blocks what it recognizes, but a hook crash, timeout, or parser
gap allows the command through (`tests/hook-fail-open.test.ts` encodes
this deliberately — a broken guard must not brick every Bash call).
Consequences of that stance:

- Parser gaps in safety-net are hardening opportunities, not security
  holes; the deny-list and the human-in-the-loop permission prompt remain
  the boundary.
- Anything that MUST never run belongs in `config/30-permissions.json`,
  not (only) in safety-net.

**Keeping the deny-list honest against the allow-list's wholesale
subcommands:** `config/30-permissions.json` wholesale-allows several git
subcommands (`git branch:*`, `git checkout:*`, `git push:*`, …) because
requiring per-flag confirmation on every `git status`/`git log`/routine
`git push` would make the deny-list unusable. That tradeoff only holds if
the deny-list has an explicit override for every destructive *form* of a
wholesale-allowed subcommand — otherwise the dangerous form is silently
auto-approved by the broad allow, with only fail-open safety-net.ts between
it and the user, contradicting the "deny-list is the boundary" claim above.
Concretely: `git push -uf`/`-fu` (bundled short flags that still carry
`-f`, distinct from the literal `--force`/`-f` token forms already denied)
and `git branch -D`/`-d -f` (force branch delete) each have their own deny
entry alongside the existing `--force`/`-f`/`-D` forms, mirroring exactly
what `safety-net.ts`'s `analyzeGitAfterVerb` already treats as must-block.
When adding a new wholesale-allowed git (or other) subcommand, enumerate its
destructive forms against safety-net.ts's checks and close the gap in the
deny-list rather than narrowing the allow — narrowing breaks the common
case (an interactive human confirming a legitimate `git push --force` to
their own fork), closing the gap doesn't.

**Edit/MultiEdit are wildcard-allowed (`Edit(*)`, `MultiEdit(*)`) alongside
`Write(*)`.** The deny-list's `Write(~/.claude/settings.json)` /
`Write(~/.claude.json)` entries only close the `Write` tool surface for
those two files — `Edit`/`MultiEdit` are separate tool names and are not
covered by a `Write`-scoped deny rule. `Edit(~/.claude/settings.json)`,
`MultiEdit(~/.claude/settings.json)`, and the `.claude.json` equivalents
mirror the `Write` denies for exactly this reason: all three mutation tools
must be denied for a path, not just one of them, or a prompt-injected
"use Edit instead of Write" instruction bypasses the protection entirely.

## What cc-settings deliberately does not do

- **Auto-quarantine on suspicious match.** The session-start hook only
  warns; it never disables, rewrites, or deletes hooks. Automated
  remediation that touches the user's settings.json is itself a high-trust
  operation and we'd rather the human read the diff.
- **Block npm installs.** Pre-install package scanning is a separate
  problem with better-suited tools (`snyk`, `socket.dev`, `osv-scanner`).
  Use one of those in CI; cc-settings catches what gets past it.
- **Cryptographic hook signing.** Claude Code doesn't ship a signing
  primitive yet; signing would require upstream support. The fingerprint +
  content manifest pair is the practical alternative.
- **Sandbox hook execution.** Hooks run with the user's full privileges
  by Claude Code's design. cc-settings doesn't subvert that.

What the content manifest does **not** cover:

- **The `bun` binary itself** (or `git`, or anything else on PATH). A
  compromised runtime executes whatever it likes regardless of what the
  manifest says about the scripts it runs.
- **`node_modules`.** The installed src tree symlinks `node_modules` back
  to the source repo; dependency content is the territory of `snyk` /
  `socket.dev` / lockfile auditing, not this manifest.
- **Non-`.ts` files** under `~/.claude/src` (e.g. `package.json`,
  `tsconfig.json`, `bun.lock`).
- **Coordinated tampering of the manifest + fingerprint + settings
  together.** Anything that can rewrite all three sentinels can forge a
  consistent state. The defense holds because the sentinels are refreshed
  only by `setup.sh` (the auditor never self-refreshes them) and because
  worms automate against defaults — but a targeted attacker with full
  user-privilege write access is outside this threat model.

## Scope: the fingerprint and content manifest cover the `hooks` block only

Layers 1 and 2 above (the hooks-block fingerprint and the src content
manifest) are precisely scoped: `hashHooks()` hashes `settings.hooks` and
nothing else, and the content manifest verifies script *files*, not other
`settings.json` keys. Concretely, **`mcpServers`, `permissions`, `env`, and
every other top-level key of `settings.json` are entirely outside what those
two layers verify** — a change to any of them, however large, never trips
the fingerprint mismatch warning, even though `mcpServers` entries run
arbitrary local commands with full startup (a persistence primitive at
least as strong as a hook).

Why this boundary, deliberately, rather than widening the hash: `mcpServers`,
`permissions`, and `env` are all things a user is *expected* to hand-edit
routinely (adding a personal MCP server, tightening a permission rule,
setting a project env var) — unlike the `hooks` block, which cc-settings
owns end-to-end and where any drift from the installed state is inherently
suspect. Folding those keys into the fingerprint would mean every legitimate
edit trips the same "tampering" warning as an actual injected payload,
training users to click through it — the opposite of what a security signal
is for.

What actually covers `mcpServers`/`env`: layer 3's auditor (above) runs a
**best-effort pattern-match scan** (`auditEnvAndMcp` in
`src/lib/audit-hooks.ts`) over `env` values and `mcpServers` command/args
against the same malware-signature bank used for hooks, reported in its own
`ENV/MCP SUSPICIOUS` section. This is classification only — it catches an
*obvious* injected payload (a `curl | sh`, a base64-decode-and-exec, an
inline `node -e`), the same way the hook auditor's `suspicious` tier does.
It does **not** give `mcpServers`/`env` the same guarantee `hooks` gets from
the fingerprint + manifest pair: there's no "this exact value hasn't changed
since install" check, no content-hash verification of anything an
`mcpServers.command` points at, and no `trusted` tier — silence means "no
known signature matched," not "unchanged" or "verified."

**Manual-review guidance:** if you see an `mcpServers` entry or `env` value
you don't recognize — whether or not the auditor flagged it — treat it the
same as an unrecognized hook: check whether you or a tool you installed
added it, and if not, treat it as a compromise signal and follow the
remediation steps above. `permissions` (the allow/deny lists themselves) has
no scanner at all yet; review changes to it the same way you'd review any
other settings.json diff.

## Reporting

Suspicious activity, false positives, or signature gaps — open an issue at
[darkroomengineering/cc-settings](https://github.com/darkroomengineering/cc-settings/issues)
with the audit output.

For the underlying Claude Code product, report to Anthropic via the
official channels documented at
[docs.claude.com/claude-code](https://docs.claude.com/en/docs/claude-code).

## Reference

- Snyk: [TanStack npm Packages Hit by Mini Shai-Hulud](https://snyk.io/blog/tanstack-npm-packages-compromised/)
- Socket: [TanStack npm Packages Compromised in Ongoing Mini Shai-Hulud Supply Chain Attack](https://socket.dev/blog/tanstack-npm-packages-compromised-mini-shai-hulud-supply-chain-attack)
- StepSecurity: [Mini Shai-Hulud Is Back: A Self-Spreading Supply Chain Attack](https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem)
- Wiz: [Mini Shai-Hulud Strikes Again](https://www.wiz.io/blog/mini-shai-hulud-strikes-again-tanstack-more-npm-packages-compromised)
- The Hacker News: [Mini Shai-Hulud Worm Compromises TanStack, Mistral AI, Guardrails AI](https://thehackernews.com/2026/05/mini-shai-hulud-worm-compromises.html)
- Mend: [172 npm and PyPI Packages Compromised in Latest Wave](https://www.mend.io/blog/mini-shai-hulud-is-back-172-npm-and-pypi-packages-compromised-in-latest-wave/)
