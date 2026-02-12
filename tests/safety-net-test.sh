#!/usr/bin/env bash
# Test harness for safety-net.sh PreToolUse hook
#
# Runs ~60 test cases verifying that dangerous commands are BLOCKED
# and safe commands are ALLOWED by the safety-net hook.
#
# Usage: bash tests/safety-net-test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAFETY_NET="${SCRIPT_DIR}/scripts/safety-net.sh"

PASS=0
FAIL=0
TOTAL=0

# Colors (if terminal supports them)
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    BOLD='\033[1m'
    DIM='\033[2m'
    RESET='\033[0m'
else
    GREEN=''
    RED=''
    BOLD=''
    DIM=''
    RESET=''
fi

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

section() {
    printf -- "${BOLD}%s${RESET}\n" "$1"
}

# Expect command to be BLOCKED (exit code 2)
expect_block() {
    local desc="$1"
    local cmd="$2"
    TOTAL=$((TOTAL + 1))
    local output
    output=$(TOOL_INPUT_command="$cmd" bash "$SAFETY_NET" 2>/dev/null)
    local exit_code=$?
    if [[ $exit_code -eq 2 ]]; then
        PASS=$((PASS + 1))
        printf "  ${GREEN}PASS${RESET}: %s\n" "$desc"
    else
        FAIL=$((FAIL + 1))
        printf "  ${RED}FAIL${RESET}: %s (expected block, got exit %d)\n" "$desc" "$exit_code"
        if [[ -n "$output" ]]; then
            printf "        ${DIM}output: %s${RESET}\n" "$output"
        fi
    fi
}

# Expect command to be ALLOWED (exit code 0)
expect_allow() {
    local desc="$1"
    local cmd="$2"
    TOTAL=$((TOTAL + 1))
    local output
    output=$(TOOL_INPUT_command="$cmd" bash "$SAFETY_NET" 2>/dev/null)
    local exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
        PASS=$((PASS + 1))
        printf "  ${GREEN}PASS${RESET}: %s\n" "$desc"
    else
        FAIL=$((FAIL + 1))
        printf "  ${RED}FAIL${RESET}: %s (expected allow, got exit %d)\n" "$desc" "$exit_code"
        if [[ -n "$output" ]]; then
            printf "        ${DIM}output: %s${RESET}\n" "$output"
        fi
    fi
}

# ---------------------------------------------------------------------------
# Verify the script exists
# ---------------------------------------------------------------------------

if [[ ! -f "$SAFETY_NET" ]]; then
    printf "ERROR: safety-net.sh not found at %s\n" "$SAFETY_NET"
    exit 1
fi

printf -- "${BOLD}Safety Net Test Harness${RESET}\n"
printf "Script: %s\n\n" "$SAFETY_NET"

# =========================================================================
# rm -rf tests (BLOCK)
# =========================================================================

section "--- rm -rf dangerous targets (expect BLOCK) ---"

expect_block "rm -rf / (root)" \
    "rm -rf /"

expect_block "rm -rf /* (root wildcard)" \
    "rm -rf /*"

expect_block "rm -rf ~ (home)" \
    "rm -rf ~"

expect_block "rm -rf ~/ (home trailing slash)" \
    "rm -rf ~/"

expect_block "rm -rf ~/* (home wildcard)" \
    "rm -rf ~/*"

expect_block "rm -fr / (flag reorder)" \
    "rm -fr /"

expect_block "rm -Rf / (capital R)" \
    "rm -Rf /"

expect_block "rm -r -f / (split flags)" \
    "rm -r -f /"

expect_block "rm -f -r / (split flags reverse)" \
    "rm -f -r /"

expect_block "rm --recursive --force / (long flags)" \
    "rm --recursive --force /"

expect_block 'rm -rf . (current dir)' \
    "rm -rf ."

expect_block 'rm -rf .. (parent dir)' \
    "rm -rf .."

expect_block 'rm -rf $HOME (HOME variable)' \
    'rm -rf $HOME'

printf "\n"

# =========================================================================
# rm -rf tests (ALLOW)
# =========================================================================

section "--- rm -rf safe targets (expect ALLOW) ---"

expect_allow "rm -rf node_modules (build artifact)" \
    "rm -rf node_modules"

expect_allow "rm -rf .next (build artifact)" \
    "rm -rf .next"

expect_allow "rm -rf dist (build artifact)" \
    "rm -rf dist"

expect_allow "rm -rf /tmp/test (temp dir)" \
    "rm -rf /tmp/test"

expect_allow "rm -rf /var/tmp/build (var temp)" \
    "rm -rf /var/tmp/build"

expect_allow "rm -r mydir (recursive without force)" \
    "rm -r mydir"

expect_allow "rm -f myfile (force without recursive)" \
    "rm -f myfile"

printf "\n"

# =========================================================================
# git destructive tests (BLOCK)
# =========================================================================

section "--- git destructive operations (expect BLOCK) ---"

expect_block "git checkout -- . (discard all changes)" \
    "git checkout -- ."

expect_block "git checkout -- src/file.ts (discard specific file)" \
    "git checkout -- src/file.ts"

expect_block "git reset --hard (hard reset)" \
    "git reset --hard"

expect_block "git reset --hard HEAD~3 (hard reset with ref)" \
    "git reset --hard HEAD~3"

expect_block "git clean -f (force clean)" \
    "git clean -f"

expect_block "git clean -fd (force clean with dirs)" \
    "git clean -fd"

expect_block "git push --force (force push)" \
    "git push --force"

expect_block "git push -f origin main (force push with remote)" \
    "git push -f origin main"

expect_block "git branch -D feature (force delete branch)" \
    "git branch -D feature"

expect_block "git stash drop (drop stash)" \
    "git stash drop"

expect_block "git stash clear (clear all stashes)" \
    "git stash clear"

expect_block "git restore src/file.ts (restore without --staged)" \
    "git restore src/file.ts"

printf "\n"

# =========================================================================
# git safe tests (ALLOW)
# =========================================================================

section "--- git safe operations (expect ALLOW) ---"

expect_allow "git checkout main (switch branch)" \
    "git checkout main"

expect_allow "git checkout -b new-feature (create branch)" \
    "git checkout -b new-feature"

expect_allow "git checkout -B new-feature (force create branch)" \
    "git checkout -B new-feature"

expect_allow "git push origin main (normal push)" \
    "git push origin main"

expect_allow "git push --force-with-lease (safe force push)" \
    "git push --force-with-lease"

expect_allow "git branch -d merged-branch (safe delete)" \
    "git branch -d merged-branch"

expect_allow "git stash (stash changes)" \
    "git stash"

expect_allow "git stash pop (pop stash)" \
    "git stash pop"

expect_allow "git restore --staged src/file.ts (unstage)" \
    "git restore --staged src/file.ts"

expect_allow "git clean -n (dry run)" \
    "git clean -n"

expect_allow "git reset --soft HEAD~1 (soft reset)" \
    "git reset --soft HEAD~1"

printf "\n"

# =========================================================================
# find / xargs tests (BLOCK)
# =========================================================================

section "--- find/xargs destructive operations (expect BLOCK) ---"

expect_block 'find . -name "*.log" -delete (find delete)' \
    'find . -name "*.log" -delete'

expect_block 'find /tmp -exec rm -rf {} ; (find exec rm)' \
    'find /tmp -exec rm -rf {} ;'

expect_block "ls | xargs rm -rf (xargs rm)" \
    "ls | xargs rm -rf"

printf "\n"

# =========================================================================
# Shell wrapper tests (BLOCK)
# =========================================================================

section "--- shell wrappers with dangerous commands (expect BLOCK) ---"

expect_block "bash -c 'rm -rf /' (wrapped rm)" \
    "bash -c 'rm -rf /'"

expect_block "sh -c 'git reset --hard' (wrapped git)" \
    "sh -c 'git reset --hard'"

expect_block 'bash -c "git checkout -- ." (double quotes)' \
    'bash -c "git checkout -- ."'

printf "\n"

# =========================================================================
# Shell wrapper tests (ALLOW)
# =========================================================================

section "--- shell wrappers with safe commands (expect ALLOW) ---"

expect_allow "bash -c 'echo hello' (safe wrapped command)" \
    "bash -c 'echo hello'"

expect_allow "sh -c 'ls -la' (safe wrapped ls)" \
    "sh -c 'ls -la'"

printf "\n"

# =========================================================================
# Interpreter tests (BLOCK)
# =========================================================================

section "--- interpreter-wrapped dangerous commands (expect BLOCK) ---"

expect_block 'python -c with os.system rm -rf (python shell exec)' \
    "python -c 'import os; os.system(\"rm -rf /\")'"

expect_block 'node -e with execSync git reset --hard (node shell exec)' \
    'node -e '\''require("child_process").execSync("git reset --hard")'\'''

printf "\n"

# =========================================================================
# Multi-command tests (BLOCK)
# =========================================================================

section "--- multi-command chains with dangerous commands (expect BLOCK) ---"

expect_block "echo hello && rm -rf / (chained dangerous)" \
    "echo hello && rm -rf /"

expect_block "ls; git reset --hard (semicolon chain)" \
    "ls; git reset --hard"

printf "\n"

# =========================================================================
# Multi-command tests (ALLOW)
# =========================================================================

section "--- multi-command chains with safe commands (expect ALLOW) ---"

expect_allow "echo hello && echo world (safe chain)" \
    "echo hello && echo world"

expect_allow "git status && git log --oneline (safe git chain)" \
    "git status && git log --oneline"

printf "\n"

# =========================================================================
# Edge cases (ALLOW)
# =========================================================================

section "--- edge cases (expect ALLOW) ---"

expect_allow "empty command" \
    ""

expect_allow "ls -la (simple safe command)" \
    "ls -la"

expect_allow "npm install (package install)" \
    "npm install"

printf "\n"

# =========================================================================
# Summary
# =========================================================================

printf "========================================\n"
if [[ $FAIL -eq 0 ]]; then
    printf -- "${GREEN}${BOLD}All %d/%d tests passed${RESET}\n" "$PASS" "$TOTAL"
else
    printf -- "${RED}${BOLD}%d/%d tests passed (%d failed)${RESET}\n" "$PASS" "$TOTAL" "$FAIL"
fi
printf "========================================\n"

# Exit with failure if any test failed
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
