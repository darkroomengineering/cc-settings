import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hooks from "../config/40-hooks.json";
import { classifyHookCommand } from "../src/lib/audit-hooks.ts";
import { MANAGED_BUN_PREFIX, parseHookCommand } from "../src/lib/hook-command.ts";
import {
  hashHooks,
  verifyAgainstSettings,
  writeFingerprint,
} from "../src/lib/hooks-fingerprint.ts";
import { readPersonalOverrides } from "../src/lib/personal-overrides.ts";
import { commandIsDeprecated, mergeSettings } from "../src/lib/settings-merge.ts";

test("setup bakes known sorted overrides into fingerprinted hooks and replaces them on reinstall", async () => {
  const dir = await mkdtemp(join(tmpdir(), "overrides-install-"));
  try {
    const path = join(dir, "settings.json");
    const overridesPath = join(dir, "personal-overrides.json");
    const base = `${MANAGED_BUN_PREFIX}"$HOME/.claude/src/hooks/dispatch.ts" PreToolUse`;
    const commands = async () => {
      const settings = JSON.parse(await readFile(path, "utf8"));
      return settings.hooks.PreToolUse.filter(
        (g: { matcher: string }) => g.matcher === "Bash",
      ).flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    };
    await mergeSettings(path, hooks, path);
    expect(await commands()).toEqual([base]);
    await writeFile(
      overridesPath,
      JSON.stringify({
        safetyNet: {
          allow: [
            "git-stash-clear",
            "made-up",
            "git-discard-worktree",
            "git-stash-clear",
            "git-push-main,git-force-push",
          ],
        },
      }),
    );
    await mergeSettings(path, hooks, path, { personalOverrides: readPersonalOverrides(dir) });
    expect(await commands()).toEqual([
      `${base} --safety-net-allow=git-discard-worktree,git-stash-clear`,
    ]);
    const settings = JSON.parse(await readFile(path, "utf8"));
    const record = await writeFingerprint(settings, dir);
    expect(record.hash).toBe(hashHooks(settings));
    await writeFile(overridesPath, JSON.stringify({ safetyNet: { allow: ["git-push-main"] } }));
    expect((await verifyAgainstSettings(path, dir)).status).toBe("match");
    await mergeSettings(path, hooks, path, { personalOverrides: readPersonalOverrides(dir) });
    expect(await commands()).toEqual([`${base} --safety-net-allow=git-push-main`]);
    expect((await verifyAgainstSettings(path, dir)).status).toBe("mismatch");
    await mergeSettings(path, hooks, path, { personalOverrides: { safetyNet: { allow: [] } } });
    expect(await commands()).toEqual([base]);
    await rm(overridesPath);
    await writeFile(overridesPath, "invalid");
    await writeFingerprint(JSON.parse(await readFile(path, "utf8")), dir);
    expect((await verifyAgainstSettings(path, dir)).status).toBe("match");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hook classification validates allow suffixes without deprecating the dispatcher", () => {
  const base = `${MANAGED_BUN_PREFIX}"$HOME/.claude/src/hooks/dispatch.ts" PreToolUse`;
  const integrity = {
    files: new Map([
      ["hooks/dispatch.ts", true],
      ["bunfig.toml", true],
    ]),
    fileExists: () => true,
  };
  for (const suffix of [
    "",
    " --safety-net-allow=git-push-main",
    " --safety-net-allow=git-push-main,git-stash-clear",
  ]) {
    expect(parseHookCommand(base + suffix).managed).toBe(true);
    expect(commandIsDeprecated(base + suffix)).toBe(false);
    expect(classifyHookCommand(base + suffix).severity).not.toBe("suspicious");
    expect(classifyHookCommand(base + suffix, integrity)).toEqual(
      classifyHookCommand(base, integrity),
    );
    expect(classifyHookCommand(base + suffix, integrity).severity).toBe("trusted");
  }
  for (const suffix of [
    "=",
    "=made-up",
    "=git-push-main,made-up",
    "=git-push-main,",
    "=git-push-main\n",
    "=Git-push-main",
    "=git-push-main --safety-net-allow=git-stash-clear",
    " git-push-main",
  ]) {
    const command = `${base} --safety-net-allow${suffix}`;
    expect(parseHookCommand(command).managed).toBe(false);
    expect(classifyHookCommand(command).severity).toBe("suspicious");
  }
});
