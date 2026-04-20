// Parity test suite for src/hooks/safety-net.ts — mirrors tests/safety-net.test.ts
// exactly, but runs against the TS implementation. When the TS port reaches
// zero divergences against the bash suite for 7 days (per docs/migration-
// coexistence.md), Phase 6 flips the hook command to `bun src/hooks/safety-net.ts`.
//
// The test cases are derived from the bash suite so both implementations are
// held to the same contract. DO NOT drift — update both or neither.
//
// Run: bun test tests/safety-net-ts.test.ts

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SAFETY_NET_TS = resolve(import.meta.dir, "..", "src", "hooks", "safety-net.ts");

type Decision = "allow" | "block";

async function runSafetyNet(
  cmd: string,
): Promise<{ decision: Decision; exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bun", SAFETY_NET_TS], {
    env: { ...process.env, TOOL_INPUT_command: cmd },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const decision: Decision = exitCode === 2 ? "block" : "allow";
  return { decision, exitCode, stdout };
}

async function expectBlock(cmd: string): Promise<void> {
  const r = await runSafetyNet(cmd);
  if (r.decision !== "block") {
    throw new Error(`expected BLOCK for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  expect(() => JSON.parse(r.stdout)).not.toThrow();
  const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/\[Safety Net\]/);
}

async function expectAllow(cmd: string): Promise<void> {
  const r = await runSafetyNet(cmd);
  if (r.decision !== "allow") {
    throw new Error(`expected ALLOW for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  expect(r.exitCode).toBe(0);
}

describe("TS safety-net — rm -rf dangerous → BLOCK", () => {
  for (const [name, cmd] of [
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
  ] as const) {
    test(name, () => expectAllow(cmd));
  }
});

describe("TS safety-net — git destructive → BLOCK", () => {
  for (const [name, cmd] of [
    ["git checkout -- .", "git checkout -- ."],
    ["git checkout -- src/file.ts", "git checkout -- src/file.ts"],
    ["git reset --hard", "git reset --hard"],
    ["git reset --hard HEAD~3", "git reset --hard HEAD~3"],
    ["git clean -f", "git clean -f"],
    ["git clean -fd", "git clean -fd"],
    ["git push --force", "git push --force"],
    ["git push -f origin main", "git push -f origin main"],
    ["git branch -D feature", "git branch -D feature"],
    ["git stash drop", "git stash drop"],
    ["git stash clear", "git stash clear"],
    ["git restore src/file.ts", "git restore src/file.ts"],
  ] as const) {
    test(name, () => expectBlock(cmd));
  }
});

describe("TS safety-net — git safe → ALLOW", () => {
  for (const [name, cmd] of [
    ["git checkout main", "git checkout main"],
    ["git checkout -b new-feature", "git checkout -b new-feature"],
    ["git checkout -B new-feature", "git checkout -B new-feature"],
    ["git push origin main", "git push origin main"],
    ["git push --force-with-lease", "git push --force-with-lease"],
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
      'git commit -m "feat: add login form\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"',
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
  test("sh -c 'git reset --hard'", () => expectBlock("sh -c 'git reset --hard'"));
  test('bash -c "git checkout -- ."', () => expectBlock('bash -c "git checkout -- ."'));
});

describe("TS safety-net — shell wrappers safe → ALLOW", () => {
  test("bash -c 'echo hello'", () => expectAllow("bash -c 'echo hello'"));
  test("sh -c 'ls -la'", () => expectAllow("sh -c 'ls -la'"));
});

describe("TS safety-net — interpreters → BLOCK", () => {
  test("python -c os.system rm -rf /", () =>
    expectBlock("python -c 'import os; os.system(\"rm -rf /\")'"));
  test("node -e execSync git reset --hard", () =>
    expectBlock(`node -e 'require("child_process").execSync("git reset --hard")'`));
});

describe("TS safety-net — multi-command → BLOCK", () => {
  test("echo && rm -rf /", () => expectBlock("echo hello && rm -rf /"));
  test("ls; git reset --hard", () => expectBlock("ls; git reset --hard"));
});

describe("TS safety-net — multi-command safe → ALLOW", () => {
  test("echo && echo", () => expectAllow("echo hello && echo world"));
  test("git status && git log --oneline", () => expectAllow("git status && git log --oneline"));
});

describe("TS safety-net — edge cases → ALLOW", () => {
  test("empty", () => expectAllow(""));
  test("ls -la", () => expectAllow("ls -la"));
  test("npm install", () => expectAllow("npm install"));
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
