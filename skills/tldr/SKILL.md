---
name: tldr
description: TLDR code analysis — call graphs, semantic search, impact, dataflow; ~95% token savings vs raw reads. Use for "who calls X", "what affects X", before large file reads or refactors.
context: fork
allowed-tools: [mcp__tldr__semantic, mcp__tldr__context, mcp__tldr__impact, mcp__tldr__arch, mcp__tldr__slice, mcp__tldr__structure, mcp__tldr__calls, mcp__tldr__cfg, mcp__tldr__dfg, mcp__tldr__change_impact, mcp__tldr__dead, mcp__tldr__imports, mcp__tldr__importers, mcp__tldr__diagnostics, mcp__tldr__tree, mcp__tldr__search, mcp__tldr__extract, mcp__tldr__status]
requires:
  - mcp: tldr
    install: "Provisioned by cc-settings (setup.sh). Default engine llm-tldr; override with CC_CODE_INTEL_ENGINE."
---

# TLDR Code Analysis

Token-efficient codebase analysis behind the `tldr` MCP server. **~95% fewer tokens than reading raw files.**

The engine is provisioned by cc-settings — default **llm-tldr** (17 languages). Override per-environment with `CC_CODE_INTEL_ENGINE` (e.g. `native-ts`, a zero-dependency TypeScript/JavaScript codemap with no semantic search). The tool names below are the stable contract; only the engine behind them changes.

> **`language` does NOT auto-detect — it defaults to `python`.** Measured 2026-07-27: on this
> TypeScript repo, omitting it returns `{"status":"ok"}` with an EMPTY result rather than an error,
> so a wrong answer is indistinguishable from a true negative. **Always pass `language` explicitly**
> (`typescript`, `javascript`, `go`, `rust`, …, or `all`). The MCP `impact` and `semantic` tools
> expose no `language` parameter at all and are therefore unusable on non-Python code — use
> `mcp__tldr__calls` with an explicit language, or `Grep`, instead of trusting an empty `impact`.

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
Cross-file function call relationships (pass `language` explicitly):
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
Find unreachable code (pass `language` explicitly):
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
Functions, classes, methods per file (pass `language` explicitly):
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

## Prerequisites

The engine behind `tldr` is provisioned automatically by cc-settings (`setup.sh`).
Default engine: **llm-tldr** (needs `pipx`). Override per-environment with
`CC_CODE_INTEL_ENGINE` — e.g. `native-ts` for a zero-dependency TypeScript/JavaScript
codemap. See `src/lib/code-intel-engine.ts`.

```bash
# Default (llm-tldr): installed by setup.sh; daemon auto-starts each session.
pipx install llm-tldr        # only if provisioning manually
tldr daemon start            # background service (~100ms queries)
tldr warm .                  # build indexes including embeddings

# Or opt into the native engine (no Python, no semantic search):
export CC_CODE_INTEL_ENGINE=native-ts
```

## CRITICAL RULES

1. **ALWAYS pass the `language` param** — it defaults to `python` and silently returns empty results for every other language. There is no auto-detection. This rule comes first because it invalidates every rule below when broken.
2. **Reach for `context`/`structure`/`calls` BEFORE reading large files** — with an explicit language.
3. **Before refactoring, do NOT trust an empty `impact`.** On non-Python code it returns `{"status":"ok","callers":[]}` whether or not callers exist, and it has no `language` parameter to fix that. Confirm with `Grep` or `mcp__tldr__calls` (explicit language) before concluding nothing calls a symbol.
4. **`semantic` needs an index built with the right language** (`tldr semantic index . --lang <lang>`) and still ranks poorly on this repo — treat its hits as candidates to verify, not answers.
5. **Use `grep` for exact string matching** — and as the cross-check whenever a tldr result is empty.

## Output

Return findings with:
- **Relevant code**: Key functions/files found
- **Call chain**: How things connect
- **Recommendations**: Next steps based on analysis
- **Store as learning** if discovering non-obvious patterns
