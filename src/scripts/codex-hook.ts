#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

interface HookPayload {
  prompt?: unknown;
  session_id?: unknown;
  tool_input?: unknown;
}

function fail(message: string): never {
  console.error(`[codex-hook] ${message}`);
  process.exit(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarEnvValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function resolveTarget(pluginRoot: string, relativeScript: string): string {
  if (
    !relativeScript ||
    isAbsolute(relativeScript) ||
    relativeScript.split(/[\\/]+/).includes("..")
  ) {
    fail("target must be a safe relative path");
  }
  if (!relativeScript.endsWith(".ts")) fail("target must be a TypeScript file");

  let root: string;
  let target: string;
  try {
    root = realpathSync(pluginRoot);
    target = realpathSync(resolve(root, relativeScript));
  } catch {
    fail(`target does not exist: ${relativeScript}`);
  }
  if (!target.endsWith(".ts")) fail("target must resolve to a TypeScript file");

  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    fail("target resolves outside PLUGIN_ROOT");
  }
  return target;
}

async function main(): Promise<number> {
  const [relativeScript, ...targetArgs] = process.argv.slice(2);
  const pluginRoot = process.env.PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) fail("PLUGIN_ROOT is required");
  if (!relativeScript) fail("missing relative script target");

  const target = resolveTarget(pluginRoot, relativeScript);
  const rawInput = await Bun.stdin.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    fail("stdin must contain one JSON object");
  }
  if (!isRecord(parsed)) fail("stdin must contain one JSON object");

  const payload: HookPayload = parsed;
  const compatibilityEnv: Record<string, string> = {
    CC_SETTINGS_HOME: process.env.PLUGIN_DATA ?? pluginRoot,
    CC_SETTINGS_SOURCE: pluginRoot,
  };

  if (isRecord(payload.tool_input)) {
    compatibilityEnv.TOOL_INPUT = JSON.stringify(payload.tool_input);
    for (const [key, value] of Object.entries(payload.tool_input)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      const scalar = scalarEnvValue(value);
      if (scalar !== undefined) compatibilityEnv[`TOOL_INPUT_${key}`] = scalar;
    }
  }
  if (typeof payload.prompt === "string") compatibilityEnv.PROMPT = payload.prompt;
  if (typeof payload.session_id === "string") {
    compatibilityEnv.CLAUDE_SESSION_ID = payload.session_id;
    compatibilityEnv.CLAUDE_CODE_SESSION_ID = payload.session_id;
  }

  const child = Bun.spawn(["bun", target, ...targetArgs], {
    env: { ...process.env, ...compatibilityEnv },
    stdin: new Blob([rawInput]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

process.exit(await main());
