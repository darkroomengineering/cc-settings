import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const hook = resolve(import.meta.dir, "../src/hooks/safety-net.ts");
const fixture = mkdtempSync(join(tmpdir(), "cc-safety-overrides-"));
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
  if (allow !== undefined) {
    writeFileSync(
      join(home, ".claude/personal-overrides.json"),
      JSON.stringify({ safetyNet: { allow } }),
    );
  }
  const child = Bun.spawn([process.execPath, hook], {
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
  });
  const stdout = await new Response(child.stdout).text();
  await new Response(child.stderr).text();
  const code = await child.exited;
  if (code === 2) return "block";
  if (code !== 0) return `error-${code}: ${stdout}`;
  return stdout.includes('"permissionDecision":"ask"') ? "ask" : "allow";
}

describe("personal safety-net overrides", () => {
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
  for (const command of [
    "echo '{}' > ~/.claude/personal-overrides.json",
    "printf '{}' >> ~/.claude/personal-overrides.json",
    "cp source.json ~/.claude/personal-overrides.json",
    "mv source.json ~/.claude/personal-overrides.json",
    "tee ~/.claude/personal-overrides.json",
    "sed -i 's/x/y/' ~/.claude/personal-overrides.json",
    "touch ~/.claude/personal-overrides.json",
    "cd ~/.claude && echo '{}' > personal-overrides.json",
    "cp source.json ~/.claude/./personal-overrides.json",
    "echo '{}' > $HOME/.claude/personal-overrides.json",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell home variable
    "echo '{}' > ${HOME}/.claude/personal-overrides.json",
    "cp -t ~/.claude personal-overrides.json",
    "cp -t$HOME/.claude /tmp/personal-overrides.json",
    "cp -vt ~/.claude /tmp/personal-overrides.json",
    "mv --target-directory=$HOME/.claude /tmp/personal-overrides.json",
    "rsync -t /tmp/source.json ~/.claude/personal-overrides.json",
    "mv -t ~/.claude personal-overrides.json",
    "install -t ~/.claude personal-overrides.json",
    "cp --target-directory=~/.claude personal-overrides.json",
  ]) {
    test(`self-protection: ${command}`, async () => {
      expect(await decision(command, ["personal-overrides-write", "git-discard-worktree"])).toBe(
        "block",
      );
    });
  }
  test("reading the overrides file is allowed", async () => {
    expect(await decision("cat ~/.claude/personal-overrides.json")).toBe("allow");
  });
});
