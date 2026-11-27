// worktree-cow.ts: the WorktreeCreate/WorktreeRemove hooks, run as Claude Code runs
// them (JSON on stdin, worktree path as the only stdout line), against temp git
// repos. PATH is cut down to the git and bun directories so the host's real
// ~/.cargo/bin/git-cow never leaks in; "with git-cow" cases put a logging shim
// first on PATH instead. Plus the installer's detection-gated wiring.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { withWorktreeHooks } from "../src/lib/claude-install-settings.ts";
import { composeSettings } from "../src/lib/compose-settings.ts";
import { findGitCow, gitCowUsable } from "../src/lib/git-cow.ts";

const REPO = resolve(import.meta.dir, "..");
const HOOK = join(REPO, "src", "hooks", "worktree-cow.ts");
const posix = process.platform !== "win32";
// Each test spawns several git and bun processes; the 5 s default is too tight under a loaded suite.
setDefaultTimeout(30_000);

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

function basePath(): string {
  const git = Bun.which("git");
  if (!git) throw new Error("git not on PATH");
  return [...new Set([dirname(git), dirname(process.execPath), "/usr/bin", "/bin"])].join(
    delimiter,
  );
}

let tmp: string;
let home: string;
let repo: string;
let shimDir: string;
let shimLog: string;

function env(withCow: boolean): Record<string, string> {
  return {
    ...GIT_ENV,
    HOME: home,
    PATH: withCow ? `${shimDir}${delimiter}${basePath()}` : basePath(),
    NO_COLOR: "1",
  };
}

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, { cwd, env: env(false), stdout: "pipe", stderr: "pipe" });
  const [out, err, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) throw new Error(`${argv.join(" ")} failed: ${err}`);
  return out.trim();
}

async function created(name: string, withCow = false): Promise<string> {
  const r = await hook("create", createPayload(name), withCow);
  expect(r.exit, r.stderr).toBe(0);
  expect(r.stdout.trim(), r.stderr).not.toBe("");
  return r.stdout.trim();
}

interface HookResult {
  exit: number;
  stdout: string;
  stderr: string;
}

async function hook(
  mode: "create" | "remove",
  payload: unknown,
  withCow = false,
): Promise<HookResult> {
  const proc = Bun.spawn([process.execPath, HOOK, mode], {
    cwd: tmp,
    env: env(withCow),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  proc.stdin.end();
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout, stderr };
}

const createPayload = (name: string, cwd = repo) => ({
  hook_event_name: "WorktreeCreate",
  name,
  cwd,
  session_id: "s",
});

async function writeShim(): Promise<void> {
  // Logs its argv, then does what git-cow does with plain git: add prints the
  // path on stdout, remove removes the worktree and safe-deletes its branch.
  const shim = join(shimDir, "git-cow");
  await writeFile(
    shim,
    `#!/bin/sh
printf '%s\\n' "$*" >> '${shimLog}'
cmd="$1"; shift
if [ "$cmd" = add ]; then
  git worktree add "$@" >&2 || exit 1
  if [ "$1" = -b ]; then p="$3"; else p="$1"; fi
  printf '%s\\n' "$p"
elif [ "$cmd" = remove ]; then
  for a in "$@"; do p="$a"; done
  b=$(git -C "$p" branch --show-current)
  git worktree remove --force "$p" || exit 1
  [ -n "$b" ] && git branch -d "$b" >&2
  exit 0
fi
`,
  );
  await chmod(shim, 0o755);
}

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "worktree-cow-")));
  home = join(tmp, "home");
  repo = join(tmp, "repo");
  shimDir = join(tmp, "shim");
  shimLog = join(tmp, "shim.log");
  await mkdir(home, { recursive: true });
  await mkdir(shimDir, { recursive: true });
  // The repo and the sh shim need a POSIX git; Windows runs only the detection tests.
  if (!posix) return;
  await mkdir(repo, { recursive: true });
  await sh(repo, "git", "init", "-q", "-b", "main");
  await writeFile(join(repo, ".gitignore"), "node_modules/\n*.local\n");
  await writeFile(join(repo, "tracked.txt"), "one\n");
  await sh(repo, "git", "add", ".");
  await sh(repo, "git", "commit", "-qm", "init");
  await writeShim();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe.skipIf(!posix)("worktree-cow create", () => {
  test("without git-cow: git worktree add on branch worktree-<name>, path is the only stdout", async () => {
    const r = await hook("create", createPayload("plain1"));
    const path = join(repo, ".claude", "worktrees", "plain1");
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${path}\n`);
    expect(await sh(path, "git", "branch", "--show-current")).toBe("worktree-plain1");
    expect(existsSync(shimLog)).toBe(false);
    expect(await readFile(join(repo, ".git", "info", "exclude"), "utf8")).toContain(
      "/.claude/worktrees/\n",
    );
    expect(await sh(repo, "git", "status", "--porcelain")).toBe("");
  });

  test("with git-cow: runs `git cow add -b`, and git-cow's stdout stays off ours", async () => {
    const r = await hook("create", createPayload("cow1"), true);
    const path = join(repo, ".claude", "worktrees", "cow1");
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${path}\n`);
    expect(await readFile(shimLog, "utf8")).toBe(`add -b worktree-cow1 ${path} HEAD\n`);
    expect(r.stderr).toContain(path);
    expect(await sh(path, "git", "branch", "--show-current")).toBe("worktree-cow1");
  });

  test("an existing worktree-<name> branch is checked out without -b", async () => {
    await sh(repo, "git", "branch", "worktree-again");
    const r = await hook("create", createPayload("again"), true);
    const path = join(repo, ".claude", "worktrees", "again");
    expect(r.exit, r.stderr).toBe(0);
    expect(await readFile(shimLog, "utf8")).toBe(`add ${path} worktree-again\n`);
    expect(await sh(path, "git", "branch", "--show-current")).toBe("worktree-again");
  });

  test("baseRef fresh starts from origin's default branch; head from local HEAD", async () => {
    const work = join(tmp, "work");
    await sh(tmp, "git", "clone", "-q", repo, work);
    await writeFile(join(work, "local.txt"), "local\n");
    await sh(work, "git", "add", ".");
    await sh(work, "git", "commit", "-qm", "local only");
    const remoteTip = await sh(work, "git", "rev-parse", "origin/main");
    const localTip = await sh(work, "git", "rev-parse", "HEAD");
    expect(remoteTip).not.toBe(localTip);

    const fresh = await hook("create", createPayload("fresh1", work));
    expect(fresh.exit, fresh.stderr).toBe(0);
    expect(await sh(fresh.stdout.trim(), "git", "rev-parse", "HEAD")).toBe(remoteTip);

    await mkdir(join(work, ".claude"), { recursive: true });
    await writeFile(
      join(work, ".claude", "settings.json"),
      JSON.stringify({ worktree: { baseRef: "head" } }),
    );
    const head = await hook("create", createPayload("head1", work));
    expect(head.exit, head.stderr).toBe(0);
    expect(await sh(head.stdout.trim(), "git", "rev-parse", "HEAD")).toBe(localTip);

    // settings.local.json wins over settings.json.
    await writeFile(
      join(work, ".claude", "settings.local.json"),
      JSON.stringify({ worktree: { baseRef: "fresh" } }),
    );
    const local = await hook("create", createPayload("local1", work));
    expect(await sh(local.stdout.trim(), "git", "rev-parse", "HEAD")).toBe(remoteTip);
  });

  test("an existing worktree at the path is reused", async () => {
    const first = await hook("create", createPayload("reuse"));
    expect(first.exit).toBe(0);
    const second = await hook("create", createPayload("reuse"), true);
    expect(second.exit, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toContain("reusing");
    expect(existsSync(shimLog)).toBe(false);
  });

  test("invalid names are refused before anything is created", async () => {
    for (const name of ["../escape", ".hidden", "a/b", "a..b", "-rf", ""]) {
      const r = await hook("create", createPayload(name), true);
      expect(r.exit, name).not.toBe(0);
      expect(r.stdout, name).toBe("");
    }
    expect(existsSync(join(repo, ".claude"))).toBe(false);
    expect(existsSync(join(tmp, "escape"))).toBe(false);
    expect(existsSync(shimLog)).toBe(false);
    expect(await readFile(join(repo, ".git", "info", "exclude"), "utf8")).not.toContain(
      ".claude/worktrees",
    );
  });

  test("garbage or nameless input prints nothing and changes nothing", async () => {
    for (const payload of ["not json{{{", "{}", '{"name":42}']) {
      const r = await hook("create", payload);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    }
    expect(existsSync(join(repo, ".claude"))).toBe(false);
  });

  test(".worktreeinclude copies only gitignored matches the worktree lacks", async () => {
    await writeFile(join(repo, ".worktreeinclude"), "*.local\nloose.txt\n");
    await mkdir(join(repo, "config"), { recursive: true });
    await writeFile(join(repo, "app.local"), "secret\n");
    await writeFile(join(repo, "config", "db.local"), "db\n");
    await writeFile(join(repo, "loose.txt"), "untracked, not ignored\n");
    await mkdir(join(repo, "node_modules"), { recursive: true });
    await writeFile(join(repo, "node_modules", "dep.js"), "dep\n");
    const r = await hook("create", createPayload("inc"));
    expect(r.exit, r.stderr).toBe(0);
    const path = r.stdout.trim();
    expect(await readFile(join(path, "app.local"), "utf8")).toBe("secret\n");
    expect(await readFile(join(path, "config", "db.local"), "utf8")).toBe("db\n");
    expect(existsSync(join(path, "loose.txt"))).toBe(false);
    expect(existsSync(join(path, "node_modules"))).toBe(false);
  });
});

describe.skipIf(!posix)("worktree-cow remove", () => {
  const removePayload = (path: string) => ({
    hook_event_name: "WorktreeRemove",
    worktree_path: path,
    session_id: "s",
  });

  test("without git-cow: removes the worktree and safe-deletes its merged branch", async () => {
    const path = await created("gone");
    const r = await hook("remove", removePayload(path));
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(path)).toBe(false);
    expect(await sh(repo, "git", "branch", "--list", "worktree-gone")).toBe("");
  });

  test("an unmerged branch survives removal", async () => {
    const path = await created("work");
    await writeFile(join(path, "new.txt"), "x\n");
    await sh(path, "git", "add", ".");
    await sh(path, "git", "commit", "-qm", "unmerged");
    const r = await hook("remove", removePayload(path));
    expect(r.exit, r.stderr).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(await sh(repo, "git", "branch", "--list", "worktree-work")).toContain("worktree-work");
  });

  test("with git-cow: runs `git cow remove --warm --force`", async () => {
    const path = await created("cowgone", true);
    const r = await hook("remove", removePayload(path), true);
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
    expect((await readFile(shimLog, "utf8")).split("\n")).toContain(
      `remove --warm --force ${path}`,
    );
    expect(existsSync(path)).toBe(false);
  });

  test("refuses the main checkout, a locked worktree, and the git-cow spare checkout", async () => {
    const locked = await created("locked");
    await sh(repo, "git", "worktree", "lock", locked);
    const spare = join(repo, ".claude", "worktrees", ".git-cow", "repo");
    await sh(repo, "git", "worktree", "add", "-q", "--detach", spare);
    for (const path of [repo, locked, spare]) {
      const r = await hook("remove", removePayload(path), true);
      expect(r.exit, path).toBe(1);
      expect(existsSync(path), path).toBe(true);
    }
    expect(existsSync(shimLog) ? await readFile(shimLog, "utf8") : "").not.toContain("remove");
  });

  test("a missing directory or garbage input is a no-op", async () => {
    expect((await hook("remove", removePayload(join(repo, "nope")))).exit).toBe(0);
    expect((await hook("remove", "not json{{{")).exit).toBe(0);
  });
});

describe("git-cow detection and hook wiring", () => {
  test("finds git-cow on PATH or in ~/.cargo/bin only", async () => {
    expect(findGitCow("", home)).toBeNull();
    expect(gitCowUsable("", home)).toBe(false);
    if (posix) {
      expect(findGitCow(shimDir, home)).toBe(join(shimDir, "git-cow"));
      const cargo = join(home, ".cargo", "bin");
      await mkdir(cargo, { recursive: true });
      await Bun.write(join(cargo, "git-cow"), await Bun.file(join(shimDir, "git-cow")).text());
      await chmod(join(cargo, "git-cow"), 0o755);
      expect(findGitCow("", home)).toBe(join(cargo, "git-cow"));
      expect(gitCowUsable("", home)).toBe(true);
    }
  });

  test("withWorktreeHooks drops only the two worktree events when git-cow is absent", async () => {
    const composed = await composeSettings(REPO);
    const hooks = composed.hooks as Record<string, unknown>;
    expect(Object.keys(hooks)).toContain("WorktreeCreate");
    expect(Object.keys(hooks)).toContain("WorktreeRemove");
    const stripped = withWorktreeHooks(composed, false).hooks as Record<string, unknown>;
    expect(Object.keys(stripped).sort()).toEqual(
      Object.keys(hooks)
        .filter((e) => e !== "WorktreeCreate" && e !== "WorktreeRemove")
        .sort(),
    );
    expect(composed.hooks).toBe(hooks);
    expect(withWorktreeHooks(composed, true)).toBe(composed);
  });

  test.skipIf(!posix)(
    "installSettings wires the worktree hooks only when git-cow is installed",
    async () => {
      const install = async (): Promise<Record<string, unknown>> => {
        const script = join(tmp, "run-install.ts");
        await writeFile(
          script,
          `import { installSettings } from ${JSON.stringify(join(REPO, "src/lib/claude-install-settings.ts"))};
import { getEngine } from ${JSON.stringify(join(REPO, "src/lib/code-intel-engine.ts"))};
import { CLAUDE_DIR } from ${JSON.stringify(join(REPO, "src/lib/platform.ts"))};
await installSettings(${JSON.stringify(REPO)}, "0.0.0-test", false, "full", getEngine("native-ts", CLAUDE_DIR));
`,
        );
        const proc = Bun.spawn([process.execPath, script], {
          env: {
            ...env(false),
            USERPROFILE: home,
            NODE_ENV: "test",
            CC_SKIP_DEPS: "1",
            CC_SETTINGS_SKIP_PLUGIN_INSTALL: "1",
            CC_SKIP_SCHEDULE: "1",
            CC_SKIP_CODEX_CLI: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exit] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect(exit, `${out}\n${err}`).toBe(0);
        const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
        return settings.hooks as Record<string, unknown>;
      };

      await mkdir(join(home, ".claude"), { recursive: true });
      const without = await install();
      expect(Object.keys(without)).not.toContain("WorktreeCreate");
      expect(Object.keys(without)).not.toContain("WorktreeRemove");
      expect(Object.keys(without)).toContain("SessionEnd");

      const cargo = join(home, ".cargo", "bin");
      await mkdir(cargo, { recursive: true });
      await Bun.write(join(cargo, "git-cow"), "#!/bin/sh\n");
      await chmod(join(cargo, "git-cow"), 0o755);
      const withCow = await install();
      expect(JSON.stringify(withCow.WorktreeCreate)).toContain('worktree-cow.ts\\" create');
      expect(JSON.stringify(withCow.WorktreeRemove)).toContain('worktree-cow.ts\\" remove');

      // git-cow uninstalled later: the wired groups stay once each (create then
      // falls back to git worktree add), never duplicated.
      await rm(join(cargo, "git-cow"));
      const after = await install();
      expect(after.WorktreeCreate).toEqual(withCow.WorktreeCreate);
      expect(after.WorktreeRemove).toEqual(withCow.WorktreeRemove);
      expect(after.WorktreeCreate as unknown[]).toHaveLength(1);
      expect(after.WorktreeRemove as unknown[]).toHaveLength(1);
    },
    90_000,
  );

  test.skipIf(!posix)(
    "the install offer: hint when it cannot ask, silent on CC_GIT_COW=0, a no is remembered",
    async () => {
      const offer = async (call: string, extra: Record<string, string> = {}): Promise<string> => {
        const script = join(tmp, "run-offer.ts");
        await writeFile(
          script,
          `import { askGitCowUpfront, installGitCow } from ${JSON.stringify(join(REPO, "src/lib/git-cow.ts"))};
${call}
`,
        );
        const proc = Bun.spawn([process.execPath, script], {
          env: { ...env(false), ...extra },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exit] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect(exit, err).toBe(0);
        return out + err;
      };
      const declined = join(home, ".claude", ".git-cow-declined");
      const install = "cargo install git-cow --version 0.6.0 --locked";

      expect(await offer('console.log(String(await askGitCowUpfront("full", false)));')).toBe(
        "undefined\n",
      );
      expect(await offer('await installGitCow("full", undefined, false);')).toContain(install);
      expect(await offer('await installGitCow("light", undefined, false);')).toBe("");
      expect(
        await offer('await installGitCow("full", undefined, false);', { CC_GIT_COW: "0" }),
      ).toBe("");
      expect(
        await offer('await installGitCow("full", undefined, false);', { CC_SKIP_DEPS: "1" }),
      ).toBe("");

      expect(await offer('await installGitCow("full", false, false);')).toContain(
        "won't ask again",
      );
      expect(existsSync(declined)).toBe(true);
      expect(await offer('await installGitCow("full", undefined, false);')).toBe("");
      expect(await offer('await installGitCow("full", undefined, true);')).toContain(install);
    },
    60_000,
  );
});
