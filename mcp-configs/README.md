# MCP Servers

Model Context Protocol (MCP) servers extend Claude Code with external capabilities like deployment management, live documentation, and persistent memory.

---

## What MCP Servers Do

MCP servers provide Claude Code with:

- **Tools** - Actions Claude can execute (deploy, query, fetch)
- **Resources** - Data Claude can read (files, database schemas, docs)
- **Prompts** - Pre-built prompt templates for common tasks

Think of them as plugins that give Claude access to external systems without requiring you to copy-paste data back and forth.

---

## Configuration

### Global Configuration

Add MCP servers to `~/.claude.json`:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {}
    },
    "vercel": {
      "type": "http",
      "url": "https://mcp.vercel.com"
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

### Server Types

**Stdio servers** - Run as local processes:
```json
{
  "server-name": {
    "command": "npx",
    "args": ["-y", "package-name"],
    "env": {
      "API_KEY": "your-key"
    }
  }
}
```

**HTTP servers** - Connect to remote endpoints:
```json
{
  "server-name": {
    "type": "http",
    "url": "https://mcp.example.com"
  }
}
```

---

## Context Window Impact

MCP servers consume context window tokens. Each active server adds:

- **Tool definitions** - ~100-500 tokens per tool
- **Resource metadata** - ~50-200 tokens per resource
- **Server overhead** - ~50 tokens base

### Recommendations

| Active Servers | Impact | Guidance |
|----------------|--------|----------|
| 1-5 | Minimal | Recommended for most projects |
| 6-10 | Moderate | Monitor context usage |
| 10+ | Significant | Risk of context exhaustion |

**Keep under 10 active servers** to avoid context window issues.

---

## Disabling Per-Project

Use `disabledMcpServers` in `.claude/settings.json` to disable servers for specific projects:

```json
{
  "disabledMcpServers": [
    "memory",
    "vercel"
  ]
}
```

This is useful when:
- A project doesn't use certain services (e.g., no Vercel)
- You need to free up context window
- A server conflicts with project requirements

---

## Installation

### Quick Start

Copy the recommended config to your global settings:

```bash
# View current config
cat ~/.claude.json

# Merge recommended servers (manual)
# Copy servers from recommended.json into your ~/.claude.json mcpServers object
```

### Verify Installation

After adding servers, restart Claude Code. You should see the servers listed when Claude starts.

Test a server:
```
Ask: "What MCP servers are available?"
```

---

## Server Categories

### Recommended (`recommended.json`)

Essential servers for Darkroom projects:
- **context7** - Live documentation lookup (crucial for current APIs)
- **vercel** - Deployment management
- **memory** - Persistent knowledge across sessions

### Adding Project-Specific Servers

For client projects that need additional MCP servers (databases, hosting, comms tools), add them to the project's `.claude/settings.json` rather than the global config. Browse available servers at [modelcontextprotocol.io](https://modelcontextprotocol.io).

---

## Troubleshooting

### Server Not Appearing

1. Check `~/.claude.json` syntax (valid JSON)
2. Restart Claude Code
3. Verify package exists: `npx -y package-name --help`

### Authentication Errors

1. Check API key in `env` object
2. Verify key permissions
3. Check server-specific docs for auth format

### Context Window Exhaustion

1. Disable unused servers with `disabledMcpServers`
2. Remove servers from global config
3. Use project-specific configs instead of global

### Server Timeout

Some servers need longer startup time:
```json
{
  "server-name": {
    "command": "npx",
    "args": ["-y", "package-name"],
    "timeout": 30000
  }
}
```

---

## Creating Custom Servers

For internal tools, create custom MCP servers:

```typescript
// Minimal MCP server with TypeScript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "my-server",
  version: "1.0.0"
}, {
  capabilities: { tools: {} }
});

// Add tools, resources, prompts...

const transport = new StdioServerTransport();
await server.connect(transport);
```

See [MCP SDK docs](https://modelcontextprotocol.io/docs) for full guide.

---

## References

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP SDK (TypeScript)](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP Docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
