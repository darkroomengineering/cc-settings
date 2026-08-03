// Gate logic + block protocol for the pre-commit farolero hook. A bug here means
// either a repo with farolero installed never gets gated (no protection) or a
// commit gets blocked when farolero isn't even present / already enforced by its
// own git hooks (a false block) — lock every branch.

import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  faroleroHooksAlreadyActive,
  hasNoVerifyFlag,
  shouldGateCommit,
  stripQuotedSpans,
} from "../src/hooks/pre-commit-farolero.ts";

const HOOK_PATH = join(import.meta.dir, "..", "src", "hooks", "pre-commit-farolero.ts");

describe("pre-commit-farolero — shouldGateCommit exemption logic", () => {
  test("gates a plain git commit", () => {
    expect(shouldGateCommit("git commit -m x")).toBe(true);
    expect(shouldGateCommit("git commit")).toBe(true);
  });

  test("exempts --dry-run (nothing is actually committed)", () => {
    expect(shouldGateCommit("git commit --dry-run -m x")).toBe(false);
  });

  test("exempts --help (informational, not a commit)", () => {
    expect(shouldGateCommit("git commit --help")).toBe(false);
  });

  test("does not exempt --dry-run/--help text embedded inside a quoted commit message", () => {
    expect(shouldGateCommit('git commit -m "notes: --dry-run mode added"')).toBe(true);
    expect(shouldGateCommit("git commit -m 'ran --help locally'")).toBe(true);
  });

  test("allows non-commit commands", () => {
    expect(shouldGateCommit("git push")).toBe(false);
    expect(shouldGateCommit("git status")).toBe(false);
    expect(shouldGateCommit("")).toBe(false);
  });

  test("garbage/malformed input never gates", () => {
    expect(shouldGateCommit("not json{{{")).toBe(false);
  });

  test("only anchors to the start of the string — a compound command isn't specially split", () => {
    // Documented simplification vs pre-push-proof.ts's shell-segment splitting: this hook
    // closes "the dependency exists but was never wired up," not "a disguised commit buried
    // inside a compound command," so a plain start-anchor is sufficient.
    expect(shouldGateCommit("echo x && git commit -m y")).toBe(false);
  });

  test("a later compound segment's --dry-run must not exempt the real, anchor-matched commit", () => {
    // CONFIRMED BUG (review): `git commit -m x && git commit --dry-run` previously exempted the
    // WHOLE string because exemption tokens were searched globally, leaving the first, real
    // commit ungated. Only the first (anchor-matched) segment's flags may exempt it.
    expect(shouldGateCommit("git commit -m x && git commit --dry-run")).toBe(true);
  });

  test("the anchor-matched segment's own --dry-run still exempts, even with a second segment after it", () => {
    expect(shouldGateCommit("git commit --dry-run && echo done")).toBe(false);
  });
});

describe("pre-commit-farolero — hasNoVerifyFlag", () => {
  test("detects --no-verify on the anchor-matched segment", () => {
    expect(hasNoVerifyFlag("git commit -m x --no-verify")).toBe(true);
  });

  test("detects the -n short flag", () => {
    expect(hasNoVerifyFlag("git commit -m x -n")).toBe(true);
  });

  test("false for a plain commit", () => {
    expect(hasNoVerifyFlag("git commit -m x")).toBe(false);
  });

  test("does not false-positive on --no-verify text embedded in a quoted message", () => {
    expect(hasNoVerifyFlag('git commit -m "skip --no-verify next time"')).toBe(false);
  });

  test("only looks at the first (anchor-matched) segment", () => {
    expect(hasNoVerifyFlag("git commit -m x && git commit --no-verify -m y")).toBe(false);
  });
});

describe("pre-commit-farolero — stripQuotedSpans", () => {
  test("blanks quoted spans, keeps unquoted text", () => {
    expect(stripQuotedSpans('git commit -m "a b c"')).toBe("git commit -m  ");
    expect(stripQuotedSpans("git commit -m 'a b c'")).toBe("git commit -m  ");
  });

  test("leaves an already-unquoted command untouched", () => {
    expect(stripQuotedSpans("git commit --dry-run")).toBe("git commit --dry-run");
  });
});

// --- Repo fixture builders --------------------------------------------------

interface RepoHandle {
  dir: string;
  sentinelPath: string;
}

async function makeGitRepo(): Promise<RepoHandle> {
  const dir = await mkdtemp(join(tmpdir(), "cc-pre-commit-farolero-"));
  const sentinelPath = join(dir, "farolero-was-run");
  await Bun.spawn(["git", "init", "-q"], { cwd: dir }).exited;
  await Bun.spawn(["git", "config", "user.email", "test@example.com"], { cwd: dir }).exited;
  await Bun.spawn(["git", "config", "user.name", "Test"], { cwd: dir }).exited;
  return { dir, sentinelPath };
}

async function writePackageJson(dir: string, withFaroleroDep: boolean): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "scratch",
      devDependencies: withFaroleroDep ? { farolero: "0.0.0" } : {},
    }),
  );
}

async function writeFakeFaroleroBin(
  dir: string,
  sentinelPath: string,
  exitCode: number,
  output = "",
): Promise<void> {
  const binDir = join(dir, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  const echoLine = output ? `echo '${output.replace(/'/g, "'\\''")}'\n` : "";
  const binPath = join(binDir, "farolero");
  await writeFile(binPath, `#!/bin/sh\ntouch "${sentinelPath}"\n${echoLine}exit ${exitCode}\n`);
  await chmod(binPath, 0o755);
}

async function writeMarkerHook(
  filePath: string,
  options: { executable?: boolean } = {},
): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, "#!/bin/sh\n# farolero-managed\nexit 0\n");
  if (options.executable !== false) await chmod(filePath, 0o755);
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// --- faroleroHooksAlreadyActive: direct unit coverage --------------------------

describe("pre-commit-farolero — faroleroHooksAlreadyActive", () => {
  test("default .git/hooks/pre-commit with an executable marker is active", async () => {
    const { dir } = await makeGitRepo();
    try {
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"));
      expect(await faroleroHooksAlreadyActive(dir)).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  test("a marker present but NOT executable is not active — git ignores non-executable hooks", async () => {
    const { dir } = await makeGitRepo();
    try {
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"), { executable: false });
      expect(await faroleroHooksAlreadyActive(dir)).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("core.hooksPath configured: checks ONLY that directory, never falls back to .git/hooks", async () => {
    // CONFIRMED BUG (review): a stale marker left in .git/hooks from before hooksPath was set
    // must not cause a skip — git ignores .git/hooks entirely once hooksPath is configured.
    const { dir } = await makeGitRepo();
    try {
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit")); // stale, executable, marked
      await mkdir(join(dir, ".githooks"), { recursive: true });
      await Bun.spawn(["git", "config", "core.hooksPath", ".githooks"], { cwd: dir }).exited;
      // .githooks/pre-commit does not exist at all — hooksPath is configured but has no hook yet.
      expect(await faroleroHooksAlreadyActive(dir)).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("core.hooksPath configured and that directory's pre-commit carries the marker: active", async () => {
    const { dir } = await makeGitRepo();
    try {
      await mkdir(join(dir, ".githooks"), { recursive: true });
      await writeMarkerHook(join(dir, ".githooks", "pre-commit"));
      await Bun.spawn(["git", "config", "core.hooksPath", ".githooks"], { cwd: dir }).exited;
      expect(await faroleroHooksAlreadyActive(dir)).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });
});

// --- Subprocess tests: exercise main() end-to-end so the block/fail-open ---
// --- protocol (exit code + stdout JSON) is locked, not just the predicates.

describe("pre-commit-farolero — subprocess block protocol", () => {
  async function runHook(cwd: string, command: string) {
    const proc = Bun.spawn(["bun", HOOK_PATH], {
      cwd,
      env: { ...process.env, TOOL_INPUT_command: command },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, exitCode };
  }

  test("no farolero dependency: allows without running anything", async () => {
    const { dir } = await makeGitRepo();
    try {
      await writePackageJson(dir, false);
      const { stdout, exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await cleanup(dir);
    }
  });

  test("fake farolero exits 1 with output: blocks with decision:block naming the output tail", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1, "rule violated: no-ts-ignore");
      const { stdout, exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(2);
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("rule violated: no-ts-ignore");
      expect(parsed.reason).toContain("never bypass with --no-verify");
    } finally {
      await cleanup(dir);
    }
  });

  test("fake farolero exits 0: allows silently", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 0);
      const { stdout, exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await cleanup(dir);
    }
  });

  test("fake farolero exits 2 (farolero's own operational-error code): fails open, allows", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 2, "farolero: bad config");
      const { stdout, exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await cleanup(dir);
    }
  });

  test("farolero's own git hooks already active: allows without invoking farolero at all", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1);
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"));
      const { exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(0);
      expect(await Bun.file(sentinelPath).exists()).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("non-commit command: allows without invoking farolero", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1);
      const { exitCode } = await runHook(dir, "git push");
      expect(exitCode).toBe(0);
      expect(await Bun.file(sentinelPath).exists()).toBe(false);
    } finally {
      await cleanup(dir);
    }
  });

  test("garbage TOOL_INPUT_command: allows", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1);
      const proc = Bun.spawn(["bun", HOOK_PATH], {
        cwd: dir,
        env: { ...process.env, TOOL_INPUT_command: "not json{{{" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    } finally {
      await cleanup(dir);
    }
  });

  test("a stale, non-executable marker in the active hooks dir does not cause a skip — ratchet runs", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 0);
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"), { executable: false });
      const { exitCode } = await runHook(dir, "git commit -m x");
      expect(exitCode).toBe(0);
      expect(await Bun.file(sentinelPath).exists()).toBe(true); // farolero WAS invoked
    } finally {
      await cleanup(dir);
    }
  });

  // --- --no-verify / -n: the defer-to-native-hook skip must be disabled ----

  test("--no-verify with farolero's git hooks active and a failing repo: still blocks", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1, "rule violated: no-ts-ignore");
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit")); // active — would normally skip
      const { stdout, exitCode } = await runHook(dir, "git commit -m x --no-verify");
      expect(exitCode).toBe(2);
      expect(await Bun.file(sentinelPath).exists()).toBe(true); // farolero WAS invoked despite the native hook
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("rule violated: no-ts-ignore");
    } finally {
      await cleanup(dir);
    }
  });

  test("-n (short --no-verify) with farolero's git hooks active and a failing repo: still blocks", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 1, "rule violated: no-ts-ignore");
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"));
      const { exitCode } = await runHook(dir, "git commit -m x -n");
      expect(exitCode).toBe(2);
      expect(await Bun.file(sentinelPath).exists()).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  test("--no-verify with a passing repo: allows (the override forces a real check, which passes)", async () => {
    const { dir, sentinelPath } = await makeGitRepo();
    try {
      await writePackageJson(dir, true);
      await writeFakeFaroleroBin(dir, sentinelPath, 0);
      await writeMarkerHook(join(dir, ".git", "hooks", "pre-commit"));
      const { stdout, exitCode } = await runHook(dir, "git commit -m x --no-verify");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(await Bun.file(sentinelPath).exists()).toBe(true); // still invoked, just passed
    } finally {
      await cleanup(dir);
    }
  });
});
