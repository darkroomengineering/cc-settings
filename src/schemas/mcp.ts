import { z } from "zod";

// Fields that mcp-configs/recommended.json uses for documentation-only
// commentary. They're not part of Claude Code's contract but appear in the
// wild so we allow (and ignore) them.
const mcpCommentary = {
  _comment: z.string().optional(),
  _description: z.string().optional(),
  _usage: z.string().optional(),
  _contextCost: z.enum(["low", "medium", "high"]).optional(),
  _status: z.enum(["installed", "optional"]).optional(),
  serverInstructions: z.string().optional(),
};

// stdio transport: command + args + env. No `type` field (or `type: "stdio"`).
export const McpStdioServer = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ...mcpCommentary,
});

export const McpHttpServer = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  ...mcpCommentary,
});

// The stdio branch omits `type`, so we can't use a discriminated union keyed
// on `type`. A standard union is correct here — Claude Code detects stdio by
// the presence of `command`.
export const McpServer = z.union([McpHttpServer, McpStdioServer]);

export const McpServers = z.record(z.string(), McpServer);

export type McpStdioServer = z.infer<typeof McpStdioServer>;
export type McpHttpServer = z.infer<typeof McpHttpServer>;
export type McpServer = z.infer<typeof McpServer>;
export type McpServers = z.infer<typeof McpServers>;
