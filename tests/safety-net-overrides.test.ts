import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const hook = resolve(import.meta.dir, "../src/hooks/safety-net.ts");
// Outside the temp directory: the hook allows a recursive delete under /tmp,
// which is where tmpdir() points on Linux.
const fixture = mkdtempSync(join(homedir(), ".cc-safety-overrides-"));
const repo = join(fixture, "repo");
const subdir = join(repo, "src");
let nextHome = 0;

beforeAll(() => {
  mkdirSync(subdir, { recursive: true });
  symlinkSync(fixture, join(repo, "outside"));
  const git = Bun.spawnSync(["git", "init", "--initial-branch=feature", repo]);
  expect(git.exitCode).toBe(0);
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

async function decision(command: string, allow?: string[], cwd = repo): Promise<string> {
  const home = join(fixture, `home-${nextHome++}`);
  mkdirSync(join(home, ".claude"), { recursive: true });
  const child = Bun.spawn(
    [process.execPath, hook, ...(allow ? [`--safety-net-allow=${allow.join(",")}`] : [])],
    {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CC_SAFETY_GH_LOGIN: "",
        GH_REPO: "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
      },
      stdin: new Blob([JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd })]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(child.stdout).text();
  await new Response(child.stderr).text();
  const code = await child.exited;
  if (code === 2) return "block";
  if (code !== 0) return `error-${code}: ${stdout}`;
  return stdout.includes('"permissionDecision":"ask"') ? "ask" : "allow";
}

describe("personal safety-net overrides", () => {
  test("a malformed CLI list cannot grant a valid preceding ID", async () => {
    expect(
      await decision("git checkout -- src/file.ts", ["git-discard-worktree", "git-push-main\n"]),
    ).toBe("block");
  });
  test("runtime ignores the overrides file and environment but dispatch accepts its argument", async () => {
    const home = join(fixture, "runtime-home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude/personal-overrides.json"),
      JSON.stringify({ safetyNet: { allow: ["git-discard-worktree"] } }),
    );
    for (const [args, expected] of [
      [[hook], 2],
      [[resolve(import.meta.dir, "../src/hooks/dispatch.ts"), "PreToolUse"], 2],
      [
        [
          resolve(import.meta.dir, "../src/hooks/dispatch.ts"),
          "PreToolUse",
          "--safety-net-allow=git-discard-worktree",
        ],
        0,
      ],
    ] as const) {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: repo,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          SAFETY_NET_ALLOW: "git-discard-worktree",
          CC_SAFETY_NET_ALLOW: "git-discard-worktree",
        },
        stdin: new Blob([
          JSON.stringify({
            tool_name: "Bash",
            tool_input: { command: "git checkout -- src/file.ts" },
            cwd: repo,
          }),
        ]),
        stdout: "pipe",
        stderr: "pipe",
      });
      await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(await child.exited).toBe(expected);
    }
  });
  for (const [id, command, baseline] of [
    ["process-search-kill", "pkill -f server", "block"],
    ["process-search-kill", "kill $(pgrep server)", "block"],
    ["process-search-kill", "lsof -ti :3000 | xargs kill", "block"],
    ["git-discard-worktree", "git checkout -- src/file.ts", "block"],
    ["git-discard-worktree", "git checkout src/file.ts", "block"],
    ["git-discard-worktree", "git restore src/file.ts", "block"],
    ["git-stash-clear", "git stash clear", "block"],
    ["git-force-push", "git push --force origin feature", "block"],
    ["git-push-main", "git push origin main", "ask"],
    ["xargs-shell", "printf item | xargs sh -c 'echo ok'", "block"],
    ["gh-pr-create-unknown-owner", "gh pr create --title Test --body Test", "block"],
  ] as const) {
    test(`${id}: ${command}`, async () => {
      expect(await decision(command)).toBe(baseline);
      expect(await decision(command, [id])).toBe("allow");
      expect(await decision(`${command}; cat .env`, [id])).toBe("block");
    });
  }
  test("rm override requires repository containment", async () => {
    expect(await decision("rm -rf ../scratch", undefined, subdir)).toBe("block");
    expect(await decision("rm -rf ../scratch", ["rm-repo-target"], subdir)).toBe("allow");
    expect(await decision("rm -rf ../scratch; cat .env", ["rm-repo-target"], subdir)).toBe("block");
  });
  test("rm override does not apply after a directory change", async () => {
    for (const command of [
      "cd .. && rm -rf ../scratch",
      "pushd .. ; rm -rf ../scratch",
      "(cd ..; rm -rf ../scratch)",
      "c\\d .. && rm -rf ../scratch",
      "$X .. && rm -rf ../scratch",
    ]) {
      expect(await decision(command, ["rm-repo-target"], subdir)).toBe("block");
    }
  });
  test("rm override handles literal escapes without trusting symlinks or variables", async () => {
    expect(await decision("rm -rf ../scr\\atch", undefined, subdir)).toBe("block");
    expect(await decision("rm -rf ../scr\\atch", ["rm-repo-target"], subdir)).toBe("allow");
    expect(await decision("rm -rf ../outside/victim", ["rm-repo-target"], subdir)).toBe("block");
    expect(await decision("rm -rf ../$UNKNOWN", ["rm-repo-target"], subdir)).toBe("block");
  });
  test("rm override requires a whole plain rm invocation", async () => {
    for (const command of [
      "env -C /some/dir rm -rf Doc\\uments",
      ". ./x.sh && rm -rf Doc\\uments",
      "echo ok; rm -rf Doc\\uments",
      "rm -rf Doc\\uments | cat",
      "rm -rf Doc\\uments\necho ok",
      "rm -rf Doc\\uments > output",
      "/bin/rm -rf Doc\\uments",
    ]) {
      expect(await decision(command, ["rm-repo-target"], subdir)).toBe("block");
    }
    expect(await decision("  rm -rf ../scr\\atch  ", ["rm-repo-target"], subdir)).toBe("allow");
  });
  test("unknown-owner PR override cannot grant explicit repository operands", async () => {
    for (const command of [
      'R=other/x; gh pr create -R "$R" --title x --body y',
      'gh pr create -R "$(cat /tmp/r)" --title x --body y',
      'gh pr create --repo "$R" --title x --body y',
      'gh pr create --repo="$R" --title x --body y',
      'gh pr create -R="$R" --title x --body y',
      'gh pr create -R"$R" --title x --body y',
      "gh pr create -R other/x --title x --body y",
      'export GH_REPO="$R"; GH_REPO=other/x gh pr create --title x --body y',
    ]) {
      expect(await decision(command, ["gh-pr-create-unknown-owner"])).toBe("block");
    }
  });
  test("main push override cannot grant mirror pushes", async () => {
    for (const command of ["git push --mirror origin", "git push --mirror"]) {
      expect(await decision(command)).toBe("ask");
      expect(await decision(command, ["git-push-main"])).toBe("block");
    }
    const mirrorRepo = join(fixture, "mirror-repo");
    expect(Bun.spawnSync(["git", "init", "--initial-branch=feature", mirrorRepo]).exitCode).toBe(0);
    expect(
      Bun.spawnSync(["git", "-C", mirrorRepo, "config", "remote.origin.mirror", "true"]).exitCode,
    ).toBe(0);
    expect(
      Bun.spawnSync([
        "git",
        "-C",
        mirrorRepo,
        "config",
        "remote.origin.url",
        "https://github.com/darkroomengineering/test.git",
      ]).exitCode,
    ).toBe(0);
    for (const command of ["git push", "git push origin"]) {
      expect(await decision(command, undefined, mirrorRepo)).toBe("ask");
      expect(await decision(command, ["git-push-main"], mirrorRepo)).toBe("block");
    }
  });
  test("unknown IDs and floor reasons grant nothing", async () => {
    expect(
      await decision("git checkout -- .", [
        "made-up",
        "git checkout -- discards uncommitted changes",
      ]),
    ).toBe("block");
    for (const command of [
      "rm -rf /",
      "rm -rf ~",
      "cat .env",
      "git push --force origin main",
      "git push --force origin $UNKNOWN",
    ]) {
      expect(
        await decision(command, [
          "git-force-push",
          "git-push-main",
          "rm-repo-target",
          "cat .env",
          "internal-error",
        ]),
      ).toBe("block");
    }
  });
  test("main push override retains unknown and forced asks or blocks", async () => {
    expect(await decision("git push origin $UNKNOWN", ["git-push-main"])).toBe("ask");
    expect(
      await decision("git push --force-with-lease origin main", [
        "git-push-main",
        "git-force-push",
      ]),
    ).toBe("block");
  });
  test("force override preserves lease and send-pack behavior", async () => {
    for (const command of [
      "git push --force-with-lease origin $UNKNOWN",
      "git push --force --force-with-lease origin $UNKNOWN",
    ]) {
      expect(await decision(command)).toBe("ask");
      expect(await decision(command, ["git-force-push"])).toBe("ask");
    }
    expect(await decision("git send-pack --force origin feature", ["git-force-push"])).toBe(
      "block",
    );
  });
  test("force past parser caps retains its block", async () => {
    const command = `script ${"git status ".repeat(9)}git push --force origin feature`;
    expect(await decision(command)).toBe("block");
    expect(await decision(command, ["git-force-push"])).toBe("block");
  });
  test("allowed external build artifacts stay allowed", async () => {
    expect(await decision("rm -rf /some/external/dist", ["rm-repo-target"])).toBe("allow");
  });
  test("reading the overrides file is allowed", async () => {
    expect(await decision("cat ~/.claude/personal-overrides.json")).toBe("allow");
  });
});
