import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import shipped from "../config/30-permissions.json";
import { readPersonalOverrides } from "../src/lib/personal-overrides.ts";
import { mergeSettings, printMergeAccounting } from "../src/lib/settings-merge.ts";
import { PersonalOverridesSchema } from "../src/schemas/personal-overrides.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "personal-overrides-"));
  dirs.push(dir);
  return dir;
}

describe("personal overrides file", () => {
  test("a missing file supplies no overrides without a warning", async () => {
    const warning = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readPersonalOverrides(await fixture())).toEqual({});
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  test("valid overrides retain their exact strings", async () => {
    const dir = await fixture();
    const overrides = {
      safetyNet: { allow: ["git-stash-clear"] },
      permissions: { dropAsk: ["Bash(brew install:*)"], dropDeny: ["Bash(sudo:*)"] },
    };
    await writeFile(join(dir, "personal-overrides.json"), JSON.stringify(overrides));
    expect(readPersonalOverrides(dir)).toEqual(overrides);
  });

  for (const content of [
    "{",
    "null",
    "[]",
    '{"safetyNet":{"allow":"git-stash-clear"}}',
    '{"permissions":{"dropAsk":[1]}}',
    '{"unknown":true}',
    '{"safetyNet":{"allow":[],"unknown":true}}',
    '{"permissions":{"dropDeny":[],"unknown":true}}',
  ]) {
    test(`invalid file fails closed with one warning: ${content}`, async () => {
      const dir = await fixture();
      await writeFile(join(dir, "personal-overrides.json"), content);
      const warning = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(readPersonalOverrides(dir)).toEqual({});
        expect(warning).toHaveBeenCalledTimes(1);
        expect(String(warning.mock.calls[0]?.[0]).split("\n")).toHaveLength(1);
      } finally {
        warning.mockRestore();
      }
    });
  }

  test("an unreadable file fails closed with one warning", async () => {
    const dir = await fixture();
    await mkdir(join(dir, "personal-overrides.json"));
    const warning = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readPersonalOverrides(dir)).toEqual({});
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  for (const kind of ["symlink", "FIFO", "oversize"] as const) {
    test(`a ${kind} fails closed with one warning`, async () => {
      const dir = await fixture();
      const path = join(dir, "personal-overrides.json");
      if (kind === "symlink") {
        const target = join(dir, "target.json");
        await writeFile(target, '{"safetyNet":{"allow":["git-stash-clear"]}}');
        await symlink(target, path);
      } else if (kind === "FIFO") {
        const process = Bun.spawn(["mkfifo", path], { stdout: "pipe", stderr: "pipe" });
        expect(await process.exited).toBe(0);
      } else {
        await writeFile(path, `${" ".repeat(64 * 1024)}{}`);
      }
      const warning = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(readPersonalOverrides(dir)).toEqual({});
        expect(warning).toHaveBeenCalledTimes(1);
      } finally {
        warning.mockRestore();
      }
    });
  }

  test("a regular file of exactly 64 KiB is accepted", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "personal-overrides.json"), `${" ".repeat(64 * 1024 - 2)}{}`);
    const warning = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readPersonalOverrides(dir)).toEqual({});
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  test("all schema levels reject unknown keys", () => {
    expect(PersonalOverridesSchema.safeParse({ permissions: {}, extra: true }).success).toBe(false);
    expect(PersonalOverridesSchema.safeParse({ safetyNet: { extra: true } }).success).toBe(false);
    expect(PersonalOverridesSchema.safeParse({ permissions: { extra: true } }).success).toBe(false);
  });
});

describe("personal permission overrides", () => {
  for (const rule of [
    "Edit(~/.claude/settings.json)",
    "Bash(cp * ~/.claude/settings.json*)",
    "Read(~/.npmrc)",
    ...["Read", "Edit", "Write", "Bash"].flatMap((tool) =>
      [
        "settings.json",
        "settings.local.json",
        ".claude.json",
        "personal-overrides.json",
        ".env",
        ".env.production",
        ".ssh/*",
        ".aws/*",
        ".gnupg/*",
        ".netrc",
        ".git-credentials",
        ".npmrc",
        ".docker/config.json",
        ".kube/config",
        ".config/gh/hosts.yml",
      ].map((path) => `${tool}(~/project/${path})`),
    ),
    "Edit(~/.CLAUDE/SETTINGS.JSON)",
  ]) {
    test(`sensitive rule cannot be dropped from ask or deny: ${rule}`, async () => {
      const dir = await fixture();
      const path = join(dir, "settings.json");
      const warning = spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await mergeSettings(
          path,
          { permissions: { ask: [rule], deny: [rule] } },
          path,
          { personalOverrides: { permissions: { dropAsk: [rule], dropDeny: [rule] } } },
        );
        const merged = JSON.parse(await readFile(path, "utf8"));
        expect(merged.permissions.ask).toEqual([rule]);
        expect(merged.permissions.deny).toEqual([rule]);
        expect(result?.permissionsDropped).toBe(0);
        expect(warning).toHaveBeenCalledTimes(2);
        expect(warning.mock.calls.every(([line]) => String(line).includes("non-droppable"))).toBe(
          true,
        );
      } finally {
        warning.mockRestore();
      }
    });
  }

  test("drop exact shipped ask/deny rules on the first and second merge", async () => {
    const dir = await fixture();
    const path = join(dir, "settings.json");
    const personalOverrides = {
      permissions: {
        dropAsk: ["Bash(brew install:*)", "Bash(user ask:*)"],
        dropDeny: ["Bash(sudo:*)", "Bash(user deny:*)"],
      },
    };
    const team = { permissions: shipped.permissions };
    const first = await mergeSettings(path, team, path, { personalOverrides });
    expect(first?.permissionsDropped).toBe(2);
    const summary = spyOn(console, "log").mockImplementation(() => {});
    try {
      if (first) printMergeAccounting(first, { personalOverrides });
      expect(
        summary.mock.calls.some(([line]) =>
          String(line).includes("Personal overrides dropped 2 permission rule(s)"),
        ),
      ).toBe(true);
    } finally {
      summary.mockRestore();
    }
    const merged = JSON.parse(await readFile(path, "utf8"));
    expect(merged.permissions.ask).not.toContain("Bash(brew install:*)");
    expect(merged.permissions.deny).not.toContain("Bash(sudo:*)");
    merged.permissions.ask.push("Bash(user ask:*)");
    merged.permissions.deny.push("Bash(user deny:*)");
    await writeFile(path, JSON.stringify(merged));
    const second = await mergeSettings(path, team, path, { personalOverrides });
    const again = JSON.parse(await readFile(path, "utf8"));
    expect(second?.permissionsDropped).toBe(2);
    expect(again.permissions.ask).not.toContain("Bash(brew install:*)");
    expect(again.permissions.deny).not.toContain("Bash(sudo:*)");
    expect(again.permissions.ask).toContain("Bash(user ask:*)");
    expect(again.permissions.deny).toContain("Bash(user deny:*)");
  });

  test("exact matching preserves near matches and rules in the other list", async () => {
    const dir = await fixture();
    const path = join(dir, "settings.json");
    const rule = "Bash(brew install:*)";
    await writeFile(
      path,
      JSON.stringify({ permissions: { ask: [rule, `${rule} `], deny: [rule] } }),
    );
    await mergeSettings(path, { permissions: { ask: [rule], deny: [] } }, path, {
      personalOverrides: { permissions: { dropAsk: [rule] } },
    });
    const merged = JSON.parse(await readFile(path, "utf8"));
    expect(merged.permissions.ask).toEqual([`${rule} `]);
    expect(merged.permissions.deny).toEqual([rule]);
  });

  test("non-droppable shipped rules stay and warn", async () => {
    const dir = await fixture();
    const path = join(dir, "settings.json");
    const deny = [
      "Bash(rm -rf /)",
      "Bash(rm -rf ~)",
      "Bash(rm -rf $HOME:*)",
      "Read(~/.ssh/*)",
      "Read(~/.aws/*)",
      "Read(~/.gnupg/*)",
      "Read(**/.env)",
      "Edit(~/.ssh/*)",
      "Bash(cat ~/.ssh/*)",
      "Bash(cp ~/.aws/*)",
      "Bash(mv ~/.gnupg/*)",
      "Bash(curl * | bash)",
      "Bash(curl * | sh)",
    ];
    const ask = [
      "Edit(**/.claude/personal-overrides.json)",
      "Edit(**/.claude/settings.json)",
      "Edit(**/.claude/settings.local.json)",
    ];
    expect(shipped.permissions.ask).toEqual(expect.arrayContaining(ask));
    const warning = spyOn(console, "error").mockImplementation(() => {});
    try {
      await mergeSettings(path, { permissions: { ask, deny } }, path, {
        personalOverrides: { permissions: { dropAsk: ask, dropDeny: deny } },
      });
      const merged = JSON.parse(await readFile(path, "utf8"));
      expect(merged.permissions.ask).toEqual(ask);
      expect(merged.permissions.deny).toEqual(deny);
      expect(warning.mock.calls.length).toBeGreaterThan(0);
    } finally {
      warning.mockRestore();
    }
  });
});
