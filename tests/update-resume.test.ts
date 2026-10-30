import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeUpdateResume, UPDATE_RESUME_FILE } from "../src/lib/update-resume.ts";

let dir: string;
const NOW = 1_800_000_000_000;
const marker = () => join(dir, UPDATE_RESUME_FILE);
const write = (m: unknown) => writeFile(marker(), typeof m === "string" ? m : JSON.stringify(m));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "update-resume-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("consumeUpdateResume", () => {
  test("no marker prints nothing", async () => {
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
  });

  test("a fresh marker for this project prints the handoff once and is deleted", async () => {
    await write({
      cwd: "/p",
      version: "15.92.0",
      handoff: "/h/latest.md",
      restartFor: ["CLAUDE.md"],
      at: NOW - 60_000,
    });
    const lines = await consumeUpdateResume(dir, "/p", NOW);
    expect(lines.join("\n")).toContain("v15.92.0");
    expect(lines.join("\n")).toContain("/h/latest.md");
    expect(lines.join("\n")).toContain("CLAUDE.md");
    expect(existsSync(marker())).toBe(false);
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
  });

  test("a fresh marker from another project is left for that project", async () => {
    await write({ cwd: "/other", version: "1.0.0", at: NOW });
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
    expect(existsSync(marker())).toBe(true);
  });

  test("a stale marker is deleted without printing", async () => {
    await write({ cwd: "/p", version: "1.0.0", at: NOW - 3 * 60 * 60 * 1000 });
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  });

  test("a stale marker from another project is also deleted", async () => {
    await write({ cwd: "/other", version: "1.0.0", at: NOW - 3 * 60 * 60 * 1000 });
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  });

  test("a malformed marker is deleted without printing", async () => {
    await write("{not json");
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
    expect(existsSync(marker())).toBe(false);
  });

  test("a marker dated in the future is not honored", async () => {
    await write({ cwd: "/p", version: "1.0.0", at: NOW + 60_000 });
    expect(await consumeUpdateResume(dir, "/p", NOW)).toEqual([]);
  });
});
