---
name: audit
description: Analyze Claude's Bash command logs — categories, repeats, security signals. Slash-only invocation (triggered by `/audit`); thin wrapper around `claude-audit.ts` with no keyword triggers.
---

Run `bun ~/.claude/src/scripts/claude-audit.ts` and show the output as-is.

After the output, add ONE line commenting on the findings (security, patterns, or "all clean").

Rules:
- NEVER paraphrase or reformat the script output
- Just script output + one line
