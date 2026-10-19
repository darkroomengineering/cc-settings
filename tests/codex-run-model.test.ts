// End-to-end check of which `--model` argument reaches `codex`. A fake `codex` on
// PATH records its argv; codex-run.ts runs in a child so the PATH applies at launch.

import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const RUN = resolve(import.meta.dir, "../src/scripts/codex-run.ts");

async function spawnedArgv(
  args: string[],
  extraEnv: Record<string, string>,
): Promise<{ argv: string[]; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cc-codex-model-"));
  try {
    const argvFile = join(dir, "argv.txt");
    const fake = join(dir, "codex");
    await writeFile(
      fake,
      `#!/bin/sh\nif [ "$1" = "login" ]; then exit 0; fi\nprintf '%s\\n' "$@" > '${gitBashPath(argvFile)}'\necho ok\n`,
    );
    await chmod(fake, 0o755);
    const home = join(dir, "home");
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: prependTestPath(dir),
      HOME: home,
      USERPROFILE: home,
      ...extraEnv,
    };
    for (const key of ["CODEX_EXEC_MODEL", "CODEX_REVIEW_MODEL", "CODEX_ASK_MODEL"]) {
      if (!(key in extraEnv)) delete env[key];
    }
    const proc = Bun.spawn([process.execPath, RUN, ...args], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const argv = (await readFile(argvFile, "utf8")).split("\n").filter(Boolean);
    return { argv, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("codex-run.ts model argument", () => {
  test("no flag and no env passes no model flag to codex", async () => {
    const { argv, stderr } = await spawnedArgv(["ask", "what is 2+2"], {});
    expect(argv.slice(0, 2), stderr).toEqual(["exec", "--sandbox"]);
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("-m");
  });

  test("the env var pins the model", async () => {
    const { argv } = await spawnedArgv(["ask", "q"], { CODEX_ASK_MODEL: "env-model" });
    expect(argv[argv.indexOf("--model") + 1]).toBe("env-model");
  });

  test("--model beats the env var", async () => {
    const { argv } = await spawnedArgv(["ask", "--model", "flag-model", "q"], {
      CODEX_ASK_MODEL: "env-model",
    });
    expect(argv.filter((a) => a === "--model")).toHaveLength(1);
    expect(argv[argv.indexOf("--model") + 1]).toBe("flag-model");
  });
});
