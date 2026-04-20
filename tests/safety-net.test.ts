// bun:test harness that shells out to scripts/safety-net.sh and mirrors every
// case from tests/safety-net-test.sh. Phase -1 deliverable: give the *current*
// bash implementation a regression net before any TS touches it, and establish
// the test shape the Phase 4 TS port must satisfy.
//
// Run: bun test tests/safety-net.test.ts

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SAFETY_NET = resolve(import.meta.dir, "..", "scripts", "safety-net.sh");

type Decision = "allow" | "block";

async function runSafetyNet(
  cmd: string,
): Promise<{ decision: Decision; exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bash", SAFETY_NET], {
    env: { ...process.env, TOOL_INPUT_command: cmd },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const decision: Decision = exitCode === 2 ? "block" : "allow";
  return { decision, exitCode, stdout };
}

async function expectBlock(cmd: string) {
  const r = await runSafetyNet(cmd);
  if (r.decision !== "block") {
    throw new Error(`expected BLOCK for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  // Block output must be parseable JSON with decision:block so Claude Code honors it.
  expect(() => JSON.parse(r.stdout)).not.toThrow();
  const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/\[Safety Net\]/);
}

async function expectAllow(cmd: string) {
  const r = await runSafetyNet(cmd);
  if (r.decision !== "allow") {
    throw new Error(`expected ALLOW for: ${cmd}\n  got exit=${r.exitCode} stdout=${r.stdout}`);
  }
  expect(r.exitCode).toBe(0);
}

// --- Cases mirror tests/safety-net-test.sh 1:1. When the bash file changes,
//     this file changes too. The Phase 4 TS port reuses this exact list. ---

describe("rm -rf dangerous targets → BLOCK", () => {
  const cases: Array<[string, string]> = [
    ["rm -rf / (root)", "rm -rf /"],
    ["rm -rf /* (root wildcard)", "rm -rf /*"],
    ["rm -rf ~ (home)", "rm -rf ~"],
    ["rm -rf ~/ (home trailing slash)", "rm -rf ~/"],
    ["rm -rf ~/* (home wildcard)", "rm -rf ~/*"],
    ["rm -fr / (flag reorder)", "rm -fr /"],
    ["rm -Rf / (capital R)", "rm -Rf /"],
    ["rm -r -f / (split flags)", "rm -r -f /"],
    ["rm -f -r / (split flags reverse)", "rm -f -r /"],
    ["rm --recursive --force / (long flags)", "rm --recursive --force /"],
    ["rm -rf . (current dir)", "rm -rf ."],
    ["rm -rf .. (parent dir)", "rm -rf .."],
    ["rm -rf $HOME (HOME variable)", "rm -rf $HOME"],
  ];
  for (const [name, cmd] of cases) test(name, () => expectBlock(cmd));
});

describe("rm -rf safe targets → ALLOW", () => {
  const cases: Array<[string, string]> = [
    ["rm -rf node_modules", "rm -rf node_modules"],
    ["rm -rf .next", "rm -rf .next"],
    ["rm -rf dist", "rm -rf dist"],
    ["rm -rf /tmp/test", "rm -rf /tmp/test"],
    ["rm -rf /var/tmp/build", "rm -rf /var/tmp/build"],
    ["rm -r mydir (recursive without force)", "rm -r mydir"],
    ["rm -f myfile (force without recursive)", "rm -f myfile"],
  ];
  for (const [name, cmd] of cases) test(name, () => expectAllow(cmd));
});

describe("git destructive → BLOCK", () => {
  const cases: Array<[string, string]> = [
    ["git checkout -- . (discard all)", "git checkout -- ."],
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
    ["git restore src/file.ts (no --staged)", "git restore src/file.ts"],
  ];
  for (const [name, cmd] of cases) test(name, () => expectBlock(cmd));
});

describe("git safe → ALLOW", () => {
  const cases: Array<[string, string]> = [
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
  ];
  for (const [name, cmd] of cases) test(name, () => expectAllow(cmd));
});

describe("AI attribution stealth → BLOCK", () => {
  test("git commit Co-Authored-By Claude", () =>
    expectBlock(
      'git commit -m "feat: add login form\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"',
    ));
  test("git commit Co-Authored-By Anthropic", () =>
    expectBlock(
      'git commit -m "fix: something\n\nCo-Authored-By: Anthropic AI <noreply@anthropic.com>"',
    ));
  test("git commit Generated with Claude Code", () =>
    expectBlock('git commit -m "feat: add feature\n\nGenerated with Claude Code"'));
  test("gh pr create with Claude badge", () =>
    expectBlock(
      'gh pr create --title "feat: add auth" --body "## Summary\nAdds auth flow\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"',
    ));
  test("gh pr create with Co-Authored-By", () =>
    expectBlock(
      'gh pr create --fill --body "Summary here\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
    ));
  test("git commit AI-assisted", () =>
    expectBlock("git commit -m 'refactor: clean up code (AI-assisted)'"));
});

describe("AI attribution safe → ALLOW", () => {
  test("git commit clean message", () =>
    expectAllow("git commit -m 'feat: add login form component'"));
  test("gh pr create clean body", () =>
    expectAllow(
      'gh pr create --title "feat: add auth" --body "## Summary\nAdds auth flow\n\n## Test Plan\n- Unit tests pass"',
    ));
  test("git commit mentioning claude as variable name", () =>
    expectAllow("git commit -m 'fix: rename claude_config variable'"));
});

describe("find/xargs destructive → BLOCK", () => {
  test("find -delete", () => expectBlock('find . -name "*.log" -delete'));
  test("find -exec rm", () => expectBlock("find /tmp -exec rm -rf {} ;"));
  test("xargs rm -rf", () => expectBlock("ls | xargs rm -rf"));
});

describe("shell wrappers → BLOCK", () => {
  test("bash -c 'rm -rf /'", () => expectBlock("bash -c 'rm -rf /'"));
  test("sh -c 'git reset --hard'", () => expectBlock("sh -c 'git reset --hard'"));
  test('bash -c "git checkout -- ."', () => expectBlock('bash -c "git checkout -- ."'));
});

describe("shell wrappers safe → ALLOW", () => {
  test("bash -c 'echo hello'", () => expectAllow("bash -c 'echo hello'"));
  test("sh -c 'ls -la'", () => expectAllow("sh -c 'ls -la'"));
});

describe("interpreters → BLOCK", () => {
  test("python -c os.system(rm -rf /)", () =>
    expectBlock("python -c 'import os; os.system(\"rm -rf /\")'"));
  test("node -e execSync(git reset --hard)", () =>
    expectBlock(`node -e 'require("child_process").execSync("git reset --hard")'`));
});

describe("multi-command chains → BLOCK", () => {
  test("echo && rm -rf /", () => expectBlock("echo hello && rm -rf /"));
  test("ls; git reset --hard", () => expectBlock("ls; git reset --hard"));
});

describe("multi-command chains → ALLOW", () => {
  test("echo && echo", () => expectAllow("echo hello && echo world"));
  test("git status && git log --oneline", () => expectAllow("git status && git log --oneline"));
});

describe("edge cases → ALLOW", () => {
  test("empty command", () => expectAllow(""));
  test("ls -la", () => expectAllow("ls -la"));
  test("npm install", () => expectAllow("npm install"));
});

// Protocol contract (stable across bash → TS): these must not regress.
describe("decision protocol", () => {
  test("allow = exit 0, no stdout required", async () => {
    const r = await runSafetyNet("ls");
    expect(r.exitCode).toBe(0);
  });
  test("block = exit 2 + JSON {decision,reason} on stdout", async () => {
    const r = await runSafetyNet("rm -rf /");
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.decision).toBe("block");
    expect(typeof parsed.reason).toBe("string");
    expect(parsed.reason.startsWith("[Safety Net]")).toBe(true);
  });
  test("missing TOOL_INPUT_command = allow (no-op)", async () => {
    const proc = Bun.spawn(["bash", SAFETY_NET], {
      env: { ...process.env, TOOL_INPUT_command: "" },
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).toBe(0);
  });
});
