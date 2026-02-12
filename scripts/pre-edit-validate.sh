#!/bin/bash
# Pre-Edit Validation Hook (Harness Optimization)
# Validates Edit tool calls before execution to prevent guaranteed failures.
#
# Inspired by: https://blog.can.ac/2026/02/12/the-harness-problem/
# The "harness" (tool infrastructure) is where most edit failures occur — not
# model reasoning. This hook catches doomed edits before they waste context.
#
# Checks:
# 1. Target file exists
# 2. old_string exists in the target file (prevents "String not found" failures)
# 3. Warns when old_string is large (suggests Write tool instead)
# 4. Warns when old_string is ambiguous (multiple matches)
#
# Design: Fail-open. If this script errors, the edit is allowed (exit 0).

set -o pipefail

# Parse file_path from flattened env vars
FILE_PATH="${TOOL_INPUT_file_path:-}"

# Fallback: try to extract from TOOL_INPUT JSON
if [ -z "$FILE_PATH" ] && [ -n "$TOOL_INPUT" ]; then
    if command -v jq &>/dev/null; then
        FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
    else
        FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    fi
fi

# No file path? Let the Edit tool handle it.
[ -z "$FILE_PATH" ] && exit 0

# Check 1: File exists
if [ ! -f "$FILE_PATH" ]; then
    echo "[Harness] File does not exist: $FILE_PATH"
    echo "[Harness] Use Write tool to create new files."
    exit 2
fi

# Checks 2-4 require reliable multiline JSON parsing — use python3
if command -v python3 &>/dev/null && [ -n "$TOOL_INPUT" ]; then
    python3 << 'PYEOF'
import json, sys, os

try:
    data = json.loads(os.environ.get('TOOL_INPUT', '{}'))
except (json.JSONDecodeError, TypeError):
    sys.exit(0)  # fail-open

file_path = data.get('file_path', '')
old_string = data.get('old_string', '')

if not file_path or not old_string:
    sys.exit(0)

if not os.path.isfile(file_path):
    sys.exit(0)  # already handled above

try:
    with open(file_path, 'r') as f:
        content = f.read()
except (IOError, UnicodeDecodeError):
    sys.exit(0)  # fail-open on read errors

basename = os.path.basename(file_path)

# Check 2: old_string exists in file
if old_string not in content:
    lines = old_string.split('\n')
    first_line = lines[0].strip()
    if first_line and first_line in content:
        print(f'[Harness] old_string not found as exact match in {basename}.')
        print(f'[Harness] First line exists — likely whitespace or character mismatch.')
        print(f'[Harness] Re-read the file with Read tool, then retry.')
    else:
        print(f'[Harness] old_string not found in {basename}.')
        print(f'[Harness] File may have changed since last read. Re-read before editing.')
    print(f'[Harness] For complex edits, use Write tool for full file replacement.')
    sys.exit(2)

# Check 3: Warn on large old_string (>15 lines)
line_count = old_string.count('\n') + 1
if line_count > 15:
    print(f'[Harness] Large edit target ({line_count} lines) in {basename}.')
    print(f'[Harness] Large string-replace edits are error-prone. Consider Write tool for full file replacement.')
    # Warn only, don't block
    sys.exit(0)

# Check 4: Warn if old_string appears multiple times
occurrences = content.count(old_string)
if occurrences > 1:
    print(f'[Harness] old_string appears {occurrences} times in {basename}.')
    print(f'[Harness] Add more surrounding context to make old_string unique, or use replace_all.')
    # Warn only — Edit tool will surface its own error
    sys.exit(0)
PYEOF
    exit $?
fi

# No python3 available — fail-open
exit 0
