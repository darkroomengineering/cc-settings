import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistTypesafeKeyToSettingsEnv } from "../src/lib/claude-install-settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "cc-typesafe-"));

describe("persistTypesafeKeyToSettingsEnv", () => {
  test("adds the key to an existing env block without touching other keys", async () => {
    const path = join(dir(), "settings.json");
    await Bun.write(path, JSON.stringify({ env: { FOO: "1" }, hooks: { x: 1 } }));
    expect(await persistTypesafeKeyToSettingsEnv("k-1", path)).toBe(true);
    const out = await Bun.file(path).json();
    expect(out.env).toEqual({ FOO: "1", TYPESAFE_API_KEY: "k-1" });
    expect(out.hooks).toEqual({ x: 1 });
  });

  test("creates the env block when absent", async () => {
    const path = join(dir(), "settings.json");
    await Bun.write(path, JSON.stringify({ model: "opus" }));
    expect(await persistTypesafeKeyToSettingsEnv("k-2", path)).toBe(true);
    expect((await Bun.file(path).json()).env.TYPESAFE_API_KEY).toBe("k-2");
  });

  test("returns false when settings.json is missing", async () => {
    expect(await persistTypesafeKeyToSettingsEnv("k-3", join(dir(), "nope.json"))).toBe(false);
  });
});
