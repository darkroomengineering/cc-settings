---
name: tldr
description: TLDR code analysis - semantic search, dependency mapping, program slicing
arguments:
  - name: action
    description: Action to perform (semantic, context, impact, slice, arch, warm)
    required: true
  - name: query
    description: Search query, function name, or file path
    required: false
---

**Usage:** `/tldr <action> [query]`

**Auto-Setup:** The setup script installs llm-tldr and auto-warms projects on session start.

**Manual Install:** `pipx install llm-tldr` (if not using setup script)

**Actions:**

| Action | Purpose | Example |
|--------|---------|---------|
| `semantic` | Natural language code search | `/tldr semantic "auth flow"` |
| `context` | LLM-ready function summary (95% fewer tokens) | `/tldr context loginUser` |
| `impact` | Find all callers (reverse call graph) | `/tldr impact validateToken` |
| `slice` | Trace what affects a specific line | `/tldr slice src/auth.ts login 42` |
| `arch` | Detect architecture layers | `/tldr arch` |
| `warm` | Build/rebuild index | `/tldr warm` |

**Examples:**

```bash
# Find code by meaning
/tldr semantic "database connection pooling"

# Understand a function with minimal tokens
/tldr context handleLogin

# Who calls this function?
/tldr impact getUserById

# Debug: what affects line 42?
/tldr slice src/auth.ts login 42

# Map project architecture
/tldr arch

# Rebuild index after major changes
/tldr warm
```

**Behavior:**

1. **semantic** - Searches code by meaning using embeddings
   - Returns ranked matches with file paths and snippets
   - Much better than grep for "how does X work" queries

2. **context** - Extracts structured summary for a function
   - Control flow, data flow, dependencies
   - 95% token savings vs reading raw code

3. **impact** - Reverse call graph analysis
   - Shows all callers of a function
   - Essential for refactoring safely

4. **slice** - Program slicing
   - Shows only lines that affect a specific line
   - Perfect for debugging "why is X null here?"

5. **arch** - Architecture detection
   - Identifies layers (presentation, business, data)
   - Maps module boundaries

**First-Time Setup:**

If using the setup script, TLDR is auto-installed and projects auto-warm on session start.

For manual setup:
```bash
# Install via pipx (recommended)
pipx install llm-tldr

# Or via pip
pip install llm-tldr

# Index manually (if not auto-warmed)
cd /path/to/project
tldr warm .

# Now queries are instant
tldr semantic "error handling" .
```

**MCP Integration:**

The TLDR tools are also available via MCP if configured in settings.json:

```json
{
  "mcpServers": {
    "tldr": {
      "command": "tldr-mcp",
      "args": ["--project", "."]
    }
  }
}
```
