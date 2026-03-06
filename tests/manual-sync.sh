#!/usr/bin/env bash
# Drift detection: ensures MANUAL.md stays in sync with actual skills, agents, and hooks.
#
# Usage: bash tests/manual-sync.sh
#
# Checks:
# 1. Every skill directory with SKILL.md is mentioned in MANUAL.md
# 2. Every agent .md file is mentioned in MANUAL.md
# 3. Every hook event in settings.json is mentioned in MANUAL.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANUAL="${SCRIPT_DIR}/MANUAL.md"

PASS=0
FAIL=0
TOTAL=0

# Colors
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    BOLD='\033[1m'
    DIM='\033[2m'
    RESET='\033[0m'
else
    GREEN='' RED='' BOLD='' DIM='' RESET=''
fi

check() {
    local desc="$1"
    local result="$2"
    TOTAL=$((TOTAL + 1))
    if [[ "$result" == "pass" ]]; then
        PASS=$((PASS + 1))
        printf "${GREEN}  PASS${RESET} %s\n" "$desc"
    else
        FAIL=$((FAIL + 1))
        printf "${RED}  FAIL${RESET} %s\n" "$desc"
    fi
}

# ─── Preflight ────────────────────────────────────────────────────────────────

if [[ ! -f "$MANUAL" ]]; then
    echo "ERROR: MANUAL.md not found at $MANUAL"
    exit 1
fi

MANUAL_CONTENT=$(cat "$MANUAL")

# ─── Skills ───────────────────────────────────────────────────────────────────

echo ""
echo "${BOLD}Skills${RESET}"
echo ""

for skill_dir in "${SCRIPT_DIR}"/skills/*/; do
    [[ -f "${skill_dir}SKILL.md" ]] || continue
    skill_name=$(basename "$skill_dir")

    # Check if skill name appears in MANUAL.md (as backtick-quoted or in a table)
    if echo "$MANUAL_CONTENT" | grep -q "\`${skill_name}\`"; then
        check "Skill '${skill_name}' documented in MANUAL.md" "pass"
    else
        check "Skill '${skill_name}' documented in MANUAL.md" "fail"
    fi
done

# ─── Agents ───────────────────────────────────────────────────────────────────

echo ""
echo "${BOLD}Agents${RESET}"
echo ""

for agent_file in "${SCRIPT_DIR}"/agents/*.md; do
    [[ -f "$agent_file" ]] || continue
    agent_name=$(basename "$agent_file" .md)

    if echo "$MANUAL_CONTENT" | grep -q "\`${agent_name}\`"; then
        check "Agent '${agent_name}' documented in MANUAL.md" "pass"
    else
        check "Agent '${agent_name}' documented in MANUAL.md" "fail"
    fi
done

# ─── Hook Events ──────────────────────────────────────────────────────────────

echo ""
echo "${BOLD}Hook Events${RESET}"
echo ""

SETTINGS="${SCRIPT_DIR}/settings.json"
if [[ -f "$SETTINGS" ]]; then
    # Extract hook event names from settings.json
    hook_events=$(grep -oE '"(SessionStart|SessionEnd|UserPromptSubmit|PreToolUse|PostToolUse|PostToolUseFailure|PreCompact|Stop|Notification|SubagentStart|SubagentStop|TeammateIdle|TaskCompleted|PermissionRequest)"' "$SETTINGS" | tr -d '"' | sort -u)

    for event in $hook_events; do
        # Map event names to what might appear in the manual
        search_term="$event"
        case "$event" in
            SessionStart) search_term="Session start" ;;
            SessionEnd) search_term="Session end" ;;
            UserPromptSubmit) search_term="User prompt" ;;
            PreToolUse) search_term="Pre-tool" ;;
            PostToolUse) search_term="Post-tool" ;;
            PostToolUseFailure) search_term="failure" ;;
            PreCompact) search_term="Pre-compact" ;;
            Stop) search_term="Stop" ;;
            Notification) search_term="[Nn]otification" ;;
            SubagentStart) search_term="[Ss]ubagent start" ;;
            SubagentStop) search_term="[Ss]ubagent.*stop" ;;
        esac

        if echo "$MANUAL_CONTENT" | grep -qiE "$search_term"; then
            check "Hook event '${event}' documented in MANUAL.md" "pass"
        else
            check "Hook event '${event}' documented in MANUAL.md" "fail"
        fi
    done
else
    echo "  SKIP: settings.json not found, skipping hook checks"
fi

# ─── Profiles ─────────────────────────────────────────────────────────────────

echo ""
echo "${BOLD}Profiles${RESET}"
echo ""

for profile_file in "${SCRIPT_DIR}"/profiles/*.md; do
    [[ -f "$profile_file" ]] || continue
    profile_name=$(basename "$profile_file" .md)

    if echo "$MANUAL_CONTENT" | grep -q "\`${profile_name}\`"; then
        check "Profile '${profile_name}' documented in MANUAL.md" "pass"
    else
        check "Profile '${profile_name}' documented in MANUAL.md" "fail"
    fi
done

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────"
printf "${BOLD}Results: %d/%d passed${RESET}" "$PASS" "$TOTAL"
if [[ $FAIL -gt 0 ]]; then
    printf " ${RED}(%d failed)${RESET}" "$FAIL"
fi
echo ""
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo "Items above marked FAIL are missing from MANUAL.md."
    echo "Update MANUAL.md to include them, then re-run this test."
    exit 1
else
    echo "MANUAL.md is in sync with all skills, agents, hooks, and profiles."
    exit 0
fi
