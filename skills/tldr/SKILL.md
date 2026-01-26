---
name: tldr
description: |
  TLDR code analysis for token-efficient codebase understanding. Use when:
  - User asks "who calls X", "what affects X", "find implementation"
  - Need to trace dependencies or call graphs
  - Semantic search for code by meaning
  - Understanding large codebases efficiently
context: fork
allowed-tools: [mcp__tldr__semantic, mcp__tldr__context, mcp__tldr__impact, mcp__tldr__arch, mcp__tldr__slice, mcp__tldr__structure, mcp__tldr__calls]
---

# TLDR Code Analysis

Token-efficient codebase analysis using llm-tldr.

## Commands

### Semantic Search
Find code by meaning, not exact text:
```
mcp__tldr__semantic { "project": ".", "query": "authentication flow" }
```

### Function Context
Get context for a specific function (95% fewer tokens than reading file):
```
mcp__tldr__context { "project": ".", "entry": "handleLogin", "depth": 2 }
```

### Impact Analysis
Find all callers of a function (before refactoring):
```
mcp__tldr__impact { "project": ".", "function": "useAuth" }
```

### Architecture Overview
Understand project structure:
```
mcp__tldr__arch { "project": "." }
```

### Program Slice
What affects a specific line (debugging):
```
mcp__tldr__slice {
  "file": "src/auth.ts",
  "function": "login",
  "line": 42,
  "direction": "backward"
}
```

### Call Graph
See cross-file function calls:
```
mcp__tldr__calls { "project": "." }
```

## When to Use

| Task | Command |
|------|---------|
| "How does X work?" | `semantic` + `context` |
| "Who calls X?" | `impact` |
| "Why is X undefined here?" | `slice` (backward) |
| "What does X affect?" | `slice` (forward) |
| "Project structure?" | `arch` |
| "Find implementation of X" | `semantic` |

## Prerequisites

```bash
pipx install llm-tldr
tldr warm .  # Index the project
```

## Output

Return findings:
- **Relevant code**: Key functions/files
- **Call chain**: How things connect
- **Recommendations**: Next steps

## Remember

- TLDR is 95% more token-efficient than reading files
- Use for exploration, then Read for details
- Store discoveries as learnings
