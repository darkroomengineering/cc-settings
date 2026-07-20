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
  // Per-server MCP tool-call timeout in ms (overrides the 60s default).
  // 2.1.206 fixed it being ignored for `--mcp-config` / `.mcp.json` servers.
  request_timeout_ms: z.number().int().positive().optional(),
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
// on `type`. A standard union is correct here — http/sse discriminate via the
// `type` literal, stdio by presence of `command`. The three are mutually
// exclusive on their required fields, so member order is cosmetic (it only
// affects error-message quality, not which valid input matches).
//
// Cross-shape guard (issue #83): each branch above is a plain (non-strict)
// z.object, by design — unknown fields must survive a parse for forward
// compat (newer Claude Code versions may add fields we don't model yet; see
// ClaudeJson's loose-schema policy). But that "strip, don't reject" default
// has a sharp edge: an entry that mixes stdio-only keys (command/args/env)
// with http/sse-only keys (url/headers) — e.g. a stdio→http migration typo
// like `{ command: "foo", url: "https://x" }` — silently matches the stdio
// branch with `url` dropped, instead of failing loudly. A blanket
// `z.strictObject()` would reject that, but it would *also* reject any
// benign field a future Claude Code version adds that we haven't modeled
// yet — exactly the forward-compat case the non-strict design protects
// (see installMcpToClaudeJson in src/lib/mcp.ts, which already has a
// raw-preserving fallback for real ~/.claude.json entries that fail schema
// validation for this reason). So instead of stricting the branches, we
// reject only the specific cross-shape conflict via a guard that runs on
// the raw input *before* the union strips anything, leaving unrelated
// unknown fields free to pass through as before.
const MCP_STDIO_ONLY_KEYS = ["command", "args", "env"] as const;
const MCP_NETWORK_ONLY_KEYS = ["url", "headers"] as const;

function hasAnyKey(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => key in obj);
}

const McpTransportShapeGuard = z
  .record(z.string(), z.unknown())
  .refine(
    (entry) => !(hasAnyKey(entry, MCP_STDIO_ONLY_KEYS) && hasAnyKey(entry, MCP_NETWORK_ONLY_KEYS)),
    {
      message:
        "MCP server entry mixes stdio fields (command/args/env) with http/sse fields (url/headers) — pick one transport",
    },
  );

export const McpServer = McpTransportShapeGuard.pipe(
  z.union([McpHttpServer, McpSseServer, McpStdioServer]),
);

export const McpServers = z.record(z.string(), McpServer);

export type McpStdioServer = z.infer<typeof McpStdioServer>;
export type McpHttpServer = z.infer<typeof McpHttpServer>;
export type McpSseServer = z.infer<typeof McpSseServer>;
export type McpServer = z.infer<typeof McpServer>;
export type McpServers = z.infer<typeof McpServers>;
