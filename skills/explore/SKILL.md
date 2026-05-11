---
name: explore
description: Read-only codebase investigation via Explore agent; also handles upward-zoom for unfamiliar code regions. Triggers "how does X work", "where is X", "find X", "understand X", "navigate codebase", "zoom out", "bigger picture", "where does this fit".
context: fork
agent: explore
---

# Codebase Exploration

Delegates to the Explore agent for fast, read-only investigation of the codebase.

## Current State
- Directory: !`pwd 2>/dev/null`
- Project: !`basename "$(pwd)" 2>/dev/null`
- Stack: !`ls package.json Cargo.toml go.mod pyproject.toml 2>/dev/null || echo "unknown"`
- Git root: !`git rev-parse --show-toplevel 2>/dev/null || echo "not a git repo"`

## Two modes — pick by what the user asked

### Broad investigation mode (default)
Use when the user is asking "how does X work" / "where is X" / "what handles Y" — finding code without a known starting point.

1. **Start broad** - Use `tldr semantic` or `Glob` to find relevant files
2. **Narrow down** - Read specific files to understand implementation
3. **Trace connections** - Use `tldr impact` to find callers/dependencies
4. **Summarize findings** - Return clear, actionable summary

### Upward-zoom mode
Use when the user is staring at a known function or module and needs to know **how it fits** — triggers like "zoom out", "bigger picture", "where does this fit", onboarding unfamiliar code.

1. Follow [../context-doc/DOMAIN-AWARENESS.md](../context-doc/DOMAIN-AWARENESS.md) — read `CONTEXT.md` and any relevant ADRs first if they exist.
2. Identify the symbol or file the user is asking about.
3. Use TLDR for the structural answer:

   ```bash
   tldr context <symbol> --depth 3 --project .
   tldr impact <symbol> --project .
   ```

4. Synthesize a map: list immediate callers, the modules they live in, and where this area sits in the system. Use `CONTEXT.md` vocabulary when naming concepts.
5. Stop at one layer up. The user can ask for another zoom-out if they need it.

Upward-zoom output shape:

```
{Symbol/file in question}
  ↑ called by: {module A}, {module B}
  ↓ depends on: {module C}, {module D}

Where this fits:
{1–2 sentence narrative using CONTEXT.md terms}

Related ADRs:
- ADR-NNNN ({title}) — relevant because…
```

Keep it short. The point is orientation, not exhaustive coverage.

## Output Format (broad mode)

Return a concise summary:
- **Location**: Key files and their paths
- **How it works**: Brief explanation of the flow
- **Key functions/components**: Entry points
- **Dependencies**: What it relies on
- **Suggestions**: If the user needs to modify something

## Remember

- You are READ-ONLY - do not modify files
- Return summaries, not raw file contents
- Be specific with file paths and line numbers
