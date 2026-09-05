import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCapture } from "./support/proc.ts";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "tool-cadence.ts");

test("irrelevant Read and Write calls emit nothing and create no state", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-cadence-"));
  try {
    for (const toolName of ["Read", "Write"]) {
      const result = await spawnCapture(["bun", HOOK], {
        env: { HOME: home, USERPROFILE: home },
        stdin: JSON.stringify({ tool_name: toolName, tool_input: { file_path: "/tmp/file.ts" } }),
        stderr: "ignore",
      });
      expect(result.exit).toBe(0);
      expect(result.stdout.trim()).toBe("");
    }
    expect(existsSync(join(home, ".claude"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
