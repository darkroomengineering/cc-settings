// Exemption logic for the pre-push proof gate. This decides whether `git
// push` gets the full test+lint gate — a bug here means the gate silently
// exempts a real push (no protection) or blocks a `--dry-run`/`--help`
// invocation (false block), so lock every branch.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldGate, splitShellSegments } from "../src/hooks/pre-push-proof.ts";

const HOOK_PATH = join(import.meta.dir, "..", "src", "hooks", "pre-push-proof.ts");

describe("pre-push-proof — shouldGate exemption logic", () => {
  test("gates a plain git push", () => {
    expect(shouldGate("git push")).toBe(true);
    expect(shouldGate("git push origin main")).toBe(true);
    expect(shouldGate("git push -u origin feat/x")).toBe(true);
  });

  test("gates feature-branch and non-main-remote pushes too (no branch/remote exemption)", () => {
    expect(shouldGate("git push origin feature-branch")).toBe(true);
    expect(shouldGate("git push upstream feat/x")).toBe(true);
  });

  test("exempts --dry-run / -n (nothing is actually pushed)", () => {
    expect(shouldGate("git push --dry-run")).toBe(false);
    expect(shouldGate("git push origin main --dry-run")).toBe(false);
    expect(shouldGate("git push -n origin main")).toBe(false);
  });

  test("exempts --help (informational, not a push)", () => {
    expect(shouldGate("git push --help")).toBe(false);
  });

  test("allows non-push commands", () => {
    expect(shouldGate("git pull")).toBe(false);
    expect(shouldGate("echo git push")).toBe(false);
    expect(shouldGate("git status")).toBe(false);
  });

  test("per-segment: an exempt segment cannot shadow a gated one", () => {
    // A dry-run followed by a real push — the real push must still gate.
    expect(shouldGate("git push --dry-run && git push origin main")).toBe(true);
    // An unrelated earlier mention must not exempt the real push.
    expect(shouldGate("echo --dry-run && git push origin main")).toBe(true);
  });

  // Coordinator review — CONFIRMED BUG 1: these real pushes previously escaped
  // the gate (shouldGate returned false) because the anchor required the
  // segment to literally start with `git push`.
  test("gates real pushes disguised behind command prefixes / git global options", () => {
    expect(shouldGate("git -C child push")).toBe(true);
    expect(shouldGate("git -c k=v push")).toBe(true);
    expect(shouldGate("command git push")).toBe(true);
    expect(shouldGate("GIT_TRACE=1 git push")).toBe(true);
    // combinations, and long-form global options
    expect(shouldGate("GIT_TRACE=1 command git push")).toBe(true);
    expect(shouldGate("git --git-dir=/repo/.git push")).toBe(true);
    expect(shouldGate("git --work-tree=/repo push")).toBe(true);
    expect(shouldGate("git --exec-path /custom/path push")).toBe(true);
    expect(shouldGate("git --no-pager push")).toBe(true);
    expect(shouldGate("git -p push")).toBe(true);
    expect(shouldGate("git --paginate push")).toBe(true);
    expect(shouldGate("git --bare push")).toBe(true);
  });

  // CONFIRMED BUG 2: `--dry-run` appearing INSIDE another flag's value (e.g.
  // `--push-option=--dry-run`) must not exempt a real push. Exemption is
  // exact-token, not substring.
  test("does not exempt --dry-run text embedded inside another flag's value", () => {
    expect(shouldGate("git push --push-option=--dry-run origin main")).toBe(true);
  });

  // A branch literally named `dry-run` must still gate — the exemption is a
  // token match on flags, not a substring match anywhere in the tail.
  test("still gates a push to a branch literally named dry-run", () => {
    expect(shouldGate("git push origin dry-run")).toBe(true);
  });

  // BUG 3: a `;` inside a quoted string must not be treated as a shell
  // separator — otherwise an innocent echo gets split into a fake `git push`
  // segment and gated (and potentially blocked if the tree is red).
  test("does not gate a quoted separator inside an unrelated command", () => {
    expect(shouldGate('echo "safe; git push"')).toBe(false);
  });

  test("still gates a real push after a quoted commit message", () => {
    expect(shouldGate('git commit -m "x" && git push')).toBe(true);
  });
});

describe("pre-push-proof — splitShellSegments (quote-aware)", () => {
  test("splits on unquoted separators", () => {
    expect(splitShellSegments("a && b")).toEqual(["a ", " b"]);
    expect(splitShellSegments("a; b")).toEqual(["a", " b"]);
    expect(splitShellSegments("a || b")).toEqual(["a ", " b"]);
  });

  test("does not split on a separator inside single or double quotes", () => {
    expect(splitShellSegments('echo "safe; git push"')).toEqual(['echo "safe; git push"']);
    expect(splitShellSegments("echo 'safe; git push'")).toEqual(["echo 'safe; git push'"]);
  });

  test("still splits after a closed quote", () => {
    expect(splitShellSegments('git commit -m "x" && git push')).toEqual([
      'git commit -m "x" ',
      " git push",
    ]);
  });
});

// Subprocess tests: exercise main() end-to-end via a fake `$HOME/.claude` so
// the block/fail-open protocol (exit code + stdout JSON) is locked, not just
// the shouldGate predicate.
describe("pre-push-proof — subprocess block protocol", () => {
  async function makeFakeHome(proofScriptBody: string | null): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "cc-pre-push-proof-home-"));
    if (proofScriptBody !== null) {
      const scriptsDir = join(home, ".claude", "src", "scripts");
      await mkdir(scriptsDir, { recursive: true });
      await writeFile(join(scriptsDir, "proof.ts"), proofScriptBody);
    }
    return home;
  }

  async function runHook(home: string, command: string) {
    const proc = Bun.spawn([process.execPath, HOOK_PATH], {
      env: { ...process.env, HOME: home, TOOL_INPUT_command: command },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test("red battery: blocks with decision:block and a reason naming the failure", async () => {
    const home = await makeFakeHome(
      `console.log("Proof of work: NOT review-ready\\ntypecheck: fail");\nprocess.exitCode = 1;\n`,
    );
    try {
      const { stdout, stderr, exitCode } = await runHook(home, "git push origin main");
      expect(exitCode, stderr).toBe(2);
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("Pre-push proof gate");
      expect(parsed.reason).toContain("typecheck: fail");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("the production hook launches the proof runner through the active runtime", async () => {
    const source = await readFile(HOOK_PATH, "utf8");
    expect(source.includes("Bun.spawn([process.execPath, proofRunner]")).toBe(true);
    expect(source.includes('Bun.spawn(["bun", proofRunner]')).toBe(false);
  });

  test("green battery: allows silently (exit 0, no stdout)", async () => {
    const home = await makeFakeHome(`process.exitCode = 0;\n`);
    try {
      const { stdout, exitCode } = await runHook(home, "git push origin main");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("runner missing: fails open (exit 0, allow)", async () => {
    const home = await makeFakeHome(null); // no .claude/src/scripts/proof.ts at all
    try {
      const { exitCode } = await runHook(home, "git push origin main");
      expect(exitCode).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("not a push: allows without spawning the runner", async () => {
    const home = await makeFakeHome(
      `console.log("Proof of work: NOT review-ready");\nprocess.exitCode = 1;\n`,
    );
    try {
      const { stdout, exitCode } = await runHook(home, "git pull");
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
