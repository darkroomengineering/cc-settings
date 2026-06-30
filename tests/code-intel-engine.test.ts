import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ENGINE_ID,
  ENGINES,
  EngineDescriptorSchema,
  getEngine,
  KNOWN_ENGINE_IDS,
  resolveEngine,
} from "../src/lib/code-intel-engine.ts";

const ENV_KEY = "CC_CODE_INTEL_ENGINE";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ccengine-"));
}

async function writeSentinel(dir: string, engine: string | null): Promise<void> {
  const payload: Record<string, unknown> = { version: "1.0.0", repo_path: "/x" };
  if (engine) payload.engine = engine;
  await writeFile(join(dir, ".cc-settings-version"), JSON.stringify(payload));
}

describe("descriptors", () => {
  test("every registered engine validates against the schema", () => {
    for (const id of KNOWN_ENGINE_IDS) {
      const parsed = EngineDescriptorSchema.safeParse(ENGINES[id]);
      expect(parsed.success).toBe(true);
    }
  });

  test("default is llm-tldr and is registered", () => {
    expect(DEFAULT_ENGINE_ID).toBe("llm-tldr");
    expect(KNOWN_ENGINE_IDS).toContain("llm-tldr");
  });
});

describe("regression: getEngine('llm-tldr') reproduces config/20-mcp.json", () => {
  test("command, args, serverInstructions match the static fragment exactly", async () => {
    const cfg = JSON.parse(
      await Bun.file(join(import.meta.dir, "..", "config", "20-mcp.json")).text(),
    );
    const tldr = cfg.mcpServers.tldr;
    const engine = getEngine("llm-tldr", "/tmp/ignored");
    expect(engine.mcp.command).toBe(tldr.command);
    expect(engine.mcp.args).toEqual(tldr.args);
    expect(engine.serverInstructions).toBe(tldr.serverInstructions);
  });
});

describe("finalize", () => {
  test("native-ts points mcp.args at the install's codemap server", () => {
    const claudeDir = join("/home/u/.claude");
    const engine = getEngine("native-ts", claudeDir);
    expect(engine.mcp.command).toBe("bun");
    // Build the expected path with join so the assertion holds on Windows too
    // (nativeMcpServerPath uses path.join → backslashes there).
    expect(engine.mcp.args).toEqual([join(claudeDir, "src", "codemap", "mcp-server.ts")]);
  });
});

describe("resolveEngine", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  test("env override wins over the sentinel", async () => {
    const dir = await tmp();
    try {
      await writeSentinel(dir, "llm-tldr");
      process.env[ENV_KEY] = "native-ts";
      expect((await resolveEngine(dir)).id).toBe("native-ts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unknown id falls back to the default", async () => {
    const dir = await tmp();
    try {
      process.env[ENV_KEY] = "does-not-exist";
      expect((await resolveEngine(dir)).id).toBe(DEFAULT_ENGINE_ID);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads the engine from the sentinel when no env override", async () => {
    const dir = await tmp();
    try {
      await writeSentinel(dir, "native-ts");
      expect((await resolveEngine(dir)).id).toBe("native-ts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no env + no sentinel ⇒ default", async () => {
    const dir = await tmp();
    try {
      expect((await resolveEngine(dir)).id).toBe(DEFAULT_ENGINE_ID);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
