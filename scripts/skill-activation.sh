#!/bin/bash
# Skill Activation Hook - UserPromptSubmit
# Analyzes user prompt and suggests relevant skills/agents
# Optimized: Uses compiled skill index with awk for single-pass matching
# Legacy fallback: jq path (only runs if skill-rules.json exists, which it no longer does)

CLAUDE_DIR="${HOME}/.claude"
SKILLS_FILE="${CLAUDE_DIR}/skills/skill-rules.json"
COMPILED_INDEX="${CLAUDE_DIR}/skill-index.compiled"
CONTEXT_FILE="${CLAUDE_DIR}/context-usage.json"
OUTPUT_FILE="${CLAUDE_DIR}/skill-activation.out"

# Source shared skill patterns for the ultimate fallback path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"
if [[ -f "${LIB_DIR}/skill-patterns.sh" ]]; then
    source "${LIB_DIR}/skill-patterns.sh"
fi

USER_PROMPT="$1"

# Exit early if no prompt
[[ -z "$USER_PROMPT" ]] && exit 0

PROMPT_LOWER=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')

# Initialize result variables
CRITICAL_SKILLS=""
RECOMMENDED_SKILLS=""
SUGGESTED_SKILLS=""
RECOMMENDED_AGENTS=""
AMBIGUOUS_MATCHES=""
USE_COMPILED=false

# =============================================================================
# FAST PATH: Use compiled index with awk for single-pass matching
# =============================================================================

if [[ -f "$COMPILED_INDEX" ]]; then
    USE_COMPILED=true

    # Use awk for fast single-pass pattern matching
    # Format: PATTERN|SKILL_NAME|PRIORITY|ENFORCEMENT|AGENTS
    MATCHES=$(awk -F'|' -v prompt="$PROMPT_LOWER" '
        BEGIN {
            IGNORECASE = 1
        }
        /^#/ { next }  # Skip comments
        NF < 2 { next } # Skip malformed lines
        {
            pattern = $1
            skill = $2
            priority = $3
            enforcement = $4
            agents = $5

            # Try to match the pattern against the prompt
            if (match(prompt, pattern)) {
                # Only output first match per skill
                if (!(skill in seen)) {
                    seen[skill] = 1
                    print skill "|" priority "|" enforcement "|" agents
                }
            }
        }
    ' "$COMPILED_INDEX" 2>/dev/null)

    # Process matches
    while IFS='|' read -r skill priority enforcement agents; do
        [[ -z "$skill" ]] && continue

        case "$enforcement" in
            block)
                CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }$skill"
                ;;
            *)
                case "$priority" in
                    critical)
                        CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }$skill"
                        ;;
                    high)
                        RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }$skill"
                        ;;
                    medium|low)
                        SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }$skill"
                        ;;
                esac
                ;;
        esac

        # Collect agents
        if [[ -n "$agents" ]]; then
            RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }$agents"
        fi
    done <<< "$MATCHES"
fi

# =============================================================================
# FALLBACK PATH: jq-based matching from skill-rules.json
# =============================================================================

if [[ "$USE_COMPILED" != true ]] && [[ -f "$SKILLS_FILE" ]] && command -v jq &>/dev/null; then
    JQ_MATCHES=$(jq -r --arg prompt "$PROMPT_LOWER" '
        def matches_keyword($p; $kw): $p | test($kw; "i");
        def matches_pattern($p; $pat): $p | test($pat; "i");

        .skills | to_entries | map(
            select(
                (.value.promptTriggers.keywords // []) as $kws |
                (.value.promptTriggers.intentPatterns // []) as $pats |
                ([$kws[] | select(. as $k | $prompt | test($k; "i"))] | length > 0) or
                ([$pats[] | select(. as $p | $prompt | test($p; "i"))] | length > 0)
            ) |
            {
                skill: .key,
                priority: .value.priority,
                enforcement: .value.enforcement,
                agents: (.value.agents // []),
                ambiguous: (.value.ambiguous // false)
            }
        )
    ' "$SKILLS_FILE" 2>/dev/null)

    if [[ -n "$JQ_MATCHES" ]] && [[ "$JQ_MATCHES" != "[]" ]]; then
        CRITICAL_SKILLS=$(echo "$JQ_MATCHES" | jq -r '[.[] | select(.enforcement == "block" or .priority == "critical")] | map(.skill) | join(", ")' 2>/dev/null)
        RECOMMENDED_SKILLS=$(echo "$JQ_MATCHES" | jq -r '[.[] | select(.priority == "high" and .enforcement != "block")] | map(.skill) | join(", ")' 2>/dev/null)
        SUGGESTED_SKILLS=$(echo "$JQ_MATCHES" | jq -r '[.[] | select(.priority == "medium" or .priority == "low") | select(.ambiguous != true)] | map(.skill) | join(", ")' 2>/dev/null)
        RECOMMENDED_AGENTS=$(echo "$JQ_MATCHES" | jq -r '[.[] | .agents[]] | unique | join(", ")' 2>/dev/null)
        AMBIGUOUS_MATCHES=$(echo "$JQ_MATCHES" | jq -r '[.[] | select(.ambiguous == true)] | map(.skill + " [ambiguous]") | join(", ")' 2>/dev/null)
    fi
fi

# =============================================================================
# ULTIMATE FALLBACK: Pattern matching using shared skill-patterns.sh
# (no jq, no compiled index)
# =============================================================================

if [[ "$USE_COMPILED" != true ]] && [[ -z "$JQ_MATCHES" ]]; then
    # Helper: check if prompt matches any pattern for a given skill
    _matches_skill() {
        local skill="$1"
        if type get_skill_patterns &>/dev/null; then
            while IFS= read -r pattern; do
                [[ -z "$pattern" ]] && continue
                if echo "$PROMPT_LOWER" | grep -qiE "$pattern"; then
                    return 0
                fi
            done < <(get_skill_patterns "$skill")
        fi
        return 1
    }

    # Helper: classify a matched skill by priority/enforcement from shared lib
    _classify_skill() {
        local skill="$1"
        local priority="low"
        local enforcement="suggest"
        local agents=""

        if type get_skill_priority &>/dev/null; then
            priority=$(get_skill_priority "$skill")
        fi
        if type get_skill_enforcement &>/dev/null; then
            enforcement=$(get_skill_enforcement "$skill")
        fi
        if type get_skill_agents &>/dev/null; then
            agents=$(get_skill_agents "$skill")
        fi

        case "$enforcement" in
            block)
                CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }$skill"
                ;;
            *)
                case "$priority" in
                    critical)
                        CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }$skill"
                        ;;
                    high)
                        RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }$skill"
                        ;;
                    medium|low)
                        SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }$skill"
                        ;;
                esac
                ;;
        esac

        if [[ -n "$agents" ]]; then
            RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }$agents"
        fi
    }

    # Check all known skills using shared patterns
    KNOWN_SKILLS=(
        create-handoff resume-handoff
        fix build refactor review orchestrate ship teams
        component hook explore premortem lenis tldr learn effort
    )

    for skill in "${KNOWN_SKILLS[@]}"; do
        # Special case: tldr requires the command to be installed
        if [[ "$skill" == "tldr" ]]; then
            command -v tldr &>/dev/null || continue
        fi

        if _matches_skill "$skill"; then
            _classify_skill "$skill"
        fi
    done

    # Ambiguous matches (require special logic)
    if echo "$PROMPT_LOWER" | grep -qE "\btest\b" && ! echo "$PROMPT_LOWER" | grep -qE "(run|write|add).*tests?"; then
        AMBIGUOUS_MATCHES="${AMBIGUOUS_MATCHES:+$AMBIGUOUS_MATCHES, }test [skill] - validate if testing is requested"
    fi

    if echo "$PROMPT_LOWER" | grep -qE "\bplan\b" && ! echo "$PROMPT_LOWER" | grep -qE "(create|make|write).*plan"; then
        AMBIGUOUS_MATCHES="${AMBIGUOUS_MATCHES:+$AMBIGUOUS_MATCHES, }plan [keyword] - validate if planning is requested"
    fi
fi

# =============================================================================
# Context warning check
# =============================================================================

CONTEXT_WARNING=""
if [[ -f "$CONTEXT_FILE" ]]; then
    if command -v jq &>/dev/null; then
        CONTEXT_PERCENT=$(jq -r '.percent // 0' "$CONTEXT_FILE" 2>/dev/null)
    else
        CONTEXT_PERCENT=$(grep -o '"percent":[0-9]*' "$CONTEXT_FILE" 2>/dev/null | grep -o '[0-9]*' | head -1)
    fi

    if [[ -n "$CONTEXT_PERCENT" ]] && [[ "$CONTEXT_PERCENT" -gt 0 ]] 2>/dev/null; then
        if [[ "$CONTEXT_PERCENT" -ge 90 ]]; then
            CONTEXT_WARNING="CRITICAL: Context at ${CONTEXT_PERCENT}% - Run create-handoff NOW!"
            CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }create-handoff"
        elif [[ "$CONTEXT_PERCENT" -ge 80 ]]; then
            CONTEXT_WARNING="WARNING: Context at ${CONTEXT_PERCENT}% - Recommend handoff soon"
        elif [[ "$CONTEXT_PERCENT" -ge 70 ]]; then
            CONTEXT_WARNING="NOTICE: Context at ${CONTEXT_PERCENT}% - Consider handoff at stopping point"
        fi
    fi
fi

# =============================================================================
# Output
# =============================================================================

if [[ -n "$CRITICAL_SKILLS" ]] || [[ -n "$RECOMMENDED_SKILLS" ]] || [[ -n "$SUGGESTED_SKILLS" ]] || [[ -n "$CONTEXT_WARNING" ]]; then
    {
        echo ""
        echo "SKILL ACTIVATION CHECK"
        echo "------------------------------------"
        echo ""

        if [[ -n "$CONTEXT_WARNING" ]]; then
            echo "$CONTEXT_WARNING"
            echo ""
        fi

        if [[ -n "$CRITICAL_SKILLS" ]]; then
            echo "CRITICAL SKILLS (REQUIRED):"
            echo "   -> $CRITICAL_SKILLS"
            echo ""
        fi

        if [[ -n "$RECOMMENDED_SKILLS" ]]; then
            echo "RECOMMENDED SKILLS:"
            echo "   -> $RECOMMENDED_SKILLS"
            echo ""
        fi

        if [[ -n "$SUGGESTED_SKILLS" ]]; then
            echo "SUGGESTED SKILLS:"
            echo "   -> $SUGGESTED_SKILLS"
            echo ""
        fi

        if [[ -n "$RECOMMENDED_AGENTS" ]]; then
            UNIQUE_AGENTS=$(echo "$RECOMMENDED_AGENTS" | tr ',' '\n' | sed 's/^ *//' | sort -u | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
            echo "RECOMMENDED AGENTS:"
            echo "   -> $UNIQUE_AGENTS"
            echo ""
        fi

        if [[ -n "$AMBIGUOUS_MATCHES" ]]; then
            echo "AMBIGUOUS MATCHES (validate before activating):"
            echo "   $AMBIGUOUS_MATCHES"
            echo ""
        fi

        echo "------------------------------------"
    } > "$OUTPUT_FILE"

    cat "$OUTPUT_FILE"
fi

exit 0
