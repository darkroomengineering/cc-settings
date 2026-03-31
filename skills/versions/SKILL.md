---
name: versions
description: "Check package versions before installing. Auto-invoke when about to run bun add or npm install, when user asks about 'latest version' or 'update package', or before implementing with any library. Never install packages without checking version first."
allowed-tools: "Bash, mcp__context7__resolve-library-id, mcp__context7__get-library-docs"
---

# Package Version Checker

Always check latest version before installing any package.

## Workflow

1. **Check version**: `bun info <package>`
2. **Fetch docs**: Use context7 MCP tools for current documentation
3. **Install**: `bun add <package>@latest`
4. **Verify**: Confirm `package.json` has the correct version

## Commands

```bash
# Check latest version
bun info <package>

# Install latest
bun add <package>@latest

# Install specific version
bun add <package>@3.12.5

# List outdated packages
bun outdated
```

## Darkroom Packages

| Package | Purpose |
|---------|---------|
| `lenis` | Smooth scroll |
| `hamo` | Performance hooks |
| `tempus` | RAF management |

## Output

Report: package name, latest version, current version (if in package.json), and install/update recommendation.
