import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const MARKER = /^(?:(?:<{7}|\|{7}|>{7})(?: |$)|={7}$)/;

test("no tracked text file contains a merge-conflict marker line", async () => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(listed.exitCode, listed.stderr.toString()).toBe(0);

  const hits: string[] = [];
  for (const path of listed.stdout.toString().split("\0").filter(Boolean)) {
    const abs = join(REPO, path);
    if (!existsSync(abs)) continue;
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer());
    if (bytes.includes(0)) continue;
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (MARKER.test(line)) hits.push(`${path}:${i + 1}: ${line.slice(0, 80)}`);
    });
  }

  expect(hits, `conflict markers found:\n${hits.join("\n")}`).toEqual([]);
});
