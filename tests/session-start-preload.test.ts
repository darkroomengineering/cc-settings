// SessionStart starts two background bun scripts. A child bun does not inherit the
// parent's --config, so it must be started with the shipped bunfig itself or a
// project bunfig.toml `preload` runs inside it.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SESSION_START = join(REPO, "src", "scripts", "session-start.ts");
const BUNFIG = join(REPO, "src", "bunfig.toml");

async function waitFor(path: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await Bun.sleep(50);
  }
  return existsSync(path);
}

describe("session-start background scripts", () => {
  test("a project bunfig.toml preload does not run in them", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-session-preload-"));
    try {
      const home = join(root, "home");
      const project = join(root, "project");
      const scripts = join(home, ".claude", "src", "scripts");
      await mkdir(scripts, { recursive: true });
      await mkdir(project, { recursive: true });
      await copyFile(BUNFIG, join(home, ".claude", "src", "bunfig.toml"));
      const ran = (name: string) => join(root, `${name}-ran`);
      for (const name of ["prune-mcp-auth-cache", "refresh-knowledge-index"]) {
        await writeFile(
          join(scripts, `${name}.ts`),
          `await Bun.write(${JSON.stringify(ran(name))}, "x");\n`,
        );
      }
      const preloadMarker = join(root, "preload-ran");
      await writeFile(join(project, "bunfig.toml"), 'preload = ["./p.ts"]\n');
      await writeFile(
        join(project, "p.ts"),
        `await Bun.write(${JSON.stringify(preloadMarker)}, "x");\n`,
      );

      const proc = Bun.spawn(["bun", "--no-env-file", `--config=${BUNFIG}`, SESSION_START], {
        cwd: project,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        stdin: new Blob(["{}"]),
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;

      // Both children ran, so the absence of the preload marker is meaningful.
      expect(await waitFor(ran("prune-mcp-auth-cache"), 10_000)).toBe(true);
      expect(await waitFor(ran("refresh-knowledge-index"), 10_000)).toBe(true);
      await Bun.sleep(300);
      expect(existsSync(preloadMarker)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
