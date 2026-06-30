// Code-intelligence engine indirection — the single source of truth for which
// engine backs the `tldr` MCP server.
//
// cc-settings historically hard-wired one engine (llm-tldr, an abandoned pipx
// Python tool) into ~6 surfaces. This module makes the engine swappable behind
// a stable contract: the MCP server key stays "tldr" and the 18 mcp__tldr__*
// tool names never change — only the process behind them does. Selection is a
// single GLOBAL choice (the tldr server in ~/.claude.json is global), resolved
// once per install / per hook run as:
//
//   process.env.CC_CODE_INTEL_ENGINE  >  install sentinel `engine`  >  default
//
// Default stays "llm-tldr" so behavior is byte-for-byte unchanged unless a user
// opts in. Per-project native-vs-external routing behind the same server name
// is deferred to a future MCP proxy — not built here.
//
// engine-pin.ts owns the download/verify mechanics (and installedBinaryPath,
// re-exported below). This module imports it for values; engine-pin imports only
// our EngineDescriptor type back (erased — no runtime cycle).

import { join } from "node:path";
import { z } from "zod";
import { ensurePinnedEngine, installedBinaryPath, verifyPinnedEngine } from "./engine-pin.ts";
import { ensurePythonPackage } from "./packages.ts";
import { CLAUDE_DIR, hasCommand } from "./platform.ts";
import { readSentinelInfo } from "./version-delta.ts";

// Re-export so engine-pin's path helper stays the public surface through this
// module — callers import everything engine-related from here.
export { installedBinaryPath };

// How an engine is provisioned. Discriminated on `method`:
//   python   — a pip/pipx package exposing a CLI (the llm-tldr shape)
//   none     — nothing to install; runs from the cc-settings src tree (native-ts)
//   download — a pinned static binary, checksum-verified per platform
const InstallSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("python"),
    pkg: z.string(),
    checkCmd: z.string(),
  }),
  z.object({ method: z.literal("none") }),
  z.object({
    method: z.literal("download"),
    url: z.string(),
    version: z.string(),
    binName: z.string(),
    // Per-platform (`<platform>-<arch>`) SHA256 hex. Empty ⇒ install refuses
    // (no pin for any platform), which is how the codebase-memory placeholder
    // stays disabled until real checksums are filled in.
    checksums: z.record(z.string(), z.string().length(64)),
  }),
]);

export const EngineDescriptorSchema = z.object({
  id: z.string().min(1),
  // The contract: the MCP server key is always "tldr" regardless of engine.
  mcpServerName: z.literal("tldr"),
  install: InstallSchema,
  // What ~/.claude.json's tldr server runs. finalize() fills install-location
  // paths (native-ts args, download command) at resolve time.
  mcp: z.object({
    command: z.string(),
    args: z.array(z.string()),
  }),
  // The CLI the lifecycle hooks (session-start daemon/warm, post-edit notify)
  // drive. supportsDaemon=false ⇒ those hooks skip the engine entirely.
  cli: z.object({
    command: z.string(),
    supportsDaemon: z.boolean(),
    // Maps logical verbs ("daemon", "warm") to the engine's actual subcommand,
    // so hooks never hardcode an engine's CLI surface.
    verbMap: z.record(z.string(), z.string()),
  }),
  languages: z.enum(["ts-js", "multi"]),
  provenance: z
    .object({
      slsa: z.boolean(),
      sigstore: z.boolean(),
    })
    .optional(),
  serverInstructions: z.string(),
});

export type EngineDescriptor = z.infer<typeof EngineDescriptorSchema>;

export const DEFAULT_ENGINE_ID = "llm-tldr";

// llm-tldr's serverInstructions are copied VERBATIM from config/20-mcp.json's
// tldr block — this string is the regression guard (a test asserts the default
// engine reproduces the static fragment exactly). Do not edit without updating
// both in lockstep.
export const ENGINES: Record<string, EngineDescriptor> = {
  "llm-tldr": {
    id: "llm-tldr",
    mcpServerName: "tldr",
    install: { method: "python", pkg: "llm-tldr", checkCmd: "tldr" },
    mcp: { command: "tldr-mcp", args: ["--project", "."] },
    cli: { command: "tldr", supportsDaemon: true, verbMap: { daemon: "daemon", warm: "warm" } },
    languages: "multi",
    serverInstructions:
      "Semantic codebase analysis and repository-level search over the current project. 17 languages auto-detected. Use when you need to find where something is implemented, understand large or unfamiliar code, trace call graphs, or answer questions that require scanning many files across the codebase. Do not hardcode the language parameter — auto-detection is preferred.",
  },

  "native-ts": {
    id: "native-ts",
    mcpServerName: "tldr",
    install: { method: "none" },
    // command is "bun"; args are filled by finalize() with the installed
    // codemap MCP server path (it lives in the cc-settings src tree).
    mcp: { command: "bun", args: [] },
    cli: { command: "", supportsDaemon: false, verbMap: {} },
    languages: "ts-js",
    serverInstructions:
      "Native TypeScript codemap analysis over the current project (TypeScript/JavaScript only). Use to find where something is implemented, list a file's structure, trace cross-file call graphs and imports, find a symbol's callers, and map git-change impact. Built on the TypeScript compiler — there is no semantic/embedding search, dataflow, slicing, or dead-code analysis; use grep for free-text search.",
  },

  // Reference candidate — NOT enabled. Empty checksums make ensurePinnedEngine
  // refuse to install, so selecting it yields no working binary until real
  // pins + a download URL are filled in. Present to prove the download path is
  // engine-agnostic, not to ship a dependency.
  "codebase-memory": {
    id: "codebase-memory",
    mcpServerName: "tldr",
    install: {
      method: "download",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder tokens expanded by engine-pin.expandUrl
      url: "https://example.invalid/codebase-memory/releases/download/v${version}/codebase-memory-${platform}-${arch}",
      version: "0.0.0",
      binName: "codebase-memory",
      checksums: {},
    },
    mcp: { command: "", args: ["--stdio"] },
    cli: { command: "", supportsDaemon: false, verbMap: {} },
    languages: "multi",
    provenance: { slsa: true, sigstore: false },
    serverInstructions:
      "Code-intelligence knowledge graph over the current project (150+ languages). Use to find where something is implemented, trace call graphs, map architecture, and answer questions that require scanning many files. Placeholder engine — not yet enabled in cc-settings.",
  },
};

export const KNOWN_ENGINE_IDS = Object.keys(ENGINES);

/** Path to the native codemap MCP server inside an install's src tree. */
export function nativeMcpServerPath(claudeDir: string): string {
  return join(claudeDir, "src", "codemap", "mcp-server.ts");
}

/**
 * Clone a descriptor and fill install-location paths that are only known once
 * an install root (claudeDir) is fixed:
 *   native-ts  → mcp.args = [native codemap server path]
 *   download   → mcp.command = installed binary path
 * Other engines are returned as-is (deep clone). Pure — never touches disk.
 */
export function finalize(engine: EngineDescriptor, claudeDir: string): EngineDescriptor {
  const e = structuredClone(engine);
  if (e.id === "native-ts") {
    e.mcp.args = [nativeMcpServerPath(claudeDir)];
  } else if (e.install.method === "download") {
    e.mcp.command = installedBinaryPath(e, claudeDir);
  }
  return e;
}

/** Get a finalized descriptor by id. An unknown id falls back to the default
 *  engine (never throws) — selection is always resolvable. */
export function getEngine(id: string, claudeDir: string = CLAUDE_DIR): EngineDescriptor {
  const base = ENGINES[id] ?? ENGINES[DEFAULT_ENGINE_ID];
  // base is always defined: DEFAULT_ENGINE_ID is a registry key.
  return finalize(base as EngineDescriptor, claudeDir);
}

/** Resolve the active engine: env override > install sentinel > default.
 *  An unknown id at any tier resolves to the default via getEngine. Never throws. */
export async function resolveEngine(claudeDir: string = CLAUDE_DIR): Promise<EngineDescriptor> {
  const envId = process.env.CC_CODE_INTEL_ENGINE;
  if (envId) return getEngine(envId, claudeDir);
  const sentinel = await readSentinelInfo(claudeDir).catch(() => null);
  if (sentinel?.engine) return getEngine(sentinel.engine, claudeDir);
  return getEngine(DEFAULT_ENGINE_ID, claudeDir);
}

/**
 * Provision whatever the resolved engine needs:
 *   python   → install the package only if neither its CLI nor the MCP command
 *              is already on PATH (skip redundant work)
 *   none     → nothing to do (native-ts runs from the src tree)
 *   download → checksum-verified pinned-binary install (fail-soft / hard-fail
 *              per ensurePinnedEngine)
 */
export async function ensureEngineInstalled(
  engine: EngineDescriptor,
  claudeDir: string = CLAUDE_DIR,
): Promise<void> {
  const { install } = engine;
  if (install.method === "python") {
    if (!hasCommand(install.checkCmd) && !hasCommand(engine.mcp.command)) {
      await ensurePythonPackage(install.pkg, install.checkCmd);
    }
    return;
  }
  if (install.method === "none") return;
  if (install.method === "download") {
    await ensurePinnedEngine(engine, claudeDir);
  }
}

export { verifyPinnedEngine };
