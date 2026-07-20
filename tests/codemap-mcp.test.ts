// Protocol-level coverage for the codemap MCP server: spawns the actual
// `mcp-server.ts` entrypoint, writes newline-delimited JSON-RPC frames to its
// stdin, and asserts on the reply shapes. Complements tests/codemap.test.ts
// (which exercises the engine functions directly, in-process).
//
// Mirrors the engine descriptor's spawn shape (`bun src/codemap/mcp-server.ts`,
// no `--project` flag — see src/lib/code-intel-engine.ts's `nativeMcpServerPath`
// / ENGINES["native-ts"].mcp.args): the project directory is passed per-call
// via `arguments.project`, not a server startup flag.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStatus } from "../src/codemap/index.ts";

const SERVER_PATH = join(import.meta.dir, "..", "src", "codemap", "mcp-server.ts");

// Single-file TypeScript fixture — enough to exercise a `structure` tools/call.
const dir = await mkdtemp(join(tmpdir(), "ccmap-mcp-"));
await writeFile(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      allowJs: true,
      noEmit: true,
    },
    files: ["a.ts"],
  }),
);
await writeFile(join(dir, "a.ts"), "export function foo() {\n  return 1;\n}\n");

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Resolved once up front (same pattern as tests/codemap.test.ts) so a
// degraded TypeScript engine shows up as an explicit "skipped" instead of a
// silent zero-assertion pass.
const engineAvailable = (await getStatus(dir)).available;

interface RpcReply {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Spawn the MCP server, write `requests` one per line, and collect one reply
 * line per request. Bounded by `timeoutMs`; the child is always killed in
 * `finally`, success or failure, so a hung server never leaks a process.
 */
async function callServer(requests: unknown[], timeoutMs = 10_000): Promise<RpcReply[]> {
  const proc = Bun.spawn([process.execPath, SERVER_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });

  const collect = (async (): Promise<RpcReply[]> => {
    const replies: RpcReply[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk as Uint8Array);
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          try {
            replies.push(JSON.parse(line) as RpcReply);
          } catch {
            // ignore malformed line
          }
        }
        nl = buf.indexOf("\n");
      }
      if (replies.length >= requests.length) break;
    }
    return replies;
  })();

  try {
    for (const req of requests) {
      proc.stdin.write(`${JSON.stringify(req)}\n`);
    }
    await proc.stdin.end();

    return await Promise.race([
      collect,
      new Promise<RpcReply[]>((_resolve, reject) =>
        setTimeout(() => reject(new Error("codemap MCP server test timed out")), timeoutMs),
      ),
    ]);
  } finally {
    proc.kill();
  }
}

describe("codemap MCP server (JSON-RPC over stdio)", () => {
  test.skipIf(!engineAvailable)(
    "initialize -> tools/list -> tools/call(structure) round-trip",
    async () => {
      const [initReply, listReply, callReply] = await callServer([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "structure", arguments: { project: dir } },
        },
      ]);

      // initialize
      expect(initReply?.jsonrpc).toBe("2.0");
      expect(initReply?.id).toBe(1);
      const initResult = initReply?.result as { serverInfo?: { name?: string } } | undefined;
      expect(initResult?.serverInfo?.name).toBe("tldr");

      // tools/list
      expect(listReply?.jsonrpc).toBe("2.0");
      expect(listReply?.id).toBe(2);
      const listResult = listReply?.result as { tools?: Array<{ name: string }> } | undefined;
      const toolNames = (listResult?.tools ?? []).map((t) => t.name);
      expect(toolNames).toContain("structure");
      expect(toolNames).toContain("change_impact");
      expect(toolNames).toContain("status");
      // Unsupported placeholders are still listed for contract completeness.
      expect(toolNames).toContain("semantic");

      // tools/call
      expect(callReply?.jsonrpc).toBe("2.0");
      expect(callReply?.id).toBe(3);
      const callResult = callReply?.result as
        | { content?: Array<{ type: string; text: string }> }
        | undefined;
      expect(callResult?.content?.[0]?.type).toBe("text");
      const payload = JSON.parse(callResult?.content?.[0]?.text ?? "{}") as {
        symbols?: Array<{ name: string }>;
      };
      expect(payload.symbols?.some((s) => s.name === "foo")).toBe(true);
    },
  );
});
