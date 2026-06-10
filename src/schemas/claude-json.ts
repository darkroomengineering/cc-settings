import { z } from "zod";
import { McpServers } from "./mcp.ts";

// ~/.claude.json is **Claude-Code-owned**. We write to it (via lib/mcp during
// MCP install) but the bulk of the file is opaque Claude Code state:
// project memory, conversation metadata, authentication details, etc.
//
// Loose-schema policy: schemas for files Claude Code also writes are loose
// (z.looseObject) for forward-compat — unknown keys written by newer Claude
// Code versions MUST survive a parse → mutate → write round-trip; a strict
// schema here would silently drop Claude-Code-owned state. Typo protection
// for the keys WE ship comes from the key-name guard test in
// tests/schemas.test.ts ("composed fragments contain only known keys"),
// not from schema strictness.

export const ClaudeJson = z.looseObject({
  mcpServers: McpServers.optional(),
  // Commonly-seen but undocumented (or under-documented) fields:
  firstStartTime: z.string().optional(),
  numStartups: z.number().int().nonnegative().optional(),
  installMethod: z.string().optional(),
  autoUpdates: z.boolean().optional(),
  // Everything else — Claude Code's working state — rides along untouched.
});

export type ClaudeJson = z.infer<typeof ClaudeJson>;
