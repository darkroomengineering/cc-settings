# Implementation Plan: Safety Net PreToolUse Hook

## Architecture Overview

A bash-based PreToolUse hook (`scripts/safety-net.sh`) that intercepts all Bash tool
invocations and performs deep command analysis to block destructive operations before
they execute. This complements the existing static `deny` rules in `settings.json` by
catching dynamic patterns that static glob matching cannot handle (shell wrappers,
interpreter one-liners, combined flags, `find -delete` chains, etc.).

```
Claude Code -> PreToolUse(Bash) -> safety-net.sh
                                      |
                                      v
                              Extract command from $TOOL_INPUT_command
                                      |
                                      v
                              Run analysis pipeline:
                                1. Unwrap shell wrappers (bash -c, sh -c)
                                2. Unwrap interpreter one-liners (python -c, node -e, etc.)
                                3. Check each unwrapped command against rules:
                                   a. rm -rf destructive paths
                                   b. git destructive operations
                                   c. find/xargs destructive chains
                                      |
                                      v
                              Block? -> exit 2 + JSON reason
                              Allow? -> exit 0 (silent)
```

**Hook output contract**: For PreToolUse hooks, to block a tool invocation, the hook
must output a JSON object `{"decision": "block", "reason": "..."}` and exit with
code 2. To allow, simply exit 0. Any stdout text that is NOT the blocking JSON is
displayed as informational context to the model.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Bash (not TypeScript) | Matches all existing scripts; no build step; jq for JSON |
| Hook placement | Standalone script in `scripts/` | Consistent with `post-edit.sh`, `session-start.sh` |
| Wrapper unwrapping | Regex extraction, recursive | Covers `bash -c`, `sh -c`, nested wrappers |
| Interpreter detection | Regex on `python -c`, `node -e`, etc. | Cannot parse foreign ASTs; match known dangerous calls |
| Audit logging | Append to `~/.claude/safety-net.log` | Follows existing `sessions.log`, `swarm.log` pattern |
| Secret redaction | Strip env var values, API keys from logs | Security best practice |
| Temp dir allowlist | `/tmp/*`, `/var/tmp/*` | Standard safe temp directories |
| Performance target | < 50ms per invocation | Must not slow down interactive use |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| False positives blocking legitimate commands | Medium | High | Allowlist patterns (temp dirs, `--staged`, `-d` vs `-D`), test thoroughly |
| Regex bypasses (creative encoding) | Low | Medium | Defense in depth - static deny rules still apply; this is additive |
| Shell quoting issues in wrapper unwrapping | Medium | Medium | Conservative regex; test with escaped quotes, single/double |
| Performance overhead on every Bash call | Low | Medium | Early exit for non-matching commands; no subprocess spawning where avoidable |
| Hook script not executable after install | Low | High | Setup script must `chmod +x`; document in README |

## Implementation Phases

### Phase 1: Core Script Structure [Effort: Medium]

**File: `/Users/frz/Developer/@darkroom/cc-settings/scripts/safety-net.sh`**

Create the main script with this structure:

```
#!/bin/bash
# Safety Net - PreToolUse Hook for Bash Commands
# Blocks destructive operations that bypass static deny rules.
# Analyzes: git destructive, rm -rf paths, find/xargs chains,
#           shell wrappers (bash -c), interpreter one-liners.

CLAUDE_DIR="${HOME}/.claude"
LOG_FILE="${CLAUDE_DIR}/safety-net.log"
COMMAND="${TOOL_INPUT_command:-}"

# Early exit if no command
[[ -z "$COMMAND" ]] && exit 0

# --- Functions ---
# block_command(reason)    -> outputs JSON, logs, exits 2
# log_blocked(cmd, reason) -> appends to audit log with redaction
# analyze_command(cmd)     -> runs all checks on a single command string
# unwrap_shell(cmd)        -> extracts inner command from bash -c / sh -c
# unwrap_interpreter(cmd)  -> extracts dangerous calls from python -c / node -e / etc.
# check_rm_rf(cmd)         -> detects destructive rm patterns
# check_git_destructive(cmd) -> detects git destructive operations
# check_find_xargs(cmd)   -> detects find -delete, xargs rm, etc.

# --- Main Pipeline ---
# 1. Analyze the raw command
# 2. Unwrap shell wrappers and analyze inner commands
# 3. Check for interpreter one-liners
# 4. Exit 0 if all checks pass
```

### Phase 2: Blocking and Logging Functions [Effort: Low]

- [ ] **`block_command(reason)`**: Output `{"decision": "block", "reason": "$reason"}` to stdout, call `log_blocked`, exit 2
- [ ] **`log_blocked(command, reason)`**: Append timestamped entry to `$LOG_FILE`. Redact patterns matching `sk-*`, `ghp_*`, `AKIA*`, Bearer tokens, and env var assignments with secrets.
- [ ] **`redact_secrets(text)`**: Replace secret-like patterns with `[REDACTED]`

### Phase 3: rm -rf Detection [Effort: Medium]

- [ ] **`check_rm_rf(cmd)`**: Detect `rm` with recursive+force flags in any order

**Patterns to detect:**
```
rm -rf <path>     rm -fr <path>     rm -Rf <path>     rm -rF <path>
rm -r -f <path>   rm -f -r <path>
rm --recursive --force <path>
rm --recursive -f <path>
```

**Always block these paths (after flag extraction):**
```
/         /*        ~         ~/        ~/*
$HOME     $HOME/    $HOME/*   .         ./
..        ../
```

**Allow these paths (explicit safe list):**
```
/tmp/*              /var/tmp/*
node_modules        .next          dist
.turbo              *.tmp
```

**Logic:**
1. Extract the `rm` invocation and its flags
2. Check if flags contain both recursive (`-r`, `-R`, `--recursive`) and force (`-f`, `--force`)
3. If yes, extract the target path(s)
4. Check if any target path matches the block list
5. If target is outside current working directory (`$PWD`) and not in allowlist, block
6. Special case: `rm -rf` with no arguments - block (too dangerous if args are added later)

### Phase 4: Git Destructive Command Detection [Effort: High]

- [ ] **`check_git_destructive(cmd)`**: Detect dangerous git operations

**4a. `git checkout` destructive patterns:**
- Block: `git checkout -- .` or `git checkout -- <file>` (discards uncommitted changes)
- Block: `git checkout --pathspec-from-file`
- Allow: `git checkout -b <branch>`, `git checkout -B <branch>`, `git checkout --orphan`
- Allow: `git checkout <branch-name>` (switching branches)
- Logic: If `--` is present without `-b`/`-B`/`--orphan`, block. Check for bare `--` followed by path.

**4b. `git restore` destructive patterns:**
- Block: `git restore <path>` without `--staged` (discards working tree changes)
- Block: `git restore --worktree <path>` or `git restore -W <path>`
- Allow: `git restore --staged <path>` (only unstages, non-destructive)
- Logic: If command has `git restore` and does NOT contain `--staged` or `-S`, block.

**4c. `git reset` destructive patterns:**
- Block: `git reset --hard` (any args)
- Block: `git reset --merge` (any args)
- Allow: `git reset --soft`, `git reset --mixed`, plain `git reset`

**4d. `git clean` destructive patterns:**
- Block: `git clean -f` (or `-fd`, `-fx`, `-fxd`, any combo with `-f`)
- Allow: `git clean -n` or `git clean --dry-run` (safe preview)
- Logic: If contains `-f`/`--force` but not `-n`/`--dry-run`, block.

**4e. `git push --force` patterns:**
- Block: `git push --force`, `git push -f` (without `--force-with-lease`)
- Allow: `git push --force-with-lease`
- Note: Static deny rules already cover `main`/`master`, but this catches ALL force pushes.

**4f. `git branch -D` patterns:**
- Block: `git branch -D <branch>` (force delete)
- Allow: `git branch -d <branch>` (safe delete, only if merged)

**4g. `git stash` destructive patterns:**
- Block: `git stash drop` (any args)
- Block: `git stash clear`
- Allow: `git stash`, `git stash push`, `git stash pop`, `git stash apply`, `git stash list`

**4h. `git worktree` destructive patterns:**
- Block: `git worktree remove --force`
- Allow: `git worktree remove` (without `--force`)

### Phase 5: find/xargs/parallel Detection [Effort: Medium]

- [ ] **`check_find_xargs(cmd)`**: Detect dangerous file operation chains

**Patterns to detect:**
```
find ... -delete
find ... -exec rm ...
find ... -exec rm -rf ...
xargs rm -rf
xargs rm -r
xargs bash -c ...
xargs sh -c ...
parallel rm ...
```

**Logic:**
1. Check if command starts with or contains `find` followed by `-delete`
2. Check if command contains `find` followed by `-exec` and `rm`
3. Check if command is piped to `xargs rm` or `xargs bash -c`
4. Check for `parallel rm` patterns

### Phase 6: Shell Wrapper Unwrapping [Effort: High]

- [ ] **`unwrap_shell(cmd)`**: Extract inner command from shell wrappers

**Patterns to unwrap:**
```
bash -c '...'       bash -c "..."
sh -c '...'         sh -c "..."
zsh -c '...'
/bin/bash -c '...'  /bin/sh -c '...'
/usr/bin/env bash -c '...'
```

**Logic:**
1. Use regex to detect `(bash|sh|zsh|/bin/bash|/bin/sh) -c` followed by a quoted string
2. Extract the quoted string content (handling both single and double quotes)
3. Recursively call `analyze_command()` on the extracted inner command
4. Handle nested wrappers: `bash -c 'sh -c "git reset --hard"'`
5. Limit recursion depth to 3 to prevent infinite loops

**Edge cases:**
- Commands with escaped quotes inside: `bash -c 'echo "hello'"'"'world"'`
- Multiple commands joined by `;` or `&&` or `||` - split and check each
- Subshell syntax: `$(...)` and backticks - extract and check

### Phase 7: Interpreter One-Liner Detection [Effort: Medium]

- [ ] **`unwrap_interpreter(cmd)`**: Detect dangerous operations in interpreter one-liners

**Patterns to detect:**
```
python -c '...os.system("rm -rf /")...'
python3 -c '...subprocess.run(["rm", ...])...'
node -e '...child_process.execSync("git reset --hard")...'
ruby -e '...system("rm -rf /")...'
perl -e '...system("rm -rf /")...'
```

**Logic:**
1. Detect `(python|python3|node|ruby|perl) (-c|-e)` pattern
2. Extract the code string
3. Search for known dangerous function calls within the code:
   - Python: `os.system(`, `os.popen(`, `subprocess.run(`, `subprocess.call(`, `subprocess.Popen(`
   - Node: `child_process`, `execSync(`, `exec(`, `spawn(`
   - Ruby: `system(`, `exec(`, backticks
   - Perl: `system(`, `exec(`, backticks
4. Extract the string argument to these function calls
5. Run `analyze_command()` on the extracted string

**Limitation**: This is regex-based heuristic matching, not AST parsing. It catches
the common patterns but a determined adversary could bypass it. This is acceptable
because the hook is a safety net against accidental damage, not a security sandbox.

### Phase 8: Multi-Command Splitting [Effort: Low]

- [ ] **`split_and_analyze(cmd)`**: Handle piped and chained commands

Split on these delimiters and analyze each segment:
```
;       (command separator)
&&      (logical AND)
||      (logical OR)
|       (pipe - check right side for xargs/bash/sh)
```

**Logic:**
1. Split command on `;`, `&&`, `||`
2. For pipes (`|`), check if the right side is `xargs`, `bash`, `sh`, or another dangerous receiver
3. Analyze each segment independently via `analyze_command()`

### Phase 9: Audit Logging [Effort: Low]

- [ ] **Log format**: Append-only, one JSON line per blocked command
- [ ] **Fields**: timestamp, command (redacted), reason, cwd, hook_version
- [ ] **Log rotation**: Handled by existing `session-start.sh` - add `safety-net.log` to rotation list

```json
{"ts":"2026-02-12T10:30:00Z","cmd":"git reset --hard HEAD~5","reason":"git reset --hard discards commits permanently","cwd":"/Users/frz/project"}
```

### Phase 10: settings.json Updates [Effort: Low]

- [ ] Add new PreToolUse hook entry for `safety-net.sh`
- [ ] Consolidate/enhance existing deny rules
- [ ] Keep existing git push warning and tsc check hooks (they serve different purposes)

**New hook entry in `settings.json` `hooks.PreToolUse` array:**
```json
{
    "matcher": "Bash",
    "hooks": [
        {
            "type": "command",
            "command": "bash \"$HOME/.claude/scripts/safety-net.sh\""
        }
    ]
}
```

**Position**: FIRST in the PreToolUse array (before git push warning and tsc check),
so destructive commands are blocked before other hooks waste time analyzing them.

**Enhanced deny rules to add to `permissions.deny`:**
```json
"Bash(rm -rf $HOME)",
"Bash(rm -rf $HOME/*)",
"Bash(rm -fr /)",
"Bash(rm -fr /*)",
"Bash(rm -fr ~)",
"Bash(rm -fr ~/*)",
"Bash(git reset --hard:*)",
"Bash(git clean -f:*)",
"Bash(git checkout -- .)"
```

Note: Static deny rules are the first line of defense (cheapest check). The hook script
catches the cases that static pattern matching misses (flags in different order, shell
wrappers, combined flags, etc.).

### Phase 11: Documentation [Effort: Low]

- [ ] Create `/Users/frz/Developer/@darkroom/cc-settings/hooks/safety-net.md` with:
  - Purpose and scope
  - All patterns detected (table format)
  - How to test (example blocked commands)
  - How to add exceptions
  - Audit log location and format
  - Limitations (not a security sandbox)

### Phase 12: Update session-start.sh Log Rotation [Effort: Low]

- [ ] Add `rotate_log "${CLAUDE_DIR}/safety-net.log" &` to the parallel log rotation phase

---

## Detailed Script Structure for `safety-net.sh`

```bash
#!/bin/bash
# safety-net.sh - PreToolUse Hook: Bash Command Safety Analysis
# Blocks destructive operations that bypass static deny rules.
#
# Invoked by Claude Code before every Bash tool execution.
# Environment: $TOOL_INPUT_command contains the command string.
# Output: JSON {"decision":"block","reason":"..."} + exit 2 to block.
#         Silent exit 0 to allow.

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
LOG_FILE="${CLAUDE_DIR}/safety-net.log"
COMMAND="${TOOL_INPUT_command:-}"
MAX_UNWRAP_DEPTH=3
HOOK_VERSION="1.0.0"

# Early exit for empty commands
[[ -z "$COMMAND" ]] && exit 0

# ========================================================================
# Utility Functions
# ========================================================================

block_command() {
    local reason="$1"
    local redacted_cmd
    redacted_cmd=$(redact_secrets "$COMMAND")
    log_blocked "$redacted_cmd" "$reason"
    # Output blocking JSON for Claude Code hook system
    printf '{"decision":"block","reason":"[Safety Net] %s"}\n' "$reason"
    exit 2
}

redact_secrets() {
    local text="$1"
    echo "$text" | sed -E \
        -e 's/(sk-)[a-zA-Z0-9]{10,}/\1[REDACTED]/g' \
        -e 's/(ghp_)[a-zA-Z0-9]{10,}/\1[REDACTED]/g' \
        -e 's/(AKIA)[A-Z0-9]{12,}/\1[REDACTED]/g' \
        -e 's/Bearer [a-zA-Z0-9._-]{10,}/Bearer [REDACTED]/g' \
        -e 's/(password|secret|token|key)=[^ ]*/\1=[REDACTED]/gi'
}

log_blocked() {
    local cmd="$1"
    local reason="$2"
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local cwd
    cwd=$(pwd 2>/dev/null || echo "unknown")
    # Escape for JSON
    cmd=$(echo "$cmd" | sed 's/"/\\"/g' | tr '\n' ' ')
    reason=$(echo "$reason" | sed 's/"/\\"/g')
    printf '{"ts":"%s","cmd":"%s","reason":"%s","cwd":"%s","v":"%s"}\n' \
        "$ts" "$cmd" "$reason" "$cwd" "$HOOK_VERSION" >> "$LOG_FILE" 2>/dev/null || true
}

# ========================================================================
# Detection Functions
# ========================================================================

# check_rm_rf <command_string>
# Returns 0 (allow) or calls block_command (never returns)
check_rm_rf() { ... }

# check_git_destructive <command_string>
check_git_destructive() { ... }

# check_find_xargs <command_string>
check_find_xargs() { ... }

# ========================================================================
# Unwrapping Functions
# ========================================================================

# unwrap_and_analyze <command_string> <depth>
# Extracts inner commands from shell wrappers and interpreter one-liners
unwrap_and_analyze() { ... }

# ========================================================================
# Multi-Command Handling
# ========================================================================

# split_commands <command_string>
# Splits on ; && || and analyzes each part
split_commands() { ... }

# ========================================================================
# Main Analysis
# ========================================================================

# analyze_command <command_string> <depth>
analyze_command() {
    local cmd="$1"
    local depth="${2:-0}"

    # Prevent infinite recursion
    [[ "$depth" -ge "$MAX_UNWRAP_DEPTH" ]] && return 0

    # Direct checks
    check_rm_rf "$cmd"
    check_git_destructive "$cmd"
    check_find_xargs "$cmd"

    # Unwrap and recurse
    unwrap_and_analyze "$cmd" "$depth"
}

# Split into sub-commands and analyze each
split_commands "$COMMAND"

# If we get here, command is safe
exit 0
```

## Regex Patterns Reference

### rm -rf flag detection
```bash
# Match rm with both -r and -f in any combination
echo "$cmd" | grep -qE '^rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|
                                -[a-zA-Z]*f[a-zA-Z]*r|
                                -r\s+-f|-f\s+-r|
                                --recursive\s+--force|
                                --force\s+--recursive|
                                --recursive\s+-f|
                                -f\s+--recursive|
                                -r\s+--force|
                                --force\s+-r)'
```

### git checkout destructive
```bash
# Block: git checkout -- (but not git checkout -b, -B, --orphan)
echo "$cmd" | grep -qE 'git\s+checkout\s+.*--\s' && \
  ! echo "$cmd" | grep -qE 'git\s+checkout\s+(-b|-B|--orphan)'
```

### Shell wrapper extraction
```bash
# Extract inner command from: bash -c 'inner command'
inner=$(echo "$cmd" | sed -nE "s/^(bash|sh|zsh|\/bin\/(ba)?sh)\s+-c\s+'([^']+)'.*/\3/p")
# Also handle double quotes
[[ -z "$inner" ]] && inner=$(echo "$cmd" | sed -nE 's/^(bash|sh|zsh|\/bin\/(ba)?sh)\s+-c\s+"([^"]+)".*/\3/p')
```

### Interpreter one-liner extraction
```bash
# Python: extract system/subprocess calls
echo "$cmd" | grep -qE 'python[23]?\s+-c' && \
  echo "$cmd" | grep -qoE "(os\.system|subprocess\.(run|call|Popen)|os\.popen)\(['\"]([^'\"]+)" | \
  while read -r match; do
    inner=$(echo "$match" | grep -oE "['\"]([^'\"]+)" | tr -d "'" | tr -d '"')
    analyze_command "$inner" $((depth + 1))
  done
```

## Gap Analysis: What Static Deny Rules Already Cover vs What the Hook Adds

| Pattern | Covered by deny rules? | Covered by hook? | Notes |
|---------|----------------------|-----------------|-------|
| `rm -rf /` | Yes | Yes | Redundant but defense-in-depth |
| `rm -fr /` | No | Yes | Flag order variant |
| `rm -r -f /` | No | Yes | Split flags |
| `git push --force origin main` | Yes | Yes | Hook also catches other branches |
| `git push -f` (any branch) | Partial (main/master) | Yes | Hook catches all force pushes |
| `git reset --hard` | No | Yes | NEW protection |
| `git checkout -- .` | No | Yes | NEW protection |
| `git clean -f` | No | Yes | NEW protection |
| `git restore` (destructive) | No | Yes | NEW protection |
| `git branch -D` | No | Yes | NEW protection |
| `git stash drop/clear` | No | Yes | NEW protection |
| `bash -c 'rm -rf /'` | No | Yes | Shell wrapper unwrapping |
| `python -c 'os.system(...)'` | No | Yes | Interpreter detection |
| `find . -delete` | No | Yes | NEW protection |
| `xargs rm -rf` | No | Yes | NEW protection |
| `sudo` | Yes (static) | No | Static deny is sufficient |
| `chmod 777` | Yes (static) | No | Static deny is sufficient |

## Non-Functional Considerations

### Performance
- Target: < 50ms per invocation (bash string matching is fast)
- No subprocess spawning for the common case (safe commands)
- Early exits: if command doesn't contain `rm`, `git`, `find`, `xargs`, `bash -c`, etc., skip all checks
- jq is NOT needed (no JSON parsing of input - we use `$TOOL_INPUT_command` env var directly)

### Reliability
- `set -euo pipefail` for fail-fast
- Graceful degradation: if the script errors, it should NOT block (fail-open)
- Wrap main logic in a trap so unexpected errors exit 0 (allow) rather than blocking work
- Log errors to `safety-net.log` for debugging

### Maintainability
- Each detection category in its own function
- Clear comments with examples of what each pattern catches
- Version number in script for tracking
- Patterns are data-like (easy to add new ones)

### Testing Strategy
- Create `tests/safety-net-test.sh` that runs the script with various `$TOOL_INPUT_command` values
- Test matrix: ~40 cases covering all categories (block + allow)
- Test categories: rm-rf (15 cases), git (15 cases), find/xargs (5 cases), wrappers (5 cases)

## Files to Create/Modify

| File | Action | Effort |
|------|--------|--------|
| `scripts/safety-net.sh` | CREATE | High |
| `settings.json` | MODIFY (add hook entry + enhanced deny rules) | Low |
| `hooks/safety-net.md` | CREATE | Low |
| `scripts/session-start.sh` | MODIFY (add log rotation for safety-net.log) | Low |
| `tests/safety-net-test.sh` | CREATE | Medium |

## Parallelization Opportunities

These can be implemented simultaneously by different agents:

**Stream A**: `scripts/safety-net.sh` (core script - the bulk of the work)
**Stream B**: `hooks/safety-net.md` (documentation) + `settings.json` updates
**Stream C**: `tests/safety-net-test.sh` (test harness)

Stream B and C can start in parallel. Stream A is the critical path.

## Success Criteria

- [ ] `safety-net.sh` blocks all patterns listed in Phase 3-7
- [ ] `safety-net.sh` does NOT false-positive on: `git checkout main`, `git checkout -b feature`, `rm -rf node_modules`, `rm -rf .next`, `git push origin main`, `git branch -d merged-branch`, `git restore --staged file.ts`, `git clean -n`
- [ ] Script executes in < 50ms for common (non-blocked) commands
- [ ] Blocked commands are logged to `~/.claude/safety-net.log`
- [ ] Secrets are redacted in logs
- [ ] Shell wrapper unwrapping catches `bash -c 'git reset --hard'`
- [ ] Interpreter detection catches `python -c 'os.system("rm -rf /")'`
- [ ] settings.json hook is registered and fires before other PreToolUse hooks
- [ ] Script is fail-open (errors in the script itself do not block commands)
- [ ] All tests in `tests/safety-net-test.sh` pass
