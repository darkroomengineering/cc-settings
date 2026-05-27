import { z } from "zod";

// Fields that mcp-configs/recommended.json uses for documentation-only
// commentary. They're not part of Claude Code's contract but appear in the
// wild so we allow (and ignore) them.
const mcpCommentary = {
  _comment: z.string().optional(),
  _description: z.string().optional(),
  _usage: z.string().optional(),
  _contextCost: z.enum(["low", "medium", "high"]).optional(),
  // `_status` annotates whether a server is part of the team-shipped baseline
  // ("core") or recommended-but-not-installed ("optional"). Onboarding signal
  // for new team members. The installer surfaces it in the post-install summary
  // and groups servers by status. Field is documentation-only — Claude Code
  // doesn't read it.
  _status: z.enum(["core", "optional"]).optional(),
  serverInstructions: z.string().optional(),
};

// Fields shared across all transports. `alwaysLoad` (v2.1.121) opts a server
// out of tool-search deferral — its tools are always available regardless of
// `ENABLE_TOOL_SEARCH`. Use for hot-path servers (e.g. docs lookup).
const mcpCommon = {
  alwaysLoad: z.boolean().optional(),
};

// stdio transport: command + args + env. No `type` field (or `type: "stdio"`).
export const McpStdioServer = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ...mcpCommon,
  ...mcpCommentary,
});

export const McpHttpServer = z.object({
  type: z.literal("http"),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  ...mcpCommon,
  ...mcpCommentary,
});

// SSE transport: server-sent events. Same shape as HTTP — distinguished only
// by the `type` discriminator. Used by local desktop MCPs (e.g. Figma at
// http://127.0.0.1:3845/sse) that stream events instead of using request/response.
export const McpSseServer = z.object({
  type: z.literal("sse"),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  ...mcpCommon,
  ...mcpCommentary,
});

// The stdio branch omits `type`, so we can't use a discriminated union keyed
// on `type`. A standard union is correct here — http and sse discriminate via
// `type`, stdio is detected by presence of `command`.
export const McpServer = z.union([McpHttpServer, McpSseServer, McpStdioServer]);

export const McpServers = z.record(z.string(), McpServer);

export type McpStdioServer = z.infer<typeof McpStdioServer>;
export type McpHttpServer = z.infer<typeof McpHttpServer>;
export type McpSseServer = z.infer<typeof McpSseServer>;
export type McpServer = z.infer<typeof McpServer>;
export type McpServers = z.infer<typeof McpServers>;
