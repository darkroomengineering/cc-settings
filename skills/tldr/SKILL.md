---
name: tldr
description: TLDR code analysis — call graphs, semantic search, impact, dataflow, for far fewer tokens than reading the files raw. Triggers "who calls X", "what affects X", "blast radius", before large file reads or refactors.
context: fork
allowed-tools: [mcp__tldr__semantic, mcp__tldr__context, mcp__tldr__impact, mcp__tldr__arch, mcp__tldr__slice, mcp__tldr__structure, mcp__tldr__calls, mcp__tldr__cfg, mcp__tldr__dfg, mcp__tldr__change_impact, mcp__tldr__dead, mcp__tldr__imports, mcp__tldr__importers, mcp__tldr__diagnostics, mcp__tldr__tree, mcp__tldr__search, mcp__tldr__extract, mcp__tldr__status]
requires:
  - mcp: tldr
    install: "Provisioned by cc-settings (setup.sh). Default engine native-ts, no install needed; set CC_CODE_INTEL_ENGINE=llm-tldr to opt in."
---

# TLDR Code Analysis

## Standalone Codex fallback

cc-settings does not install the TLDR MCP into standalone Codex. Ignore the
Claude `context`, `allowed-tools`, and `requires` frontmatter in that host and
keep the task read-only with native tools. Use `rg --files` to map the tree,
`rg -n '<symbol|pattern>'` for exact references, direct import searches such as
`rg -n 'from .*<module>|require\(.*<module>'`, and caller searches for the
symbol followed by focused file reads. Use `git diff --name-only` plus test-name
and import searches for change impact.

Do not invoke or claim to have invoked a TLDR MCP in standalone Codex. Report
the native searches actually run and their limitations. The remaining workflow
is for Claude hosts with the configured TLDR MCP.

Token-efficient codebase analysis behind the `tldr` MCP server. It returns the symbols, edges, and slices you asked for instead of whole file bodies, so a question that would cost several full reads costs one small structured answer.

> No measured savings figure is published here on purpose. cc-settings carried a "~95% fewer tokens" claim for months with no benchmark behind it anywhere in the repo — the kind of number `AGENTS.md` now forbids (*No savings against a run that never happened*). To get a real figure, answer the same question both ways and compare the token counts your own session reports.

The engine is provisioned by cc-settings. The tool names below are the stable contract; only the engine behind them changes. Select with `CC_CODE_INTEL_ENGINE`.

**Default: `native-ts`** — a zero-dependency TypeScript-compiler codemap. TS/JS only. Implements `structure`, `tree`, `extract`, `arch`, `imports`, `importers`, `calls`, `context`, `impact`, `change_impact`. Everything else returns `unsupported-by-native-engine`, which means **the analysis did not run** — fall back to `Grep`, never report it as an empty finding.

**Opt-in: `CC_CODE_INTEL_ENGINE=llm-tldr`** — multi-language, plus `semantic`, `dead`, `diagnostics`, `slice`, `cfg`, `dfg`, `search`. Use it on Rust/Python/Go repos. Selecting it means re-running `setup.sh` with the variable set (see Prerequisites), not just exporting it. Two caveats, both measured 2026-07-27:

> 1. **`language` does NOT auto-detect — it defaults to `python`.** On a TS repo, omitting it returns `{"status":"ok"}` with an EMPTY result rather than an error, so a wrong answer is indistinguishable from a true negative. Always pass `language` explicitly (`typescript`, `go`, `rust`, … or `all`). The MCP `impact` and `semantic` tools expose no `language` parameter at all, so they cannot be fixed this way — cross-check with `Grep`.
> 2. **Upstream is archived** (`parcadei/llm-tldr`, 2026-07-13). Neither caveat will be fixed upstream.

## Quick Reference

| Task | Command |
|------|---------|
| "How does X work?" | `semantic`† → `context` |
| "Who calls X?" | `impact` |
| "What would break?" | `impact` + `change_impact` |
| "Why is X null here?" | `slice`† (backward) |
| "What does X affect?" | `slice`† (forward) |
| "Project structure?" | `arch` + `structure` |
| "Find auth code" | `semantic "authentication"`† |
| "Data flow in function" | `dfg`† |
| "Control flow" | `cfg`† |
| "Find dead code" | `dead`† |
| "Type errors?" | `diagnostics`† |
| "File tree" | `tree` |
| "Regex search" | `search`† |

† Not implemented by the default `native-ts` engine — returns
`unsupported-by-native-engine` unless you opt into `llm-tldr`. Treat that as
"did not run", not "found nothing", and fall back to `Grep`.

## Commands

### Semantic Search (Natural Language)
Find code by meaning, not exact text. Uses 5-layer embeddings (AST + call graph + CFG + DFG + PDG):
```
mcp__tldr__semantic { "project": ".", "query": "user authentication flow" }
mcp__tldr__semantic { "project": ".", "query": "error handling" }
```

### Function Context
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
Default engine: **native-ts** — no Python, no daemon, nothing to install.
See `src/lib/code-intel-engine.ts`.

Opt into llm-tldr for non-TS/JS repos or the analysis tools native-ts lacks.
**Exporting the variable alone is not enough** — the `tldr` entry in
`~/.claude.json` is written at install time, so a shell-only export leaves the
hooks on llm-tldr while the MCP server stays on native-ts. Re-run the installer
with the variable set, then restart Claude Code:

```bash
CC_CODE_INTEL_ENGINE=llm-tldr bash setup.sh   # rewrites the MCP entry
pipx install llm-tldr        # only if provisioning manually
tldr daemon start            # background service (~100ms queries)
tldr semantic index . --lang typescript   # per-language; the default index is empty
```

## Rules

1. On the opt-in llm-tldr engine, pass the `language` param on every call: it defaults to `python` and returns empty results for other languages without an error. The default native-ts engine detects the language itself.
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
