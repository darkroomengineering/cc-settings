#!/usr/bin/env bash
# Shadow wrapper — runs both bash safety-net and the TS port, compares
# decisions, and appends divergences to ~/.claude/safety-net-divergence.log.
# The bash exit code + stdout is authoritative (what Claude Code sees).
#
# Cutover criterion: 7 consecutive days with an empty divergence log → flip
# settings.json hook to bun src/hooks/safety-net.ts and remove this wrapper.
#
# Contract: see docs/migration-coexistence.md.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASH_IMPL="${SCRIPT_DIR}/safety-net.sh"
TS_IMPL="$(dirname "$SCRIPT_DIR")/src/hooks/safety-net.ts"
DIVERGENCE_LOG="${HOME}/.claude/safety-net-divergence.log"

mkdir -p "$(dirname "$DIVERGENCE_LOG")" 2>/dev/null || true

# Run the bash implementation — this is the decision Claude Code uses.
BASH_STDOUT=$(bash "$BASH_IMPL" 2>/dev/null)
BASH_EXIT=$?

# Run the TS implementation in the background. If bun is missing, skip the
# shadow leg silently — we still honor the bash decision.
if command -v bun >/dev/null 2>&1 && [[ -f "$TS_IMPL" ]]; then
    TS_STDOUT=$(TOOL_INPUT_command="${TOOL_INPUT_command:-}" bun "$TS_IMPL" 2>/dev/null)
    TS_EXIT=$?

    if [[ "$BASH_EXIT" -ne "$TS_EXIT" ]] || [[ "$BASH_STDOUT" != "$TS_STDOUT" ]]; then
        # redact_secrets is sourced from safety-net.sh; re-run the regex locally so
        # the wrapper doesn't need to source the full file.
        REDACTED=$(echo "${TOOL_INPUT_command:-}" \
          | sed -E \
            -e 's/sk-[A-Za-z0-9_-]{10,}/[REDACTED]/g' \
            -e 's/ghp_[A-Za-z0-9]{10,}/[REDACTED]/g' \
            -e 's/AKIA[A-Z0-9]{12,}/[REDACTED]/g' \
            -e 's/Bearer [A-Za-z0-9._-]+/Bearer [REDACTED]/g' \
            -e 's/password=[^ &"]+/password=[REDACTED]/g' \
            -e 's/token=[^ &"]+/token=[REDACTED]/g' \
            -e 's/secret=[^ &"]+/secret=[REDACTED]/g')
        TS="${TS:-}"
        TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        # Escape for JSON
        ESC_CMD=$(printf '%s' "$REDACTED" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "$(echo "$REDACTED" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')")
        ESC_BASH_STDOUT=$(printf '%s' "$BASH_STDOUT" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$(echo "$BASH_STDOUT" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')")
        ESC_TS_STDOUT=$(printf '%s' "$TS_STDOUT" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$(echo "$TS_STDOUT" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')")
        printf '{"timestamp":"%s","command":%s,"bash":{"exit":%d,"stdout":%s},"ts":{"exit":%d,"stdout":%s}}\n' \
          "$TIMESTAMP" \
          "$ESC_CMD" \
          "$BASH_EXIT" "$ESC_BASH_STDOUT" \
          "$TS_EXIT" "$ESC_TS_STDOUT" \
          >> "$DIVERGENCE_LOG"
    fi
fi

# Emit the bash decision. Bash is still authoritative during shadow mode.
if [[ -n "$BASH_STDOUT" ]]; then
    printf '%s' "$BASH_STDOUT"
fi
exit "$BASH_EXIT"
