// Tests for src/lib/schedule.ts — the auto-update enrollment decision
// (decideAutoUpdate is security-critical: no silent enrollment) and the
// launchd plist mechanics.

import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_UPDATE_LABEL,
  autoUpdateStatus,
  buildPlist,
  decideAutoUpdate,
  isAllowedPullSource,
  plistPath,
  registerAutoUpdate,
  unregisterAutoUpdate,
  xmlEscape,
} from "../src/lib/schedule.ts";

describe("decideAutoUpdate — every flag × sentinel × TTY × jobPresent combination", () => {
  const flags = ["on", "off", null] as const;
  const sentinelValues = [true, false, undefined] as const;
  const ttyValues = [true, false] as const;
  const jobPresentValues = [true, false] as const;

  for (const flag of flags) {
    for (const sentinelValue of sentinelValues) {
      for (const isTTY of ttyValues) {
        for (const jobPresent of jobPresentValues) {
          const label = `flag=${flag} sentinel=${sentinelValue} isTTY=${isTTY} jobPresent=${jobPresent}`;
          test(label, () => {
            const decision = decideAutoUpdate({ flag, sentinelValue, isTTY, jobPresent });

            if (flag === "on") {
              expect(decision).toEqual({ kind: "set", enrolled: true });
            } else if (flag === "off") {
              expect(decision).toEqual({ kind: "set", enrolled: false });
            } else if (sentinelValue === false) {
              expect(decision).toEqual({ kind: "keep", enrolled: false });
            } else if (sentinelValue === true) {
              if (jobPresent) {
                expect(decision).toEqual({ kind: "keep", enrolled: true });
              } else if (isTTY) {
                expect(decision).toEqual({ kind: "ask" });
              } else {
                expect(decision).toEqual({ kind: "keep", enrolled: undefined });
              }
            } else if (isTTY) {
              expect(decision).toEqual({ kind: "ask" });
            } else {
              expect(decision).toEqual({ kind: "keep", enrolled: undefined });
            }
          });
        }
      }
    }
  }

  // The no-silent-enrollment guarantee, spelled out explicitly (not just
  // implied by the generated matrix above).
  test("SECURITY: flag=null, sentinel=undefined, isTTY=false → keep undefined (never silently enrolled)", () => {
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: undefined, isTTY: false, jobPresent: false }),
    ).toEqual({
      kind: "keep",
      enrolled: undefined,
    });
  });

  test("SECURITY: forged sentinel (auto_update:true, no matching job), non-interactive → NOT enrolled", () => {
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: true, isTTY: false, jobPresent: false }),
    ).toEqual({
      kind: "keep",
      enrolled: undefined,
    });
  });

  test("SECURITY: forged sentinel (auto_update:true, no matching job), interactive → re-prompt, not silent keep", () => {
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: true, isTTY: true, jobPresent: false }),
    ).toEqual({
      kind: "ask",
    });
  });

  test("legit sentinel (auto_update:true, matching job) → keep true, refresh without re-asking", () => {
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: true, isTTY: true, jobPresent: true }),
    ).toEqual({
      kind: "keep",
      enrolled: true,
    });
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: true, isTTY: false, jobPresent: true }),
    ).toEqual({
      kind: "keep",
      enrolled: true,
    });
  });

  test("flag always wins over a prior sentinel decision", () => {
    expect(
      decideAutoUpdate({ flag: "off", sentinelValue: true, isTTY: false, jobPresent: true }),
    ).toEqual({
      kind: "set",
      enrolled: false,
    });
    expect(
      decideAutoUpdate({ flag: "on", sentinelValue: false, isTTY: true, jobPresent: false }),
    ).toEqual({
      kind: "set",
      enrolled: true,
    });
  });

  test("a decided sentinel=false is never re-asked, even on a TTY", () => {
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: false, isTTY: true, jobPresent: false }),
    ).toEqual({
      kind: "keep",
      enrolled: false,
    });
    expect(
      decideAutoUpdate({ flag: null, sentinelValue: false, isTTY: true, jobPresent: true }),
    ).toEqual({
      kind: "keep",
      enrolled: false,
    });
  });
});

describe("isAllowedPullSource", () => {
  test("the real github url — bare — is allowed", () => {
    expect(isAllowedPullSource("https://github.com/darkroomengineering/cc-settings")).toBe(true);
  });

  test("the real github url with .git suffix is allowed", () => {
    expect(isAllowedPullSource("https://github.com/darkroomengineering/cc-settings.git")).toBe(
      true,
    );
  });

  test("the real github url with a trailing slash is allowed", () => {
    expect(isAllowedPullSource("https://github.com/darkroomengineering/cc-settings/")).toBe(true);
  });

  test("the real github url with .git and a trailing slash is allowed", () => {
    expect(isAllowedPullSource("https://github.com/darkroomengineering/cc-settings.git/")).toBe(
      true,
    );
  });

  test("a local filesystem path is rejected", () => {
    expect(isAllowedPullSource("/Users/attacker/evil-repo")).toBe(false);
  });

  test("an http (non-https) url is rejected", () => {
    expect(isAllowedPullSource("http://github.com/darkroomengineering/cc-settings")).toBe(false);
  });

  test("a different owner/repo is rejected", () => {
    expect(isAllowedPullSource("https://github.com/attacker/cc-settings")).toBe(false);
    expect(isAllowedPullSource("https://github.com/darkroomengineering/evil-repo")).toBe(false);
  });

  test("a different host is rejected", () => {
    expect(isAllowedPullSource("https://gitlab.com/darkroomengineering/cc-settings")).toBe(false);
  });

  test("the bare remote name 'origin' is rejected", () => {
    expect(isAllowedPullSource("origin")).toBe(false);
  });

  test("an empty string is rejected", () => {
    expect(isAllowedPullSource("")).toBe(false);
    expect(isAllowedPullSource("   ")).toBe(false);
  });
});

describe("xmlEscape", () => {
  test("escapes all five XML special characters", () => {
    expect(xmlEscape(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  test("ampersand escaped first — no double-escaping of entity refs", () => {
    expect(xmlEscape("&amp;")).toBe("&amp;amp;");
  });

  test("plain string passes through unchanged", () => {
    expect(xmlEscape("/Users/leandro/.claude/src/scripts/auto-update.ts")).toBe(
      "/Users/leandro/.claude/src/scripts/auto-update.ts",
    );
  });
});

describe("buildPlist", () => {
  const args = {
    bunPath: "/opt/homebrew/bin/bun",
    scriptPath: "/Users/leandro/.claude/src/scripts/auto-update.ts",
    logPath: "/Users/leandro/.claude/logs/auto-update.log",
  };

  test("contains the label, bun path, and script path", () => {
    const xml = buildPlist(args);
    expect(xml).toContain(AUTO_UPDATE_LABEL);
    expect(xml).toContain(args.bunPath);
    expect(xml).toContain(args.scriptPath);
  });

  test("defaults to Hour 10 / Minute 0", () => {
    const xml = buildPlist(args);
    expect(xml).toContain("<key>Hour</key>\n\t\t<integer>10</integer>");
    expect(xml).toContain("<key>Minute</key>\n\t\t<integer>0</integer>");
  });

  test("custom hour/minute override the default", () => {
    const xml = buildPlist({ ...args, hour: 9, minute: 30 });
    expect(xml).toContain("<integer>9</integer>");
    expect(xml).toContain("<integer>30</integer>");
    expect(xml).not.toContain("<integer>10</integer>");
  });

  test("both StandardOutPath and StandardErrorPath point at logPath", () => {
    const xml = buildPlist(args);
    const outMatches = xml.match(new RegExp(args.logPath.replace(/\//g, "\\/"), "g"));
    // logPath appears twice: StandardOutPath and StandardErrorPath.
    expect(outMatches?.length).toBe(2);
  });

  test("xml-special characters in paths (space, &) are escaped, not raw", () => {
    const xml = buildPlist({
      bunPath: "/Users/a b/My & Bun/bun",
      scriptPath: "/Users/a b/.claude/src/scripts/auto-update.ts",
      logPath: "/Users/a b/.claude/logs/auto-update.log",
    });
    expect(xml).toContain("My &amp; Bun");
    expect(xml).not.toContain("My & Bun");
  });

  test("no repoPath → no EnvironmentVariables dict", () => {
    const xml = buildPlist(args);
    expect(xml).not.toContain("EnvironmentVariables");
    expect(xml).not.toContain("CC_EXPECTED_REPO");
  });

  test("repoPath → embeds CC_EXPECTED_REPO in an EnvironmentVariables dict", () => {
    const xml = buildPlist({ ...args, repoPath: "/Users/leandro/projects/cc-settings" });
    expect(xml).toContain("<key>EnvironmentVariables</key>");
    expect(xml).toContain("<key>CC_EXPECTED_REPO</key>");
    expect(xml).toContain("<string>/Users/leandro/projects/cc-settings</string>");
  });

  test("repoPath with XML-special characters is escaped", () => {
    const xml = buildPlist({ ...args, repoPath: "/Users/a b/My & Repo" });
    expect(xml).toContain("My &amp; Repo");
    expect(xml).not.toContain("<string>/Users/a b/My & Repo</string>");
  });
});

describe("registerAutoUpdate — CC_SKIP_SCHEDULE=1 (no real launchctl ever)", () => {
  test("writes the plist file (mode 600, with CC_EXPECTED_REPO) under an injected fake home without spawning launchctl", async () => {
    if (process.platform !== "darwin") return; // registerAutoUpdate is a no-op on non-macOS

    // The fake home is INJECTED as a parameter, never via process.env.HOME —
    // homedir() does not follow an in-process HOME mutation on macOS, so the
    // env approach silently writes to the developer's real ~/Library.
    const fakeHome = await mkdtemp(join(tmpdir(), "cc-schedule-test-"));
    const claudeDir = join(fakeHome, ".claude");
    const fakeRepoPath = "/Users/leandro/projects/cc-settings";
    const originalSkip = process.env.CC_SKIP_SCHEDULE;
    process.env.CC_SKIP_SCHEDULE = "1";
    try {
      const result = await registerAutoUpdate(claudeDir, fakeHome, fakeRepoPath);
      expect(result.ok).toBe(true);
      expect(result.reason).toBe("skipped-launchctl");

      const plist = plistPath(fakeHome);
      expect(plist.startsWith(fakeHome)).toBe(true);
      expect(existsSync(plist)).toBe(true);
      const content = await readFile(plist, "utf8");
      expect(content).toContain(AUTO_UPDATE_LABEL);
      expect(content).toContain(join(claudeDir, "src", "scripts", "auto-update.ts"));
      // Log path must live inside the sandboxed claudeDir, not the real one.
      expect(content).toContain(join(claudeDir, "logs", "auto-update.log"));
      // Plist embeds the repo-path pin.
      expect(content).toContain("CC_EXPECTED_REPO");
      expect(content).toContain(fakeRepoPath);

      // Bun.write doesn't set mode — registerAutoUpdate must chmod 0o600.
      const mode = statSync(plist).mode & 0o777;
      expect(mode).toBe(0o600);

      const status = await autoUpdateStatus(fakeHome);
      expect(status.plistPresent).toBe(true);

      const removed = await unregisterAutoUpdate(fakeHome);
      expect(removed).toEqual({ ok: true, removed: true });
      expect(existsSync(plist)).toBe(false);
    } finally {
      if (originalSkip === undefined) delete process.env.CC_SKIP_SCHEDULE;
      else process.env.CC_SKIP_SCHEDULE = originalSkip;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
