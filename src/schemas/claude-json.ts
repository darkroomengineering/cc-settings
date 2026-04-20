import { z } from "zod";
import { McpServers } from "./mcp.ts";

// ~/.claude.json is **Claude-Code-owned**. We write to it (via lib/mcp during
// MCP install) but the bulk of the file is opaque Claude Code state:
// project memory, conversation metadata, authentication details, etc.
//
// Per MIGRATION.md decision #5 ("schema strictness"), this is the *only*
// schema that uses `.passthrough()`. Fields we don't know about MUST be
// preserved verbatim on write — a strict schema here would silently drop
// Claude-Code-owned state.

export const ClaudeJson = z
  .object({
    mcpServers: McpServers.optional(),
    // Commonly-seen but undocumented (or under-documented) fields:
    firstStartTime: z.string().optional(),
    numStartups: z.number().int().nonnegative().optional(),
    installMethod: z.string().optional(),
    autoUpdates: z.boolean().optional(),
    // Everything else — Claude Code's working state — rides along untouched.
  })
  .passthrough();

export type ClaudeJson = z.infer<typeof ClaudeJson>;
