import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireInstallLock } from "../src/lib/install-lock.ts";
import { spawnCapture } from "./support/proc.ts";

describe("install lock ownership", () => {
  test("competing stale claimants never both enter the destructive phase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-lock-race-"));
    try {
      // Isolate module mocking so unrelated tests never inherit this barrier.
      const script = `
import { mock } from "bun:test";
import * as fs from "node:fs/promises";
const original = { ...fs };
const path = ${JSON.stringify(join(dir, "install.lock"))};
await original.writeFile(path, JSON.stringify({ pid: 99999999, token: "stale" }));
await original.utimes(path, new Date(0), new Date(0));
let secondReady, firstReady, enteredReady;
const second = new Promise(resolve => { secondReady = resolve; });
const first = new Promise(resolve => { firstReady = resolve; });
const entered = new Promise(resolve => { enteredReady = resolve; });
let renames = 0;
mock.module("node:fs/promises", () => ({ ...original,
  rename: async (from, to) => {
    if (from === path) {
      if (++renames === 1) { enteredReady(); await second; }
      else { secondReady(); await first; }
    }
    return original.rename(from, to);
  },
}));
const { acquireInstallLock } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/lib/install-lock.ts"))});
const one = acquireInstallLock(path).then(release => { firstReady(); return release; });
await entered;
const two = acquireInstallLock(path).finally(() => secondReady());
const results = await Promise.allSettled([one, two]);
console.log(JSON.stringify({ holders: results.filter(result => result.status === "fulfilled").length }));
for (const result of results) if (result.status === "fulfilled") await result.value();
`;
      const result = await spawnCapture([process.execPath, "-e", script]);
      expect(result.exit).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ holders: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an old release callback cannot remove a replacement owner's lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-lock-release-"));
    const path = join(dir, "install.lock");
    try {
      const release = await acquireInstallLock(path);
      const replacement = JSON.stringify({ pid: process.pid, token: "replacement" });
      await writeFile(path, replacement);
      await release();
      expect(await readFile(path, "utf8")).toBe(replacement);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a stranded transition guard fails closed without deleting another owner's state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-lock-guard-"));
    const path = join(dir, "install.lock");
    try {
      await writeFile(`${path}.guard`, "interrupted transition");
      await expect(acquireInstallLock(path)).rejects.toThrow();
      expect(await readFile(`${path}.guard`, "utf8")).toBe("interrupted transition");
      expect(await Bun.file(path).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
