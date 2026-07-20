#!/usr/bin/env bun
// Minimal newline-delimited JSON-RPC 2.0 stdio MCP server for the native TS
// codemap engine. No SDK — keeping the engine zero-dependency is the whole
// point, and the protocol surface we need (initialize, tools/list, tools/call,
// ping) is small.
//
// The server name is "tldr" and it exposes the 18 contract tool-name suffixes so
// the `tldr` skill's allowed-tools stays valid regardless of engine. The 7 tools
// the native engine doesn't implement (semantic/slice/cfg/dfg/dead/diagnostics/
// search) are still registered, but tools/call returns a structured
// {error:"unsupported-by-native-engine"} for them rather than failing.
//
// tools/list and tools/call dispatch both derive from the shared registry in
// tools.ts — see that file for the full tool table.

import { type Args, findToolByName, objSchema, TOOLS, UNSUPPORTED } from "./tools.ts";

function toolList(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const list = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  for (const name of UNSUPPORTED) {
    list.push({
      name,
      description: "Not implemented by the native TS engine — use the llm-tldr engine or grep.",
      inputSchema: objSchema({ project: "string" }),
    });
  }
  return list;
}

interface RpcMessage {
  id?: number | string | null;
  method?: string;
  params?: { name?: string; arguments?: Args };
}

function send(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function reply(
  id: RpcMessage["id"],
  result?: unknown,
  error?: { code: number; message: string },
): void {
  if (id === undefined || id === null) return; // notification — no response
  send(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result });
}

function textResult(payload: unknown, isError = false): Record<string, unknown> {
  const content = [{ type: "text", text: JSON.stringify(payload) }];
  return isError ? { content, isError: true } : { content };
}

async function callTool(id: RpcMessage["id"], params: RpcMessage["params"]): Promise<void> {
  const name = params?.name ?? "";
  const args: Args = params?.arguments ?? {};
  const tool = findToolByName(name);
  if (tool) {
    try {
      const result = await tool.handler(args);
      const payload =
        result === null
          ? {
              error: "unavailable",
              reason:
                "Could not build a TypeScript program — is `typescript` installed and is this a TS/JS project?",
            }
          : result;
      reply(id, textResult(payload));
    } catch (e) {
      reply(
        id,
        textResult({ error: "internal", message: String((e as Error)?.message ?? e) }, true),
      );
    }
    return;
  }
  if (UNSUPPORTED.includes(name)) {
    reply(
      id,
      textResult({
        error: "unsupported-by-native-engine",
        tool: name,
        reason:
          "The native TS codemap engine does not implement this. Switch engines (CC_CODE_INTEL_ENGINE=llm-tldr) or use grep.",
      }),
    );
    return;
  }
  reply(id, undefined, { code: -32602, message: `unknown tool: ${name}` });
}

async function handle(msg: RpcMessage): Promise<void> {
  switch (msg.method) {
    case "initialize":
      reply(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "tldr", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
      return; // notification — nothing to reply
    case "ping":
      reply(msg.id, {});
      return;
    case "tools/list":
      reply(msg.id, { tools: toolList() });
      return;
    case "tools/call":
      await callTool(msg.id, msg.params);
      return;
    default:
      if (msg.id !== undefined && msg.id !== null) {
        reply(msg.id, undefined, { code: -32601, message: `method not found: ${msg.method}` });
      }
  }
}

// Read newline-delimited JSON-RPC from stdin; one message per line. A malformed
// line is skipped, and a handler that throws never takes the server down.
const decoder = new TextDecoder();
let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += decoder.decode(chunk as Uint8Array);
  let nl = buf.indexOf("\n");
  while (nl >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      let msg: RpcMessage | null = null;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        msg = null;
      }
      if (msg) {
        try {
          await handle(msg);
        } catch {
          // never crash the server on a single bad message
        }
      }
    }
    nl = buf.indexOf("\n");
  }
}
