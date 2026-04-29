---
name: tldr
description: TLDR code analysis (call graphs, semantic search, impact, dataflow) — ~95% token savings vs raw reads. Auto-invoke for "who calls X", "what affects X", before reading large files or refactoring.
context: fork
allowed-tools: [mcp__tldr__semantic, mcp__tldr__context, mcp__tldr__impact, mcp__tldr__arch, mcp__tldr__slice, mcp__tldr__structure, mcp__tldr__calls, mcp__tldr__cfg, mcp__tldr__dfg, mcp__tldr__change_impact, mcp__tldr__dead, mcp__tldr__imports, mcp__tldr__importers, mcp__tldr__diagnostics, mcp__tldr__tree, mcp__tldr__search, mcp__tldr__extract, mcp__tldr__status]
---

# TLDR Code Analysis

Token-efficient codebase analysis using llm-tldr v1.5+. **95% fewer tokens than reading raw files.**

Language is auto-detected (17 supported). No need to specify `--lang` unless overriding.

## Quick Reference

| Task | Command |
|------|---------|
| "How does X work?" | `semantic` → `context` |
| "Who calls X?" | `impact` |
| "What would break?" | `impact` + `change_impact` |
| "Why is X null here?" | `slice` (backward) |
| "What does X affect?" | `slice` (forward) |
| "Project structure?" | `arch` + `structure` |
| "Find auth code" | `semantic "authentication"` |
| "Data flow in function" | `dfg` |
| "Control flow" | `cfg` |
| "Find dead code" | `dead` |
| "Type errors?" | `diagnostics` |
| "File tree" | `tree` |
| "Regex search" | `search` |

## Commands

### Semantic Search (Natural Language)
Find code by meaning, not exact text. Uses 5-layer embeddings (AST + call graph + CFG + DFG + PDG):
```
mcp__tldr__semantic { "project": ".", "query": "user authentication flow" }
mcp__tldr__semantic { "project": ".", "query": "error handling" }
```

### Function Context (95% Token Savings)
Get LLM-ready summary instead of reading entire file:
```
mcp__tldr__context { "project": ".", "entry": "handleLogin", "depth": 2 }
```

### Impact Analysis (Before Refactoring)
Find all callers - critical before changing any function:
```
mcp__tldr__impact { "project": ".", "function": "useAuth" }
```

### Architecture Overview
Understand project layers and dependencies:
```
mcp__tldr__arch { "project": "." }
```

### Program Slice (Debugging)
What affects a specific line (backward) or what it affects (forward):
```
mcp__tldr__slice {
  "file": "src/auth.ts",
  "function": "login",
  "line": 42,
  "direction": "backward",
  "variable": "user"
}
```

### Call Graph
Cross-file function call relationships (language auto-detected):
```
mcp__tldr__calls { "project": "." }
```

### Data Flow Graph
Variable references and def-use chains:
```
mcp__tldr__dfg { "file": "src/auth.ts", "function": "validateToken" }
```

### Control Flow Graph
Basic blocks and branching:
```
mcp__tldr__cfg { "file": "src/auth.ts", "function": "handleRequest" }
```

### Change Impact (Affected Tests)
Find tests affected by changed files (auto-detects from git diff):
```
mcp__tldr__change_impact { "project": "." }
```

### Dead Code Detection
Find unreachable code (language auto-detected):
```
mcp__tldr__dead { "project": "." }
```

### Import Analysis
Parse imports or find importers:
```
mcp__tldr__imports { "file": "src/utils.ts" }
mcp__tldr__importers { "project": ".", "module": "auth" }
```

### Diagnostics (Type/Lint)
Type checking and linting:
```
mcp__tldr__diagnostics { "path": "src/" }
```

### File Tree
Quick project structure overview:
```
mcp__tldr__tree { "project": "." }
mcp__tldr__tree { "project": "src/", "extensions": [".ts", ".tsx"] }
```

### Regex Search
Search files by regex pattern:
```
mcp__tldr__search { "project": ".", "pattern": "TODO|FIXME|HACK" }
```

### Structure Overview
Functions, classes, methods per file (language auto-detected):
```
mcp__tldr__structure { "project": ".", "max_results": 50 }
```

### Full File Extract
Complete code structure from a single file (imports, functions, classes, call graph):
```
mcp__tldr__extract { "file": "src/auth.ts" }
```

### Daemon Status
Check uptime and cache statistics:
```
mcp__tldr__status { "project": "." }
```

## Workflow Patterns

### Understanding Code
```
1. tldr arch .                    # Get project overview
2. tldr semantic "feature name"   # Find relevant code
3. tldr context functionName      # Get LLM-ready summary
4. Read (only if more detail needed)
```

### Before Refactoring
```
1. tldr impact functionName       # Who calls this?
2. tldr change_impact             # What tests affected?
3. tldr context functionName      # Understand the function
4. Make changes
5. tldr diagnostics src/          # Check for errors
```

### Debugging
```
1. tldr slice file func line      # What affects this line?
2. tldr dfg file func             # Data flow analysis
3. tldr context func              # Understand function
```

## Prerequisites

```bash
pipx install llm-tldr
tldr daemon start     # Background service (300x faster)
tldr warm .           # Build indexes including embeddings
```

## CRITICAL RULES

1. **ALWAYS use `tldr context` BEFORE reading large files**
2. **ALWAYS use `tldr impact` BEFORE refactoring**
3. **ALWAYS use `tldr semantic` for "how does X work" questions**
4. **Use `grep` ONLY for exact string matching**
5. **Do NOT hardcode `language` param** — auto-detection handles 17 languages

## Output

Return findings with:
- **Relevant code**: Key functions/files found
- **Call chain**: How things connect
- **Recommendations**: Next steps based on analysis
- **Store as learning** if discovering non-obvious patterns
