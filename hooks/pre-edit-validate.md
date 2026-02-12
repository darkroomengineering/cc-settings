# Pre-Edit Validation Hook

**Status:** ACTIVE
**Event:** PreToolUse (matcher: Edit)
**Script:** `scripts/pre-edit-validate.sh`

## Purpose

Validates Edit tool calls before execution to prevent guaranteed failures. Inspired by
[The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) — most edit
failures occur in the tool infrastructure (harness), not model reasoning.

## Checks

| # | Check | Action | Exit Code |
|---|-------|--------|-----------|
| 1 | File exists | Block if missing (use Write instead) | 2 |
| 2 | old_string found in file | Block if not found (re-read file) | 2 |
| 3 | old_string > 15 lines | Warn (suggest Write tool) | 0 |
| 4 | old_string appears multiple times | Warn (add more context) | 0 |

## Design

- **Fail-open**: If the script errors, the edit is allowed
- **Uses python3** for reliable multiline JSON parsing (falls back to bash for file existence check)
- **Blocks** (exit 2) only for guaranteed failures
- **Warns** (exit 0 with stdout) for likely-to-fail patterns

## Environment Variables

- `$TOOL_INPUT` — Full JSON of the Edit tool call
- `$TOOL_INPUT_file_path` — Flattened file path (preferred)

## Token Savings

By catching doomed edits before they execute, this hook prevents:
- Wasted context on "String not found" error messages
- Retry loops that burn the 2-iteration limit
- Model frustration leading to increasingly wrong edit attempts
