#!/bin/bash
# Skill Activation Hook - UserPromptSubmit
# Analyzes user prompt and suggests relevant skills/agents

SKILLS_FILE="${HOME}/.claude/skills/skill-rules.json"
CONTEXT_FILE="${HOME}/.claude/context-usage.json"
OUTPUT_FILE="${HOME}/.claude/skill-activation.out"

USER_PROMPT="$1"

if [ ! -f "$SKILLS_FILE" ]; then
    exit 0
fi

CRITICAL_SKILLS=""
RECOMMENDED_SKILLS=""
SUGGESTED_SKILLS=""
RECOMMENDED_AGENTS=""
AMBIGUOUS_MATCHES=""

check_keyword_match() {
    local prompt="$1"
    local keyword="$2"
    echo "$prompt" | grep -qi "$keyword" && return 0 || return 1
}

check_intent_pattern() {
    local prompt="$1"
    local pattern="$2"
    echo "$prompt" | grep -qiE "$pattern" && return 0 || return 1
}

PROMPT_LOWER=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')

if echo "$PROMPT_LOWER" | grep -qE "(done|finished|ending).*(today|session|now)"; then
    CRITICAL_SKILLS="create_handoff"
fi

if echo "$PROMPT_LOWER" | grep -qE "(handoff|context full|wrapping up|save state)"; then
    CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }create_handoff"
fi

if echo "$PROMPT_LOWER" | grep -qE "(resume|continue where|pick up|last session)"; then
    CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }resume_handoff"
fi

if echo "$PROMPT_LOWER" | grep -qE "fix.*(bug|error|issue)|(broken|not working|failing)"; then
    RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }fix"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }explore, implementer, tester"
fi

if echo "$PROMPT_LOWER" | grep -qE "(build|create|implement).*(feature|component|page)|add.*(new|feature)"; then
    RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }build"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }planner, scaffolder, implementer"
fi

if echo "$PROMPT_LOWER" | grep -qE "refactor|clean up|reorganize|restructure"; then
    RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }refactor"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }explore, implementer, reviewer"
fi

if echo "$PROMPT_LOWER" | grep -qE "/review|review.*(code|changes|pr)|check.*(quality|code)"; then
    RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }review"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }reviewer, tester"
fi

if echo "$PROMPT_LOWER" | grep -qE "/component|(create|new|add).*component"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }component"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }scaffolder"
fi

if echo "$PROMPT_LOWER" | grep -qE "/hook|(create|new|add).*hook"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }hook"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }scaffolder"
fi

if echo "$PROMPT_LOWER" | grep -qE "/explore|(understand|explore).*(codebase|code|this)|(how|where).*(does|is)"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }explore"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }explore, oracle"
fi

if echo "$PROMPT_LOWER" | grep -qE "what.*(could|might).*(go wrong|fail|break)|risk|potential issue"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }premortem"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }oracle, reviewer"
fi

if echo "$PROMPT_LOWER" | grep -qE "/orchestrate|coordinate|multi-step|complex.*(task|feature)"; then
    RECOMMENDED_SKILLS="${RECOMMENDED_SKILLS:+$RECOMMENDED_SKILLS, }orchestrate"
    RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }maestro"
fi

if echo "$PROMPT_LOWER" | grep -qE "(setup|add|implement).*(lenis|smooth.*scroll)"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }lenis"
fi

if echo "$PROMPT_LOWER" | grep -qE "(who|what).*calls|(trace|find).*dependenc|what.*affects.*line|(semantic|meaning).*search|call.*graph"; then
    if command -v tldr &> /dev/null; then
        SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }tldr"
        RECOMMENDED_AGENTS="${RECOMMENDED_AGENTS:+$RECOMMENDED_AGENTS, }explore"
    fi
fi

if echo "$PROMPT_LOWER" | grep -qE "(remember|store|save).*(this|learning|lesson)|(recall|show|list).*learnings|what.*(learned|know).*(about|from)|lessons.*(learned|from)|/learn"; then
    SUGGESTED_SKILLS="${SUGGESTED_SKILLS:+$SUGGESTED_SKILLS, }learn"
fi

if echo "$PROMPT_LOWER" | grep -qE "\btest\b" && ! echo "$PROMPT_LOWER" | grep -qE "(run|write|add).*tests?"; then
    AMBIGUOUS_MATCHES="${AMBIGUOUS_MATCHES:+$AMBIGUOUS_MATCHES, }test [skill] - validate if testing is requested"
fi

if echo "$PROMPT_LOWER" | grep -qE "\bplan\b" && ! echo "$PROMPT_LOWER" | grep -qE "(create|make|write).*plan"; then
    AMBIGUOUS_MATCHES="${AMBIGUOUS_MATCHES:+$AMBIGUOUS_MATCHES, }plan [keyword] - validate if planning is requested"
fi

CONTEXT_WARNING=""
if [ -f "$CONTEXT_FILE" ]; then
    CONTEXT_PERCENT=$(cat "$CONTEXT_FILE" 2>/dev/null | grep -o '"percent":[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$CONTEXT_PERCENT" ]; then
        if [ "$CONTEXT_PERCENT" -ge 90 ]; then
            CONTEXT_WARNING="🔴 CRITICAL: Context at ${CONTEXT_PERCENT}% - Run create_handoff NOW!"
            CRITICAL_SKILLS="${CRITICAL_SKILLS:+$CRITICAL_SKILLS, }create_handoff"
        elif [ "$CONTEXT_PERCENT" -ge 80 ]; then
            CONTEXT_WARNING="🟠 WARNING: Context at ${CONTEXT_PERCENT}% - Recommend handoff soon"
        elif [ "$CONTEXT_PERCENT" -ge 70 ]; then
            CONTEXT_WARNING="🟡 NOTICE: Context at ${CONTEXT_PERCENT}% - Consider handoff at stopping point"
        fi
    fi
fi

if [ -n "$CRITICAL_SKILLS" ] || [ -n "$RECOMMENDED_SKILLS" ] || [ -n "$SUGGESTED_SKILLS" ] || [ -n "$CONTEXT_WARNING" ]; then
    {
        echo ""
        echo "🎯 SKILL ACTIVATION CHECK"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
        if [ -n "$CONTEXT_WARNING" ]; then
            echo "$CONTEXT_WARNING"
            echo ""
        fi
        
        if [ -n "$CRITICAL_SKILLS" ]; then
            echo "⚠️  CRITICAL SKILLS (REQUIRED):"
            echo "   → $CRITICAL_SKILLS"
            echo ""
        fi
        
        if [ -n "$RECOMMENDED_SKILLS" ]; then
            echo "📚 RECOMMENDED SKILLS:"
            echo "   → $RECOMMENDED_SKILLS"
            echo ""
        fi
        
        if [ -n "$SUGGESTED_SKILLS" ]; then
            echo "💡 SUGGESTED SKILLS:"
            echo "   → $SUGGESTED_SKILLS"
            echo ""
        fi
        
        if [ -n "$RECOMMENDED_AGENTS" ]; then
            UNIQUE_AGENTS=$(echo "$RECOMMENDED_AGENTS" | tr ',' '\n' | sed 's/^ *//' | sort -u | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
            echo "🤖 RECOMMENDED AGENTS:"
            echo "   → $UNIQUE_AGENTS"
            echo ""
        fi
        
        if [ -n "$AMBIGUOUS_MATCHES" ]; then
            echo "❓ AMBIGUOUS MATCHES (validate before activating):"
            echo "   $AMBIGUOUS_MATCHES"
            echo ""
        fi
        
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    } > "$OUTPUT_FILE"
    
    cat "$OUTPUT_FILE"
fi

exit 0
