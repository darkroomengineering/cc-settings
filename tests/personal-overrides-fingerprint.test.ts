import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashHooks,
  verifyAgainstSettings,
  writeFingerprint,
  writeSrcManifest,
} from "../src/lib/hooks-fingerprint.ts";

test("personal overrides content is fingerprinted without changing the record format", async () => {
  const dir = await mkdtemp(join(tmpdir(), "overrides-fingerprint-"));
  try {
    const settings = { hooks: {} };
    const settingsPath = join(dir, "settings.json");
    const overridesPath = join(dir, "personal-overrides.json");
    await writeFile(settingsPath, JSON.stringify(settings));
    const absent = await writeFingerprint(settings, dir);
    expect(absent.hash).toBe(hashHooks(settings));
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("match");
    await writeFile(overridesPath, "");
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("match");
    await writeFile(overridesPath, "{}");
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("mismatch");
    const present = await writeFingerprint(settings, dir);
    expect(Object.keys(present)).toEqual(Object.keys(absent));
    expect(present.hash).not.toBe(absent.hash);
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("match");
    await writeFile(overridesPath, "{ }");
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("mismatch");
    expect(await readFile(overridesPath, "utf8")).toBe("{ }");
    await rm(overridesPath);
    expect((await verifyAgainstSettings(settingsPath, dir)).status).toBe("mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStart warns when personal overrides content changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "overrides-session-"));
  const dir = join(home, ".claude");
  try {
    await mkdir(dir);
    const settings = { hooks: {} };
    await writeFile(join(dir, "settings.json"), JSON.stringify(settings));
    await writeSrcManifest(join(dir, "src"), dir, []);
    await writeFingerprint(settings, dir);
    await writeFile(join(dir, "personal-overrides.json"), "{}");
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/hooks/verify-hooks.ts")], {
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("settings fingerprint mismatch");
    expect(stdout).toContain("personal-overrides.json");
    await rm(join(dir, "personal-overrides.json"));
    await mkdir(join(dir, "personal-overrides.json"));
    expect((await verifyAgainstSettings(join(dir, "settings.json"), dir)).status).toBe("mismatch");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
