#!/usr/bin/env bash
# Safety Net - PreToolUse hook that blocks destructive Bash commands
# Exit 0 = ALLOW (silent), Exit 2 + JSON = BLOCK
#
# Design: fail-open. Any error in this script allows the command through.
# Only exit 2 (intentional block) propagates; all other failures -> exit 0.

set -euo pipefail

HOOK_VERSION="1.0.0"

LOG_FILE="${HOME}/.claude/safety-net.log"

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

redact_secrets() {
  local text="$1"
  text=$(echo "$text" | sed -E \
    -e 's/sk-[A-Za-z0-9_-]{10,}/[REDACTED]/g' \
    -e 's/ghp_[A-Za-z0-9]{10,}/[REDACTED]/g' \
    -e 's/AKIA[A-Z0-9]{12,}/[REDACTED]/g' \
    -e 's/Bearer [A-Za-z0-9._-]+/Bearer [REDACTED]/g' \
    -e 's/password=[^ &"]+/password=[REDACTED]/g' \
    -e 's/token=[^ &"]+/token=[REDACTED]/g' \
    -e 's/secret=[^ &"]+/secret=[REDACTED]/g' \
  )
  echo "$text"
}

log_blocked() {
  local cmd="$1"
  local reason="$2"
  local redacted
  redacted=$(redact_secrets "$cmd")
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
  local cwd
  cwd="${PWD:-unknown}"

  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

  local escaped_cmd
  escaped_cmd=$(echo "$redacted" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
  local escaped_reason
  escaped_reason=$(echo "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g')
  local escaped_cwd
  escaped_cwd=$(echo "$cwd" | sed 's/\\/\\\\/g; s/"/\\"/g')

  echo "{\"timestamp\":\"${timestamp}\",\"command\":\"${escaped_cmd}\",\"reason\":\"${escaped_reason}\",\"cwd\":\"${escaped_cwd}\",\"version\":\"${HOOK_VERSION}\"}" \
    >> "$LOG_FILE" 2>/dev/null || true
}

block_command() {
  local reason="$1"
  local cmd="${2:-}"
  [[ -n "$cmd" ]] && log_blocked "$cmd" "$reason"

  local escaped_reason
  escaped_reason=$(echo "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g')
  echo "{\"decision\":\"block\",\"reason\":\"[Safety Net] ${escaped_reason}\"}"
  exit 2
}

# ---------------------------------------------------------------------------
# 2. check_rm_rf - Detect destructive rm operations
# ---------------------------------------------------------------------------

# Helper: extract target paths from rm arguments by stripping all option flags
extract_rm_target() {
  local args="$1"
  local result=""

  for token in $args; do
    case "$token" in
      -[a-zA-Z]*)       continue ;;  # Short flags (-rf, -r, -f, etc.)
      --recursive|--force|--interactive|--one-file-system) continue ;;
      --no-preserve-root|--preserve-root|--verbose) continue ;;
      --interactive=*)   continue ;;
      *)                 result="$token" ;;  # Target path
    esac
  done

  echo "$result"
}

check_rm_rf() {
  local cmd="$1"

  # Must contain 'rm' to be relevant
  if ! echo "$cmd" | grep -qE '(^|\s)rm\s'; then
    return 0
  fi

  # Extract everything after 'rm' up to command separators
  local rm_portion
  rm_portion=$(echo "$cmd" | grep -oE '(^|\s)rm\s+[^;&|]+' | head -1 | sed 's/^[[:space:]]*rm[[:space:]]*//')

  local has_recursive=false
  local has_force=false

  # Check for recursive flag (combined or separate short flags, or long flag)
  if echo " $rm_portion" | grep -qE '\s-[a-zA-Z]*[rR]'; then
    has_recursive=true
  fi
  if echo " $rm_portion" | grep -qE '\s--recursive(\s|$)'; then
    has_recursive=true
  fi

  # Check for force flag
  if echo " $rm_portion" | grep -qE '\s-[a-zA-Z]*[fF]'; then
    has_force=true
  fi
  if echo " $rm_portion" | grep -qE '\s--force(\s|$)'; then
    has_force=true
  fi

  # Only block when BOTH recursive and force are present
  if [[ "$has_recursive" != true ]] || [[ "$has_force" != true ]]; then
    return 0
  fi

  # Extract the actual target path (strip all flags)
  local target
  target=$(extract_rm_target "$rm_portion")

  # If we couldn't find a target, be safe and block
  if [[ -z "$target" ]]; then
    block_command "rm -rf with no clear target path" "$cmd"
  fi

  # --- ALWAYS BLOCK: dangerous root/home/cwd paths ---
  case "$target" in
    /|/\*)
      block_command "rm -rf targeting root filesystem" "$cmd"
      ;;
    '~'|'~/'|'~/*')
      block_command "rm -rf targeting home directory" "$cmd"
      ;;
    '.'|'./')
      block_command "rm -rf targeting current directory" "$cmd"
      ;;
    '..'|'../')
      block_command "rm -rf targeting parent directory" "$cmd"
      ;;
    '$HOME'|'$HOME/'|'$HOME/*'|'${HOME}'|'${HOME}/'|'${HOME}/*')
      block_command "rm -rf targeting home directory" "$cmd"
      ;;
  esac

  # --- ALLOW: safe temp directories ---
  case "$target" in
    /tmp/*|/var/tmp/*)
      return 0
      ;;
  esac

  # --- ALLOW: known build artifact directories ---
  local base
  base=$(basename "$target" 2>/dev/null || echo "$target")
  case "$base" in
    node_modules|.next|dist|.turbo|build|.cache|__pycache__|.pytest_cache|coverage)
      return 0
      ;;
  esac

  # --- ALLOW: absolute paths under PWD ---
  if [[ -n "${PWD:-}" ]] && [[ "$target" == "${PWD}/"* ]]; then
    return 0
  fi

  # --- ALLOW: relative paths that stay within the project ---
  # (no leading /, ~, $HOME, no .. components)
  if [[ "$target" != /* ]] && [[ "$target" != '~'* ]] && \
     [[ "$target" != '$HOME'* ]] && [[ "$target" != '${HOME}'* ]] && \
     [[ "$target" != '.' ]] && [[ "$target" != './' ]] && \
     [[ "$target" != '..' ]] && [[ "$target" != '../' ]] && \
     [[ "$target" != *'../'* ]]; then
    return 0
  fi

  # --- DEFAULT: block anything else ---
  block_command "rm -rf with unrecognized target path: ${target}" "$cmd"
}

# ---------------------------------------------------------------------------
# 3. check_git_destructive - Block dangerous git operations
# ---------------------------------------------------------------------------

check_git_destructive() {
  local cmd="$1"

  # Must contain 'git' to be relevant
  if ! echo "$cmd" | grep -qE '(^|\s)git\s'; then
    return 0
  fi

  # Extract everything from 'git' onward
  local git_rest
  git_rest=$(echo "$cmd" | grep -oE 'git\s+.*' | head -1 | sed 's/^git[[:space:]]*//')
  [[ -z "$git_rest" ]] && return 0

  # Skip global options: -C <path>, -c <key=value>, --git-dir, --work-tree, etc.
  while true; do
    case "$git_rest" in
      -C\ *|-c\ *)
        git_rest=$(echo "$git_rest" | sed -E 's/^-[Cc][[:space:]]+[^[:space:]]+[[:space:]]*//')
        ;;
      --git-dir=*|--work-tree=*)
        git_rest=$(echo "$git_rest" | sed -E 's/^--[a-z-]+=[^[:space:]]+[[:space:]]*//')
        ;;
      --git-dir\ *|--work-tree\ *)
        git_rest=$(echo "$git_rest" | sed -E 's/^--[a-z-]+[[:space:]]+[^[:space:]]+[[:space:]]*//')
        ;;
      --bare|--no-pager|--no-replace-objects)
        git_rest=$(echo "$git_rest" | sed -E 's/^[^[:space:]]+[[:space:]]*//')
        ;;
      *)
        break
        ;;
    esac
  done

  # Parse subcommand and its arguments
  local subcmd
  subcmd=$(echo "$git_rest" | awk '{print $1}')
  [[ -z "$subcmd" ]] && return 0
  local subargs
  subargs=$(echo "$git_rest" | sed "s/^${subcmd}//" | sed 's/^[[:space:]]*//')

  case "$subcmd" in

    # --- a. git checkout ---
    checkout)
      # ALLOW: branch creation / orphan
      case "$subargs" in
        -b\ *|-B\ *|--orphan\ *) return 0 ;;
      esac
      # BLOCK: git checkout -- <anything> (discards changes)
      if echo " $subargs " | grep -qE '[[:space:]]--[[:space:]]'; then
        block_command "git checkout -- discards uncommitted changes" "$cmd"
      fi
      # BLOCK: git checkout --pathspec-from-file
      if echo "$subargs" | grep -qF -- '--pathspec-from-file'; then
        block_command "git checkout --pathspec-from-file discards uncommitted changes" "$cmd"
      fi
      return 0
      ;;

    # --- b. git restore ---
    restore)
      # Check for --staged / -S first
      if echo " $subargs " | grep -qE '(--staged|-S)([[:space:]]|$)'; then
        # Block if also has --worktree or -W
        if echo " $subargs " | grep -qE '(--worktree|-W)([[:space:]]|$)'; then
          block_command "git restore --worktree discards working tree changes" "$cmd"
        fi
        return 0
      fi
      # BLOCK: --worktree or -W explicitly
      if echo " $subargs " | grep -qE '(--worktree|-W)([[:space:]]|$)'; then
        block_command "git restore --worktree discards working tree changes" "$cmd"
      fi
      # BLOCK: git restore <path> without --staged (restores working tree by default)
      if [[ -n "$subargs" ]]; then
        block_command "git restore without --staged discards working tree changes" "$cmd"
      fi
      return 0
      ;;

    # --- c. git reset ---
    reset)
      if echo " $subargs " | grep -qE '(^|[[:space:]])--hard([[:space:]]|$)'; then
        block_command "git reset --hard discards all uncommitted changes" "$cmd"
      fi
      if echo " $subargs " | grep -qE '(^|[[:space:]])--merge([[:space:]]|$)'; then
        block_command "git reset --merge can discard uncommitted changes" "$cmd"
      fi
      return 0
      ;;

    # --- d. git clean ---
    clean)
      # ALLOW if --dry-run / -n is present
      if echo " $subargs " | grep -qE '(-n|--dry-run)'; then
        return 0
      fi
      # BLOCK if -f / --force without dry-run
      if echo " $subargs " | grep -qE '(-[a-zA-Z]*f|--force)'; then
        block_command "git clean -f permanently deletes untracked files" "$cmd"
      fi
      return 0
      ;;

    # --- e. git push ---
    push)
      # ALLOW: --force-with-lease (safe force push)
      if echo "$subargs" | grep -qF -- '--force-with-lease'; then
        return 0
      fi
      # BLOCK: --force or -f
      if echo " $subargs " | grep -qE '[[:space:]](--force|-f)[[:space:]]'; then
        block_command "git push --force can overwrite remote history" "$cmd"
      fi
      # Also check if --force/-f is at the end of string
      if echo "$subargs" | grep -qE '(--force|-f)$'; then
        block_command "git push --force can overwrite remote history" "$cmd"
      fi
      return 0
      ;;

    # --- f. git branch ---
    branch)
      if echo " $subargs " | grep -qE '[[:space:]]-D[[:space:]]'; then
        block_command "git branch -D force-deletes branch without merge check" "$cmd"
      fi
      if echo "$subargs" | grep -qE '(^|\s)-D$'; then
        block_command "git branch -D force-deletes branch without merge check" "$cmd"
      fi
      return 0
      ;;

    # --- g. git stash ---
    stash)
      local stash_action
      stash_action=$(echo "$subargs" | awk '{print $1}')
      case "$stash_action" in
        drop) block_command "git stash drop permanently deletes stashed changes" "$cmd" ;;
        clear) block_command "git stash clear permanently deletes all stashed changes" "$cmd" ;;
      esac
      return 0
      ;;

    # --- h. git worktree ---
    worktree)
      if echo "$subargs" | grep -qE 'remove[[:space:]]+.*(--force|-f)'; then
        block_command "git worktree remove --force can discard changes" "$cmd"
      fi
      return 0
      ;;
  esac

  return 0
}

# ---------------------------------------------------------------------------
# 4. check_find_xargs - Detect dangerous file operation chains
# ---------------------------------------------------------------------------

check_find_xargs() {
  local cmd="$1"

  # find ... -delete
  if echo "$cmd" | grep -qE 'find[[:space:]]+.*-delete'; then
    block_command "find -delete permanently removes files" "$cmd"
  fi

  # find ... -exec rm / -execdir rm
  if echo "$cmd" | grep -qE 'find[[:space:]]+.*-exec(dir)?[[:space:]]+rm'; then
    block_command "find -exec rm permanently removes files" "$cmd"
  fi

  # xargs rm -rf / xargs rm -r (with or without other args between xargs and rm)
  if echo "$cmd" | grep -qE 'xargs[[:space:]]+(.*[[:space:]])?rm[[:space:]]+.*-[a-zA-Z]*r'; then
    block_command "xargs rm -r is a bulk destructive operation" "$cmd"
  fi

  # xargs bash -c / xargs sh -c
  if echo "$cmd" | grep -qE 'xargs[[:space:]]+(.*[[:space:]])?(bash|sh)[[:space:]]+-c'; then
    block_command "xargs with shell -c enables arbitrary command execution" "$cmd"
  fi

  return 0
}

# ---------------------------------------------------------------------------
# 5. unwrap_and_analyze - Shell wrapper recursion (max depth 3)
# ---------------------------------------------------------------------------

unwrap_and_analyze() {
  local cmd="$1"
  local depth="${2:-0}"

  if (( depth >= 3 )); then
    return 0
  fi

  # Detect: bash -c, sh -c, zsh -c (also with full paths)
  if ! echo "$cmd" | grep -qE '(bash|/bash|sh|/sh|zsh|/zsh)[[:space:]]+-c[[:space:]]'; then
    return 0
  fi

  local inner=""

  # Try single quotes: ... -c 'inner command'
  inner=$(echo "$cmd" | sed -nE "s/.*-c[[:space:]]+'([^']+)'.*/\1/p" | head -1)
  if [[ -z "$inner" ]]; then
    # Try double quotes: ... -c "inner command"
    inner=$(echo "$cmd" | sed -nE 's/.*-c[[:space:]]+"([^"]+)".*/\1/p' | head -1)
  fi
  if [[ -z "$inner" ]]; then
    # Try unquoted (take until end or separator)
    inner=$(echo "$cmd" | sed -nE "s/.*-c[[:space:]]+([^;&|\"']+).*/\1/p" | head -1)
  fi

  if [[ -n "$inner" ]]; then
    analyze_command "$inner" $((depth + 1))
  fi

  return 0
}

# ---------------------------------------------------------------------------
# 6. check_interpreter_oneliners - Detect dangerous interpreter invocations
# ---------------------------------------------------------------------------

check_interpreter_oneliners() {
  local cmd="$1"
  local depth="${2:-0}"

  if ! echo "$cmd" | grep -qE '(python3?|node|ruby|perl)[[:space:]]+-[ec][[:space:]]'; then
    return 0
  fi

  local dangerous_calls='(os\.system\(|subprocess\.|child_process|execSync\(|system\(|exec\(|popen\(|spawn\()'
  if ! echo "$cmd" | grep -qE "$dangerous_calls"; then
    return 0
  fi

  # Extract the inner command from the dangerous call
  local inner_cmd=""
  inner_cmd=$(echo "$cmd" | sed -nE "s/.*(os\.system|subprocess\.(run|call|Popen)|execSync)\(['\"]([^'\"]+)['\"].*/\3/p" | head -1)

  if [[ -n "$inner_cmd" ]] && (( depth < 3 )); then
    analyze_command "$inner_cmd" $((depth + 1))
  fi

  return 0
}

# ---------------------------------------------------------------------------
# 7. split_commands - Handle multi-command strings
# ---------------------------------------------------------------------------

split_commands() {
  local cmd="$1"

  # Check for pipe to xargs (special case - check the full pipeline)
  if echo "$cmd" | grep -qE '\|[[:space:]]*xargs[[:space:]]'; then
    check_find_xargs "$cmd"
  fi

  # Analyze the full command first for patterns that span separators
  # (e.g., python -c 'import os; os.system(...)' where ; is inside quotes)
  unwrap_and_analyze "$cmd" 0
  check_interpreter_oneliners "$cmd" 0

  # Split on ; && || and analyze each segment
  local segments
  segments=$(echo "$cmd" | sed -E 's/[[:space:]]*(&&|\|\||;)[[:space:]]*/\n/g')

  while IFS= read -r segment; do
    # Trim whitespace
    segment="${segment#"${segment%%[![:space:]]*}"}"
    segment="${segment%"${segment##*[![:space:]]}"}"
    [[ -z "$segment" ]] && continue
    analyze_command "$segment" 0
  done <<< "$segments"
}

# ---------------------------------------------------------------------------
# Core analysis function
# ---------------------------------------------------------------------------

analyze_command() {
  local cmd="$1"
  local depth="${2:-0}"

  check_rm_rf "$cmd"
  check_git_destructive "$cmd"
  check_find_xargs "$cmd"
  unwrap_and_analyze "$cmd" "$depth"
  check_interpreter_oneliners "$cmd" "$depth"
}

# ---------------------------------------------------------------------------
# 8. Main - fail-open wrapper
# ---------------------------------------------------------------------------

main() {
  COMMAND="${TOOL_INPUT_command:-}"
  [[ -z "$COMMAND" ]] && exit 0

  # Fast path: skip analysis for commands that can't be dangerous
  if ! echo "$COMMAND" | grep -qE '\b(rm|git|find|xargs|bash|sh|zsh|python|python3|node|ruby|perl)\b'; then
    exit 0
  fi

  split_commands "$COMMAND"
  exit 0
}

# Fail-open wrapper: run main, preserve exit 2 (block), convert all other
# non-zero exits (unexpected errors) to exit 0 (allow).
# Disable set -e so we can capture the exit code from the subshell.
set +e
(
  set -euo pipefail
  main
)
_rc=$?
if [[ $_rc -eq 2 ]]; then
  exit 2
fi
exit 0
