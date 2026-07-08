// Regression for L12: project-init.ts --check must use the same isManaged()
// substring test the rest of the file uses to decide managed/unmanaged,
// instead of gating on projectAgentsVersion()'s digits-only regex — which
// fails to parse the "vunknown" version stamp written when
// ~/.claude/.cc-settings-version doesn't exist yet (a fresh dev checkout).
//
// HOME is sandboxed to a tmp dir so the spawned script can't touch real
// ~/.claude state — same pattern as tests/freeze.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "project-init.ts");

async function run(args: string[], home: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cc-project-init-"));
  await mkdir(join(home, ".claude"), { recursive: true });
  // SOURCE_AGENTS must exist for --init/--update, but --check never reads it —
  // only used by the other subcommands. Write it anyway for realism.
  await writeFile(join(home, ".claude", "AGENTS.md"), "# Standards\n");
  // Deliberately NOT writing .cc-settings-version — installedVersion() must
  // fall back to the literal "unknown", reproducing a fresh dev checkout.
  return home;
}

describe("project-init.ts --check", () => {
  test("AGENTS.md stamped with an unparseable version ('vunknown') reads as managed, not 'not managed'", async () => {
    const home = await makeHome();
    const project = await mkdtemp(join(tmpdir(), "cc-project-"));
    try {
      await writeFile(
        join(project, "AGENTS.md"),
        "<!-- cc-settings vunknown | 2026-07-08T00:00:00Z | DO NOT EDIT — managed by cc-settings -->\nbody\n",
      );
      const { stdout, exit } = await run(["--check", project], home);
      expect(exit).toBe(0);
      expect(stdout).not.toContain("not managed by cc-settings");
      expect(stdout.toLowerCase()).toContain("managed");
      expect(stdout).toContain("version unknown");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  });

  test("a genuinely unmanaged AGENTS.md (no cc-settings header) still reads as not managed", async () => {
    const home = await makeHome();
    const project = await mkdtemp(join(tmpdir(), "cc-project-"));
    try {
      await writeFile(join(project, "AGENTS.md"), "# My own standards\nNot cc-settings.\n");
      const { stdout } = await run(["--check", project], home);
      expect(stdout).toContain("not managed by cc-settings");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  });

  test("a managed AGENTS.md whose version matches installed reads as up to date", async () => {
    const home = await makeHome();
    await writeFile(
      join(home, ".claude", ".cc-settings-version"),
      JSON.stringify({ version: "12.0.0" }),
    );
    const project = await mkdtemp(join(tmpdir(), "cc-project-"));
    try {
      await writeFile(
        join(project, "AGENTS.md"),
        "<!-- cc-settings v12.0.0 | 2026-07-08T00:00:00Z | DO NOT EDIT — managed by cc-settings -->\nbody\n",
      );
      const { stdout } = await run(["--check", project], home);
      expect(stdout).toContain("up to date");
      expect(stdout).not.toContain("not managed");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  });
});
