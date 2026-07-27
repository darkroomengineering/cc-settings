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

async function writeSentinel(
  dir: string,
  engine: string | null,
  explicit?: boolean,
): Promise<void> {
  const payload: Record<string, unknown> = { version: "1.0.0", repo_path: "/x" };
  if (engine) payload.engine = engine;
  if (explicit !== undefined) payload.engine_explicit = explicit;
  await writeFile(join(dir, ".cc-settings-version"), JSON.stringify(payload));
}

describe("descriptors", () => {
  test("every registered engine validates against the schema", () => {
    for (const id of KNOWN_ENGINE_IDS) {
      const parsed = EngineDescriptorSchema.safeParse(ENGINES[id]);
      expect(parsed.success).toBe(true);
    }
  });

  // Flipped in v12.9.0 — llm-tldr is archived upstream and silently returns
  // empty results on non-Python code (its `language` param defaults to python).
  test("default is native-ts and is registered", () => {
    expect(DEFAULT_ENGINE_ID).toBe("native-ts");
    expect(KNOWN_ENGINE_IDS).toContain("native-ts");
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
      await writeSentinel(dir, "llm-tldr", true);
      process.env[ENV_KEY] = "native-ts";
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe("native-ts");
      expect(result.explicit).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // An unknown/mistyped env id falls back to the default, but must NOT be
  // marked explicit — stamping it would pin the typo's fallback into the
  // sentinel permanently.
  test("unknown id falls back to the default and is NOT explicit", async () => {
    const dir = await tmp();
    try {
      process.env[ENV_KEY] = "does-not-exist";
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe(DEFAULT_ENGINE_ID);
      expect(result.explicit).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads the engine from the sentinel when no env override AND engine_explicit is true", async () => {
    const dir = await tmp();
    try {
      await writeSentinel(dir, "native-ts", true);
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe("native-ts");
      expect(result.explicit).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // FIX A regression: an implicit legacy sentinel (engine present, but
  // engine_explicit absent/false) must NOT pin the sentinel's engine — it was
  // just the default at stamp time, not a user choice, so a changed
  // DEFAULT_ENGINE_ID must reach it on this resolution.
  test("sentinel engine with engine_explicit absent/false ⇒ default, NOT the sentinel value", async () => {
    const dir = await tmp();
    try {
      await writeSentinel(dir, "llm-tldr"); // no engine_explicit field at all
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe(DEFAULT_ENGINE_ID);
      expect(result.engine.id).not.toBe("llm-tldr");
      expect(result.explicit).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const dir2 = await tmp();
    try {
      await writeSentinel(dir2, "llm-tldr", false); // explicitly false
      const result2 = await resolveEngine(dir2);
      expect(result2.engine.id).toBe(DEFAULT_ENGINE_ID);
      expect(result2.explicit).toBe(false);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  // Codex review: a legacy sentinel (no engine_explicit) holding a NON-default
  // engine could only have come from an explicit env opt-in, since llm-tldr was
  // the default at stamp time. Those opt-ins must survive the v12.9.0 flip.
  test("legacy sentinel with a non-default engine is treated as an explicit opt-in", async () => {
    const dir = await tmp();
    try {
      await writeSentinel(dir, "codebase-memory"); // no engine_explicit field
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe("codebase-memory");
      expect(result.explicit).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no env + no sentinel ⇒ default", async () => {
    const dir = await tmp();
    try {
      const result = await resolveEngine(dir);
      expect(result.engine.id).toBe(DEFAULT_ENGINE_ID);
      expect(result.explicit).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
