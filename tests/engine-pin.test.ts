import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CryptoHasher } from "bun";
import type { EngineDescriptor } from "../src/lib/code-intel-engine.ts";
import {
  ensurePinnedEngine,
  installedBinaryPath,
  platformKey,
  readPinRecord,
  verifyPinnedEngine,
} from "../src/lib/engine-pin.ts";

const CONTENT = "fake-binary-content-v1";

function sha256(s: string): string {
  const h = new CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex");
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ccpin-"));
}

function makeEngine(checksums: Record<string, string>): EngineDescriptor {
  return {
    id: "test-dl",
    mcpServerName: "tldr",
    install: {
      method: "download",
      // No placeholders needed — fetch is stubbed, so the URL is never hit.
      url: "https://example.invalid/test-bin",
      version: "1.0.0",
      binName: "test-bin",
      checksums,
    },
    mcp: { command: "", args: [] },
    cli: { command: "", supportsDaemon: false, verbMap: {} },
    languages: "multi",
    serverInstructions: "test",
  };
}

const originalFetch = globalThis.fetch;

function stubFetch(
  impl: () => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>,
): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

function okFetch(content: string) {
  return async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ensurePinnedEngine", () => {
  test("matching checksum installs the binary + writes the pin", async () => {
    const dir = await tmp();
    try {
      stubFetch(okFetch(CONTENT));
      const engine = makeEngine({ [platformKey()]: sha256(CONTENT) });
      const dest = await ensurePinnedEngine(engine, dir);
      expect(dest).toBe(installedBinaryPath(engine, dir));
      expect(existsSync(dest as string)).toBe(true);
      const pin = await readPinRecord(dir);
      expect(pin?.id).toBe("test-dl");
      expect(pin?.sha256).toBe(sha256(CONTENT));
      expect(await verifyPinnedEngine(engine, dir)).toBe("match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("checksum mismatch throws and leaves no binary or pin", async () => {
    const dir = await tmp();
    try {
      stubFetch(okFetch(CONTENT));
      // Pin a wrong (but well-formed) checksum so the download fails verification.
      const engine = makeEngine({ [platformKey()]: "0".repeat(64) });
      await expect(ensurePinnedEngine(engine, dir)).rejects.toThrow(/checksum mismatch/);
      expect(existsSync(installedBinaryPath(engine, dir))).toBe(false);
      expect(await readPinRecord(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no pinned checksum for this platform ⇒ null, no throw", async () => {
    const dir = await tmp();
    try {
      stubFetch(okFetch(CONTENT));
      const engine = makeEngine({});
      expect(await ensurePinnedEngine(engine, dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("HTTP error ⇒ null (fail-soft)", async () => {
    const dir = await tmp();
    try {
      stubFetch(async () => ({
        ok: false,
        status: 500,
        arrayBuffer: async () => new ArrayBuffer(0),
      }));
      const engine = makeEngine({ [platformKey()]: sha256(CONTENT) });
      expect(await ensurePinnedEngine(engine, dir)).toBeNull();
      expect(existsSync(installedBinaryPath(engine, dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("verifyPinnedEngine", () => {
  test("tampered binary ⇒ mismatch", async () => {
    const dir = await tmp();
    try {
      stubFetch(okFetch(CONTENT));
      const engine = makeEngine({ [platformKey()]: sha256(CONTENT) });
      const dest = await ensurePinnedEngine(engine, dir);
      expect(await verifyPinnedEngine(engine, dir)).toBe("match");
      // Tamper with the installed bytes after a valid install.
      await Bun.write(dest as string, "tampered-payload");
      expect(await verifyPinnedEngine(engine, dir)).toBe("mismatch");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-download engine ⇒ missing (nothing pinned)", async () => {
    const dir = await tmp();
    try {
      const pythonEngine: EngineDescriptor = {
        id: "llm-tldr",
        mcpServerName: "tldr",
        install: { method: "python", pkg: "llm-tldr", checkCmd: "tldr" },
        mcp: { command: "tldr-mcp", args: [] },
        cli: { command: "tldr", supportsDaemon: true, verbMap: { daemon: "daemon" } },
        languages: "multi",
        serverInstructions: "x",
      };
      expect(await verifyPinnedEngine(pythonEngine, dir)).toBe("missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
