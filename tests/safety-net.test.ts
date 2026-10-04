// Test suite for src/hooks/safety-net.ts, the PreToolUse hook that blocks
// destructive Bash commands. The cases were originally derived from the bash
// implementation's suite and lock in the same contract.
//
// Run: bun test tests/safety-net.test.ts

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SAFETY_NET_TS = resolve(import.meta.dir, "..", "src", "hooks", "safety-net.ts");

type Decision = "allow" | "block";

async function runSafetyNet(
  cmd: string,
  cwd?: string,
): Promise<{ decision: Decision; exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bun", SAFETY_NET_TS], {
    cwd,
    env: { ...process.env, TOOL_INPUT_command: cmd },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const decision: Decision = exitCode === 2 ? "block" : "allow";
  return { decision, exitCode, stdout };
}

async function expectBlock(cmd: string, cwd?: string): Promise<void> {
  const r = await runSafetyNet(cmd, cwd);
  if (r.decision !== "block") {
    throw new Error(`expected BLOCK for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  expect(() => JSON.parse(r.stdout)).not.toThrow();
  const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/\[Safety Net\]/);
}

async function expectAllow(cmd: string, cwd?: string): Promise<void> {
  const r = await runSafetyNet(cmd, cwd);
  if (r.decision !== "allow") {
    throw new Error(`expected ALLOW for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  expect(r.exitCode).toBe(0);
}

describe("TS safety-net — rm -rf dangerous → BLOCK", () => {
  for (const [name, cmd] of [
    [
      "temp prefix cannot authorize a parent traversal",
      "rm -rf /tmp/../../Users/fixture/Documents",
    ],
    ["var temp prefix cannot authorize a parent traversal", "rm -rf /var/tmp/../../etc/fixture"],
    [
      "project prefix cannot authorize a parent traversal",
      `rm -rf ${process.cwd()}/../../fixture-victim`,
    ],
    ["rm -rf /", "rm -rf /"],
    ["rm -rf /*", "rm -rf /*"],
    ["rm -rf ~", "rm -rf ~"],
    ["rm -rf ~/", "rm -rf ~/"],
    ["rm -rf ~/*", "rm -rf ~/*"],
    ["rm -fr /", "rm -fr /"],
    ["rm -Rf /", "rm -Rf /"],
    ["rm -r -f /", "rm -r -f /"],
    ["rm -f -r /", "rm -f -r /"],
    ["rm --recursive --force /", "rm --recursive --force /"],
    ["rm -rf .", "rm -rf ."],
    ["rm -rf ..", "rm -rf .."],
    ["rm -rf $HOME", "rm -rf $HOME"],
    ["dangerous first operand", "rm -rf / node_modules"],
    ["dangerous last operand", "rm -rf node_modules /"],
    ["quoted home path before safe operand", 'rm -rf "$HOME/Library/Application Support" dist'],
    ["dangerous operand after terminator", "rm -rf -- / node_modules"],
    ["dangerous operand before terminator", "rm -rf / --"],
    ["terminator without operands", "rm -rf --"],
    ["redirection cannot hide dangerous operand", "rm -rf / > node_modules"],
  ] as const) {
    test(name, () => expectBlock(cmd));
  }
});

describe("TS safety-net — rm -rf safe → ALLOW", () => {
  for (const [name, cmd] of [
    ["rm -rf node_modules", "rm -rf node_modules"],
    ["rm -rf .next", "rm -rf .next"],
    ["rm -rf dist", "rm -rf dist"],
    ["rm -rf /tmp/test", "rm -rf /tmp/test"],
    ["rm -rf /var/tmp/build", "rm -rf /var/tmp/build"],
    ["rm -r mydir", "rm -r mydir"],
    ["rm -f myfile", "rm -f myfile"],
    ["multiple safe operands", "rm -rf node_modules dist /tmp/cache"],
    ["quoted safe operands", 'rm -rf "temp dir" /tmp/cache'],
    ["flag-shaped operand after terminator", "rm -rf -- node_modules -rf"],
    ["external build artifact remains allowed", "rm -rf /some/external/dist"],
  ] as const) {
    test(name, () => expectAllow(cmd));
  }
});

describe("TS safety-net — git destructive → BLOCK", () => {
  for (const [name, cmd] of [
    ["git checkout -- .", "git checkout -- ."],
    ["git checkout -- src/file.ts", "git checkout -- src/file.ts"],
    ["git push --force-with-lease origin main", "git push --force-with-lease origin main"],
    [
      "git push --force-with-lease origin HEAD:master",
      "git push --force-with-lease origin HEAD:master",
    ],
    [
      "git push --force-with-lease origin HEAD:refs/heads/main",
      "git push --force-with-lease origin HEAD:refs/heads/main",
    ],
    ["gh api DELETE repo root (--method)", "gh api --method DELETE repos/owner/repo"],
    ["gh api DELETE repo root (-X, trailing)", "gh api repos/owner/repo -X DELETE"],
    ["gh api DELETE repo root (leading slash)", "gh api -X DELETE /repos/owner/repo/"],
    ["git push --force", "git push --force"],
    ["git push -f origin main", "git push -f origin main"],
    ["git stash clear", "git stash clear"],
    ["git restore src/file.ts", "git restore src/file.ts"],
  ] as const) {
    test(name, () => expectBlock(cmd));
  }
});

describe("TS safety-net — force-with-lease without a refspec uses the current branch", () => {
  function repoOn(branch: string): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-safety-net-branch-"));
    spawnSync("git", ["init", "-q", "-b", branch, dir]);
    return dir;
  }
  test("on main → BLOCK", () => expectBlock("git push --force-with-lease", repoOn("main")));
  test("on master → BLOCK", () =>
    expectBlock("git push --force-with-lease origin", repoOn("master")));
  test("on a feature branch → ALLOW", () =>
    expectAllow("git push --force-with-lease", repoOn("feature")));
});

describe("TS safety-net — reflog-recoverable git → ALLOW (permission layer asks)", () => {
  for (const cmd of ["git branch -D feature", "git stash drop", "git stash drop stash@{0}"]) {
    test(cmd, () => expectAllow(cmd));
  }
});

describe("TS safety-net — git safe → ALLOW", () => {
  for (const [name, cmd] of [
    ["git checkout main", "git checkout main"],
    ["git checkout -b new-feature", "git checkout -b new-feature"],
    ["git checkout -B new-feature", "git checkout -B new-feature"],
    ["git push origin main", "git push origin main"],
    ["git push --force-with-lease origin feature", "git push --force-with-lease origin feature"],
    ["git reset --hard", "git reset --hard"],
    ["git reset --hard HEAD~3", "git reset --hard HEAD~3"],
    ["git clean -f", "git clean -f"],
    ["git clean -fd", "git clean -fd"],
    ["git worktree remove --force ../feature", "git worktree remove --force ../feature"],
    ["gh api DELETE branch ref", "gh api -X DELETE repos/owner/repo/git/refs/heads/feature"],
    ["gh api DELETE release", "gh api --method DELETE repos/owner/repo/releases/1"],
    ["gh api GET repo", "gh api repos/owner/repo"],
    ["git branch -d merged-branch", "git branch -d merged-branch"],
    ["git stash", "git stash"],
    ["git stash pop", "git stash pop"],
    ["git restore --staged src/file.ts", "git restore --staged src/file.ts"],
    ["git clean -n", "git clean -n"],
    ["git reset --soft HEAD~1", "git reset --soft HEAD~1"],
  ] as const) {
    test(name, () => expectAllow(cmd));
  }
});

describe("TS safety-net — AI attribution → BLOCK", () => {
  test("commit Co-Authored-By Claude", () =>
    expectBlock(
      'git commit -m "feat: add login form\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"',
    ));
  test("commit Co-Authored-By Anthropic", () =>
    expectBlock(
      'git commit -m "fix: something\n\nCo-Authored-By: Anthropic AI <noreply@anthropic.com>"',
    ));
  test("commit Generated with Claude Code", () =>
    expectBlock('git commit -m "feat: add feature\n\nGenerated with Claude Code"'));
  test("gh pr create with Claude badge", () =>
    expectBlock(
      'gh pr create --title "feat: add auth" --body "## Summary\nAdds auth flow\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"',
    ));
  test("gh pr create with Co-Authored-By", () =>
    expectBlock(
      'gh pr create --fill --body "Summary here\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
    ));
  test("commit AI-assisted", () =>
    expectBlock("git commit -m 'refactor: clean up code (AI-assisted)'"));
});

describe("TS safety-net — AI attribution safe → ALLOW", () => {
  test("commit clean", () => expectAllow("git commit -m 'feat: add login form component'"));
  test("gh pr create clean", () =>
    expectAllow(
      'gh pr create --title "feat: add auth" --body "## Summary\nAdds auth flow\n\n## Test Plan\n- Unit tests pass"',
    ));
  test("commit mentioning claude as variable", () =>
    expectAllow("git commit -m 'fix: rename claude_config variable'"));
});

describe("TS safety-net — find/xargs → BLOCK", () => {
  test("find -delete", () => expectBlock('find . -name "*.log" -delete'));
  test("find -exec rm", () => expectBlock("find /tmp -exec rm -rf {} ;"));
  test("xargs rm -rf", () => expectBlock("ls | xargs rm -rf"));
});

describe("TS safety-net — shell wrappers → BLOCK", () => {
  test("bash -c 'rm -rf /'", () => expectBlock("bash -c 'rm -rf /'"));
  test("sh -c 'git stash clear'", () => expectBlock("sh -c 'git stash clear'"));
  test('bash -c "git checkout -- ."', () => expectBlock('bash -c "git checkout -- ."'));
});

describe("TS safety-net — shell wrappers safe → ALLOW", () => {
  test("bash -c 'echo hello'", () => expectAllow("bash -c 'echo hello'"));
  test("sh -c 'ls -la'", () => expectAllow("sh -c 'ls -la'"));
});

describe("TS safety-net — interpreters → BLOCK", () => {
  test("python -c os.system rm -rf /", () =>
    expectBlock("python -c 'import os; os.system(\"rm -rf /\")'"));
  test("node -e execSync git stash clear", () =>
    expectBlock(`node -e 'require("child_process").execSync("git stash clear")'`));
});

describe("TS safety-net — multi-command → BLOCK", () => {
  test("echo && rm -rf /", () => expectBlock("echo hello && rm -rf /"));
  test("ls; git stash clear", () => expectBlock("ls; git stash clear"));
});

describe("TS safety-net — multi-command safe → ALLOW", () => {
  test("echo && echo", () => expectAllow("echo hello && echo world"));
  test("git status && git log --oneline", () => expectAllow("git status && git log --oneline"));
});

describe("TS safety-net — process kills by search → BLOCK", () => {
  for (const cmd of [
    // The 2026-10-04 incident: both halves took down the browser.
    'pkill -f "next start.*3100" -n 2>/dev/null; lsof -ti :3100 | xargs kill 2>/dev/null',
    "lsof -ti :3100 | xargs kill",
    "lsof -ti :3000 | head -1 | xargs kill -9",
    "cd /tmp && lsof -ti :3100 | xargs kill",
    "kill $(lsof -ti :3000)",
    "kill -9 `lsof -t -i:3000`",
    "kill $(lsof -ti :3000 | head -1)",
    'pkill -f "next start"',
    "pkill -n node",
    "/usr/bin/pkill node",
    'killall "Google Chrome"',
    "sudo killall Chromium",
    "fuser -k 3000/tcp",
    "pgrep -f chrome | xargs kill",
    "ps aux | grep chrome | awk '{print $2}' | xargs kill -9",
    "kill $(pgrep -f next)",
    "kill -9 -1",
    "kill -- -1",
    "bash -c 'lsof -ti :3000 | xargs kill'",
  ]) {
    test(cmd, () => expectBlock(cmd));
  }
});

describe("TS safety-net — process kills by PID → ALLOW", () => {
  for (const cmd of [
    "kill 12345",
    "kill -9 12345",
    "kill $PID",
    'kill "$SERVER_PID"',
    "kill $(cat .next/server.pid)",
    "lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill",
    "lsof -ti :3000 -s TCP:LISTEN | xargs kill -9",
    "kill $(lsof -ti :3000 -sTCP:LISTEN)",
    "lsof -i :3000",
    "pgrep -f next",
    "fuser 3000/tcp",
    "kill -l",
    'git commit -m "docs: explain why pkill is blocked"',
    'echo "kill it with lsof -ti :3000 | xargs kill"',
  ]) {
    test(cmd, () => expectAllow(cmd));
  }
});

describe("TS safety-net — edge cases → ALLOW", () => {
  test("empty", () => expectAllow(""));
  test("ls -la", () => expectAllow("ls -la"));
  test("npm install", () => expectAllow("npm install"));
});

describe("TS safety-net — issue #74 adversarial bypasses", () => {
  // Bypass 1: newline-joined commands were never split, so the last-token-wins
  // rm target parser latched onto the SECOND (safe-looking) rm invocation and
  // let the first `rm -rf /` through.
  test("rm -rf / \\n rm -rf node_modules (newline join) → BLOCK", () =>
    expectBlock("rm -rf /\nrm -rf node_modules"));
  test("rm -rf node_modules alone → ALLOW (neighbor safe)", () =>
    expectAllow("rm -rf node_modules"));

  // Bypass 2: checkGitDestructive's `cmd.match(/git\s+(.*)/)` has no /g and
  // `.` doesn't cross newlines — a second `git checkout -- .` on a later line
  // was invisible to the parser.
  test("echo hi \\n git checkout -- . (second line) → BLOCK", () =>
    expectBlock("echo hi\ngit checkout -- ."));
  test("git checkout my-branch alone → ALLOW (neighbor safe)", () =>
    expectAllow("git checkout my-branch"));

  // Bypass 3: only the `--` form of checkout was blocked; the equally
  // destructive bareword form (`git checkout .`) was allowed through.
  test("git checkout . (bareword, no --) → BLOCK", () => expectBlock("git checkout ."));
  test("git checkout my-branch (bareword branch) → ALLOW (neighbor safe)", () =>
    expectAllow("git checkout my-branch"));

  // Bypass 4: naive whitespace tokenizing split a quoted target across
  // multiple "tokens", so the last-token-wins heuristic picked up a harmless
  // trailing fragment instead of the real (dangerous) quoted path.
  test('rm -rf "$HOME/Library/Application Support" (quoted target) → BLOCK', () =>
    expectBlock('rm -rf "$HOME/Library/Application Support"'));
  test('rm -rf "temp dir" (quoted relative target) → ALLOW (neighbor safe)', () =>
    expectAllow('rm -rf "temp dir"'));

  // Bypass 5: force-push detection matched literal `-f`/`--force` only;
  // bundled short flags like `-uf` (set-upstream + force) rode through.
  test("git push -uf (bundled force flag) → BLOCK", () => expectBlock("git push -uf"));
  test("git push -u origin main → ALLOW (neighbor safe)", () =>
    expectAllow("git push -u origin main"));

  // Bypass 6: interpreter one-liner recursion only extracted a single quoted
  // string argument (os.system("...")); a list-arg call
  // (subprocess.run(["rm","-rf","/"])) was never recursed into.
  test('python3 -c subprocess.run(["rm","-rf","/"]) (list arg) → BLOCK', () =>
    expectBlock('python3 -c \'subprocess.run(["rm","-rf","/"])\''));
  test('python3 -c subprocess.run(["ls","-la"]) (list arg, safe) → ALLOW (neighbor safe)', () =>
    expectAllow('python3 -c \'subprocess.run(["ls","-la"])\''));
});

describe("TS safety-net — Codex cross-model review round (v12)", () => {
  // Path-qualified rm bypassed the whitespace-bare `rm` matcher.
  test("/bin/rm -rf / (path-qualified) → BLOCK", () => expectBlock("/bin/rm -rf /"));
  test("env /usr/bin/rm -rf ~/ (env + path-qualified) → BLOCK", () =>
    expectBlock("env /usr/bin/rm -rf ~/"));
  test("echo confirm -rf / (rm as word fragment) → ALLOW (neighbor safe)", () =>
    expectAllow("echo confirm -rf /"));

  // Quoted -C path split the git global-option stripper, hiding the verb.
  test('git -C "/tmp/repo with spaces" stash clear (quoted -C) → BLOCK', () =>
    expectBlock('git -C "/tmp/repo with spaces" stash clear'));
  test('git -C "/tmp/repo with spaces" status → ALLOW (neighbor safe)', () =>
    expectAllow('git -C "/tmp/repo with spaces" status'));
  test('git -C "/tmp/repo \\" esc" stash clear (escaped quote in -C) → BLOCK', () =>
    expectBlock('git -C "/tmp/repo \\" esc" stash clear'));
});

describe("TS safety-net — decision protocol", () => {
  test("allow = exit 0", async () => {
    const r = await runSafetyNet("ls");
    expect(r.exitCode).toBe(0);
  });
  test("block = exit 2 + JSON payload", async () => {
    const r = await runSafetyNet("rm -rf /");
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.decision).toBe("block");
    expect(typeof parsed.reason).toBe("string");
    expect(parsed.reason.startsWith("[Safety Net]")).toBe(true);
  });
  test("missing TOOL_INPUT_command → allow (no-op)", async () => {
    const proc = Bun.spawn(["bun", SAFETY_NET_TS], {
      env: { ...process.env, TOOL_INPUT_command: "" },
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).toBe(0);
  });
});
