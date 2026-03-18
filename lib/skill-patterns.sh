#!/usr/bin/env bash
# lib/skill-patterns.sh - Shared skill-to-pattern mapping
# Part of Darkroom Claude Code Setup
#
# Single source of truth for skill trigger patterns.
# Used by both scripts/compile-skills.sh and scripts/skill-activation.sh

# Returns newline-separated patterns for a given skill name.
# Usage: get_skill_patterns "fix"
get_skill_patterns() {
    local skill_name="$1"

    case "$skill_name" in
        fix)
            echo "fix"
            echo "bug"
            echo "broken"
            echo "error"
            echo "failing"
            echo "not working"
            echo "issue"
            ;;
        build)
            echo "build"
            echo "create"
            echo "implement"
            echo "add feature"
            echo "new feature"
            echo "add new"
            ;;
        explore)
            echo "explore"
            echo "how does"
            echo "where is"
            echo "find"
            echo "understand"
            echo "what files"
            echo "navigate"
            echo "how.*work"
            ;;
        review)
            echo "review"
            echo "check"
            echo "look at"
            echo "pr"
            echo "pull request"
            echo "code review"
            echo "diff"
            ;;
        test)
            echo "write tests"
            echo "add tests"
            echo "run tests"
            echo "coverage"
            echo "unit test"
            echo "integration test"
            ;;
        refactor)
            echo "refactor"
            echo "clean up"
            echo "reorganize"
            echo "restructure"
            echo "improve code"
            echo "technical debt"
            ;;
        component)
            echo "create component"
            echo "new component"
            echo "add component"
            echo "/component"
            ;;
        hook)
            echo "create hook"
            echo "new hook"
            echo "add hook"
            echo "/hook"
            ;;
        orchestrate)
            echo "orchestrate"
            echo "coordinate"
            echo "complex task"
            echo "multi-step"
            echo "/orchestrate"
            ;;
        create-handoff)
            echo "done.*today"
            echo "ending.*session"
            echo "save session"
            echo "create.*handoff"
            echo "handoff.sh create"
            echo "wrapping up"
            echo "pause work"
            echo "context full"
            ;;
        resume-handoff)
            echo "resume"
            echo "continue where"
            echo "pick up"
            echo "resume.*handoff"
            echo "handoff.sh resume"
            echo "last session"
            echo "previous work"
            ;;
        learn)
            echo "remember.*this"
            echo "store.*learning"
            echo "recall.*learning"
            echo "what.*learned"
            echo "lessons learned"
            echo "learning.sh"
            echo "/learn"
            ;;
        tldr)
            echo "who calls"
            echo "what affects"
            echo "trace"
            echo "dependencies"
            echo "semantic search"
            echo "call graph"
            echo "/tldr"
            ;;
        premortem)
            echo "what could.*wrong"
            echo "risks"
            echo "potential issues"
            echo "fail"
            echo "break"
            ;;
        docs)
            echo "/docs"
            echo "documentation"
            echo "api reference"
            echo "library docs"
            ;;
        debug)
            echo "/debug"
            echo "debug"
            echo "screenshot"
            echo "inspect element"
            echo "visual bug"
            ;;
        qa)
            echo "/qa"
            echo "visual qa"
            echo "accessibility check"
            echo "a11y"
            ;;
        init)
            echo "/init"
            echo "initialize project"
            echo "setup project"
            ;;
        ask)
            echo "/ask"
            echo "oracle"
            echo "expert advice"
            echo "guidance"
            ;;
        lenis)
            echo "/lenis"
            echo "smooth scroll"
            echo "lenis"
            echo "smooth scrolling"
            ;;
        versions)
            echo "/versions"
            echo "package versions"
            echo "check versions"
            echo "darkroom packages"
            ;;
        context)
            echo "/context"
            echo "context window"
            echo "context usage"
            echo "token usage"
            ;;
        discovery)
            echo "/discovery"
            echo "discover"
            echo "find features"
            echo "what can you do"
            ;;
        effort)
            echo "think harder"
            echo "be thorough"
            echo "quick fix"
            echo "effort"
            echo "slow down"
            echo "think more"
            ;;
        teams)
            echo "use teams"
            echo "fan out"
            echo "split work"
            echo "parallel agents"
            echo "divide and conquer"
            echo "multi-instance"
            echo "agent teams"
            ;;
        ship)
            echo "ship"
            echo "ship it"
            echo "create pr"
            echo "open pr"
            echo "/pr"
            echo "/ship"
            echo "ready to merge"
            echo "push and pr"
            echo "ready to ship"
            ;;
        checkpoint)
            echo "checkpoint"
            echo "save state"
            echo "save progress"
            echo "restore checkpoint"
            echo "list checkpoints"
            echo "/checkpoint"
            ;;
        design-tokens)
            echo "design tokens"
            echo "type scale"
            echo "color palette"
            echo "spacing system"
            echo "theme setup"
            echo "design system"
            echo "color scale"
            echo "/design-tokens"
            ;;
        f-thread)
            echo "compare approaches"
            echo "which is better"
            echo "evaluate options"
            echo "architecture decision"
            echo "technology selection"
            echo "trade-off analysis"
            echo "trade-off"
            echo "/f-thread"
            ;;
        l-thread)
            echo "overnight"
            echo "long running"
            echo "autonomous task"
            echo "l-thread"
            echo "extended task"
            echo "/l-thread"
            ;;
        prd)
            echo "prd"
            echo "requirements document"
            echo "product spec"
            echo "feature spec"
            echo "write requirements"
            echo "/prd"
            ;;
        project)
            echo "what's the plan"
            echo "project status"
            echo "update the issue"
            echo "sync with github"
            echo "check the roadmap"
            echo "what am i working on"
            echo "show my tasks"
            echo "close the issue"
            echo "mark as done"
            echo "/project"
            ;;
        figma)
            echo "/figma"
            echo "figma"
            echo "compare to design"
            echo "design fidelity"
            echo "match the figma"
            echo "extract tokens from figma"
            echo "inspect in figma"
            ;;
        lighthouse)
            echo "lighthouse"
            echo "performance audit"
            echo "page speed"
            echo "web vitals"
            echo "core web vitals"
            echo "LCP"
            echo "CLS"
            echo "INP"
            echo "slow page"
            echo "/lighthouse"
            ;;
        audit)
            echo "audit commands"
            echo "audit bash"
            echo "analyze commands"
            echo "command history"
            echo "/audit"
            ;;
        consolidate)
            echo "consolidate"
            echo "contradictions"
            echo "clean up rules"
            echo "settings review"
            echo "/consolidate"
            echo "spa day"
            ;;
        verify)
            echo "verify"
            echo "double check"
            echo "prove it"
            echo "adversarial review"
            echo "/verify"
            ;;
        autoresearch)
            echo "autoresearch"
            echo "optimize skill"
            echo "improve skill"
            echo "tune skill"
            echo "evolve skill"
            echo "prompt optimization"
            echo "skill optimization"
            echo "/autoresearch"
            ;;
    esac
}

# Returns the recommended agents for a given skill.
# Usage: get_skill_agents "fix"
get_skill_agents() {
    local skill_name="$1"

    case "$skill_name" in
        fix)                    echo "explore,implementer,tester" ;;
        build)                  echo "planner,scaffolder,implementer" ;;
        explore)                echo "explore,oracle" ;;
        review)                 echo "reviewer,tester" ;;
        refactor)               echo "explore,implementer,reviewer" ;;
        test)                   echo "tester" ;;
        orchestrate)            echo "maestro" ;;
        component|hook)         echo "scaffolder" ;;
        ship)                   echo "tester,reviewer,implementer" ;;
        premortem|ask)          echo "oracle,reviewer" ;;
        tldr)                   echo "explore" ;;
        teams)                  echo "maestro" ;;
        f-thread)               echo "oracle" ;;
        l-thread)               echo "planner,implementer" ;;
        prd)                    echo "planner" ;;
        project)                echo "" ;;
        checkpoint)             echo "" ;;
        design-tokens)          echo "scaffolder" ;;
        figma)                  echo "" ;;
        lighthouse)             echo "implementer" ;;
        audit)                  echo "" ;;
        consolidate)            echo "" ;;
        verify)                 echo "reviewer" ;;
        autoresearch)           echo "" ;;
        *)                      echo "" ;;
    esac
}

# Returns the priority for a given skill.
# Usage: get_skill_priority "fix"
get_skill_priority() {
    local skill_name="$1"

    case "$skill_name" in
        create-handoff|resume-handoff)  echo "critical" ;;
        fix|build|refactor|review|orchestrate|ship) echo "high" ;;
        explore|test|component|hook|learn|tldr|prd|f-thread|l-thread|project|lighthouse) echo "medium" ;;
        *)                              echo "low" ;;
    esac
}

# Returns the enforcement level for a given skill.
# Usage: get_skill_enforcement "fix"
get_skill_enforcement() {
    local skill_name="$1"

    case "$skill_name" in
        create-handoff)                 echo "block" ;;
        fix|build|refactor|review|ship) echo "recommend" ;;
        *)                              echo "suggest" ;;
    esac
}
