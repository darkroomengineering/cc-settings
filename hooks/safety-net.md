---
name: safety-net
trigger: PreToolUse (Bash matcher)
description: Blocks destructive shell commands before execution via deep command analysis
enabled: true
---

# Safety Net - PreToolUse Hook

**Purpose:** Intercept all Bash tool invocations and block destructive operations before they execute. Complements the static `deny` rules in `settings.json` by catching dynamic patterns that static glob matching cannot handle -- shell wrappers, interpreter one-liners, combined flags, `find -delete` chains, etc.

**Script:** `scripts/safety-net.sh`

## How It Works

```
Claude Code -> PreToolUse(Bash) -> safety-net.sh
                                      |
                                      v
                              Extract command from $TOOL_INPUT_command
                                      |
                                      v
                              Run analysis pipeline:
                                1. Split on ; && || pipes
                                2. Unwrap shell wrappers (bash -c, sh -c)
                                3. Unwrap interpreter one-liners (python -c, node -e, etc.)
                                4. Check each unwrapped command against rules
                                      |
                                      v
                              Block? -> exit 2 + JSON {"decision":"block","reason":"..."}
                              Allow? -> exit 0 (silent)
```

The hook is registered as the **first** entry in `hooks.PreToolUse` so destructive commands are blocked before other hooks waste time analyzing them.

## Blocked Patterns

### rm -rf Destructive Paths

| Pattern | Example | Notes |
|---------|---------|-------|
| `rm -rf /` | `rm -rf /` | Root filesystem |
| `rm -rf /*` | `rm -rf /*` | All root children |
| `rm -rf ~` | `rm -rf ~` | Home directory |
| `rm -rf ~/*` | `rm -rf ~/*` | All home contents |
| `rm -rf $HOME` | `rm -rf $HOME` | Home via variable |
| `rm -rf $HOME/*` | `rm -rf $HOME/*` | Home contents via variable |
| `rm -fr` variants | `rm -fr /`, `rm -fr ~` | Reversed flag order |
| `rm -Rf` variants | `rm -Rf /`, `rm -Rf ~` | Capital R variant |
| `rm -r -f` split flags | `rm -r -f /` | Separated flags |
| `rm --recursive --force` | `rm --recursive --force /` | Long-form flags |
| `rm -rf .` / `rm -rf ..` | `rm -rf .` | Current/parent directory |

### Git Destructive Operations

| Pattern | Example | Notes |
|---------|---------|-------|
| `git checkout -- .` | `git checkout -- .` | Discards all uncommitted changes |
| `git checkout -- <file>` | `git checkout -- src/app.ts` | Discards changes in file |
| `git restore` (no --staged) | `git restore src/app.ts` | Discards working tree changes |
| `git restore --worktree` | `git restore -W file.ts` | Explicit worktree discard |
| `git reset --hard` | `git reset --hard HEAD~5` | Discards commits permanently |
| `git reset --merge` | `git reset --merge` | Destructive merge reset |
| `git clean -f` | `git clean -fd`, `git clean -fx` | Removes untracked files |
| `git push --force` | `git push --force origin feat` | Force push (any branch) |
| `git push -f` | `git push -f` | Force push shorthand |
| `git branch -D` | `git branch -D feature` | Force delete branch |
| `git stash drop` | `git stash drop stash@{0}` | Drops stash entry |
| `git stash clear` | `git stash clear` | Drops all stash entries |
| `git worktree remove --force` | `git worktree remove --force /path` | Force remove worktree |

### find/xargs Destructive Chains

| Pattern | Example | Notes |
|---------|---------|-------|
| `find -delete` | `find . -name "*.log" -delete` | Deletes matched files |
| `find -exec rm` | `find . -exec rm -rf {} \;` | rm via find exec |
| `xargs rm` | `cat list \| xargs rm -rf` | Piped bulk delete |
| `xargs bash -c` | `... \| xargs bash -c 'rm ...'` | Wrapper via xargs |
| `xargs sh -c` | `... \| xargs sh -c 'rm ...'` | Wrapper via xargs |
| `parallel rm` | `parallel rm -rf ::: /paths` | GNU parallel delete |

### Shell Wrapper Unwrapping

The hook recursively unwraps shell wrappers to analyze the inner command:

| Wrapper | Example |
|---------|---------|
| `bash -c '...'` | `bash -c 'git reset --hard'` |
| `sh -c '...'` | `sh -c 'rm -rf /'` |
| `zsh -c '...'` | `zsh -c 'git clean -fd'` |
| `/bin/bash -c '...'` | `/bin/bash -c 'git push -f'` |
| `/bin/sh -c '...'` | `/bin/sh -c 'rm -rf ~'` |
| `/usr/bin/env bash -c` | `/usr/bin/env bash -c '...'` |
| Nested wrappers | `bash -c 'sh -c "git reset --hard"'` |

Recursion depth limit: 3 (hardcoded in script).

### Interpreter One-Liner Detection

The hook detects dangerous system calls inside interpreter one-liners:

| Interpreter | Detected Functions |
|-------------|-------------------|
| `python -c` / `python3 -c` | `os.system()`, `os.popen()`, `subprocess.run()`, `subprocess.call()`, `subprocess.Popen()` |
| `node -e` | `child_process.execSync()`, `exec()`, `spawn()` |
| `ruby -e` | `system()`, `exec()`, backticks |
| `perl -e` | `system()`, `exec()`, backticks |

The string arguments to these function calls are extracted and analyzed through the same pipeline.

## Allowed Patterns (False Positive Avoidance)

These commands are explicitly NOT blocked despite matching partial patterns:

| Command | Why it is safe |
|---------|---------------|
| `git checkout -b <branch>` | Creates a new branch (not destructive) |
| `git checkout -B <branch>` | Creates/resets branch (intentional) |
| `git checkout --orphan` | Creates orphan branch |
| `git checkout <branch>` | Switches branches (no `--`) |
| `git restore --staged <file>` | Only unstages, does not discard changes |
| `git restore -S <file>` | Short form of `--staged` |
| `git reset --soft` | Moves HEAD only, preserves changes |
| `git reset --mixed` | Default reset, preserves working tree |
| `git reset` (no flags) | Same as `--mixed` |
| `git clean -n` / `--dry-run` | Preview only, no deletion |
| `git push --force-with-lease` | Safe force push with upstream check |
| `git branch -d <branch>` | Safe delete (only merged branches) |
| `git stash push` / `pop` / `apply` / `list` | Non-destructive stash operations |
| `git worktree remove` (no `--force`) | Safe worktree removal |
| `rm -rf node_modules` | Standard cleanup |
| `rm -rf .next` | Standard cleanup |
| `rm -rf dist` | Standard cleanup |
| `rm -rf .turbo` | Standard cleanup |
| `rm -rf /tmp/*` | Temp directory |
| `rm -rf /var/tmp/*` | Temp directory |

## Audit Logging

**Location:** `~/.claude/safety-net.log`

**Format:** One JSON line per blocked command (append-only):

```json
{"timestamp":"2026-02-12T10:30:00Z","command":"git reset --hard HEAD~5","reason":"git reset --hard discards commits permanently","cwd":"/Users/frz/project","version":"1.0.0"}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 UTC timestamp |
| `command` | The blocked command (secrets redacted) |
| `reason` | Human-readable explanation of why it was blocked |
| `cwd` | Working directory at time of invocation |
| `version` | Hook version number |

**Secret redaction:** Before logging, the command is scrubbed of:
- API keys matching `sk-*`, `ghp_*`, `AKIA*`
- Bearer tokens
- Environment variable assignments containing `password`, `secret`, `token`, or `key`

**Log rotation:** Handled by `scripts/session-start.sh` -- rotates at 1MB (same as `sessions.log`, `edits.log`, etc.).

## Limitations

1. **Not a security sandbox.** This is a safety net against accidental damage, not a defense against adversarial input. A determined attacker could bypass regex-based detection.
2. **Regex-based, not AST-parsed.** Interpreter one-liner detection uses pattern matching on known dangerous function calls. Obfuscated code (e.g., `eval`, base64 encoding) is not caught.
3. **Shell quoting edge cases.** Commands with complex nested quoting (escaped quotes, heredocs) may not unwrap correctly.
4. **Fail-open design.** If the script itself errors, the command is allowed (exit 0) rather than blocked. This prevents the hook from breaking the development workflow.
5. **Static deny rules are first line.** The hook complements but does not replace the static `permissions.deny` rules in `settings.json`. Both layers must be maintained.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HOOK_VERSION` | `1.0.0` | Version string included in audit log entries |
| `LOG_FILE` | `~/.claude/safety-net.log` | Path to the audit log file |

Shell wrapper unwrapping has a recursion depth limit of 3 (hardcoded) to prevent infinite loops from pathological nesting.
