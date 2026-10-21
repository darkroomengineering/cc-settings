import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyProof, flagValue, main } from "../src/hooks/visual-proof.ts";
import { captureIO, HookBlocked } from "../src/lib/hook-runtime.ts";

let root: string;
/** Branch adds src/Button.tsx and src/util.ts on top of origin/main. */
let designRepo: string;
/** Branch changes only src/util.ts. */
let logicRepo: string;
/** Branch adds src/Button.tsx on top of origin/release; origin/main is HEAD. */
let baseRepo: string;
let notARepo: string;

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(
    [
      "git",
      "-C",
      cwd,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

async function commitFile(repo: string, path: string, content: string): Promise<void> {
  await mkdir(join(repo, path, ".."), { recursive: true });
  await writeFile(join(repo, path), content);
  git(repo, "add", "--", path);
  git(repo, "commit", "-q", "-m", `add ${path}`);
}

async function makeRepo(name: string, branchFiles: string[], baseRef: string): Promise<string> {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q");
  await commitFile(repo, "README.md", "base\n");
  git(repo, "update-ref", `refs/remotes/origin/${baseRef}`, "HEAD");
  for (const file of branchFiles) await commitFile(repo, file, `${file}\n`);
  return repo;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "visual-proof-"));
  designRepo = await makeRepo("design", ["src/Button.tsx", "src/util.ts"], "main");
  logicRepo = await makeRepo("logic", ["src/util.ts"], "main");
  baseRepo = await makeRepo("base", ["src/Button.tsx"], "release");
  git(baseRepo, "update-ref", "refs/remotes/origin/main", "HEAD");
  notARepo = join(root, "plain");
  await mkdir(notARepo, { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The block reason, or null when the call is allowed silently. */
async function run(command: string, cwd: string, tool = "Bash"): Promise<string | null> {
  const io = captureIO(JSON.stringify({ tool_name: tool, cwd, tool_input: { command } }));
  try {
    await main(io);
  } catch (err) {
    if (err instanceof HookBlocked) return err.reason;
    throw err;
  }
  expect(io.asks).toEqual([]);
  expect(io.contexts).toEqual([]);
  return null;
}

async function bodyFile(name: string, content: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, content);
  return path;
}

describe("visual-proof", () => {
  test("blocks a design change whose body has no proof, listing the design files only", async () => {
    const reason = await run(`gh pr create --title "Button" --body "Adds a button."`, designRepo);
    expect(reason?.startsWith("[Visual Proof]")).toBe(true);
    expect(reason).toContain("src/Button.tsx");
    expect(reason).not.toContain("src/util.ts");
    expect(reason).toContain("Screenshots: before/after needed");
  });

  test("passes a body with a markdown image", async () => {
    const body = "Adds a button.\n\n![after](https://github.com/user-attachments/assets/abc.png)";
    expect(await run(`gh pr create --title x --body '${body}'`, designRepo)).toBeNull();
  });

  test("passes a body with an <img> tag", async () => {
    const file = await bodyFile("img.md", '<img src="https://example.com/after.png" width="400">');
    expect(await run(`gh pr create --title x --body-file "${file}"`, designRepo)).toBeNull();
  });

  test.each([
    "Screenshots: before/after needed",
    "- **Screenshots: before/after needed**",
    "**Screenshots:** before/after needed",
    "screenshots: Before/After needed for the hero",
  ])("passes a body carrying %p", async (line) => {
    const file = await bodyFile("line.md", `## What this does\n\nStuff.\n\n${line}\n`);
    expect(await run(`gh pr create -t x -F "${file}"`, designRepo)).toBeNull();
  });

  test("a raw.githubusercontent.com image does not count as proof", async () => {
    const file = await bodyFile(
      "raw.md",
      "![after](https://raw.githubusercontent.com/o/r/branch/after.png)\n",
    );
    const reason = await run(`gh pr create --title x --body-file "${file}"`, designRepo);
    expect(reason?.startsWith("[Visual Proof]")).toBe(true);
    expect(reason).toContain("raw.githubusercontent.com");
  });

  test("a raw.githubusercontent.com image passes next to the screenshots line", async () => {
    const file = await bodyFile(
      "raw-line.md",
      "![a](https://raw.githubusercontent.com/o/r/b/a.png)\nScreenshots: before/after needed\n",
    );
    expect(await run(`gh pr create --title x --body-file "${file}"`, designRepo)).toBeNull();
  });

  test("a branch without design files is silent", async () => {
    expect(await run(`gh pr create --title x --body "Logic only."`, logicRepo)).toBeNull();
  });

  test.each([
    "gh pr create --fill",
    "gh pr create --fill-first",
    "gh pr create --web",
    "gh pr create -w",
    "gh pr create --title x --editor",
    'gh pr create --title x --body "$BODY"',
    'gh pr create --title x --body "$(cat notes.md)"',
    "gh pr create --title x --body-file -",
    "gh pr create --title x --body-file <(echo hi)",
    "gh pr create --title x",
  ])("an unreadable body is silent: %s", async (command) => {
    expect(await run(command, designRepo)).toBeNull();
  });

  test.each([
    'echo gh pr create --body "x"',
    'git commit -m "gh pr create --body x"',
    'gh issue create --title x --body "x"',
  ])("a command that is not gh pr create is silent: %s", async (command) => {
    expect(await run(command, designRepo)).toBeNull();
  });

  test("gh pr edit without a body flag is silent", async () => {
    expect(await run("gh pr edit 12 --add-label design", designRepo)).toBeNull();
  });

  test("gh pr edit with a body is checked", async () => {
    const reason = await run(`gh pr edit --body "New body."`, designRepo);
    expect(reason?.startsWith("[Visual Proof]")).toBe(true);
  });

  test("a missing --body-file is silent", async () => {
    expect(await run("gh pr create --title x --body-file missing.md", designRepo)).toBeNull();
  });

  test("--body-file resolves against the payload cwd and a literal cd", async () => {
    await writeFile(join(designRepo, "body.md"), "No images here.\n");
    expect(await run("gh pr create --title x --body-file body.md", designRepo)).not.toBeNull();
    expect(
      await run(`cd "${designRepo}" && gh pr create --title x --body-file body.md`, root),
    ).not.toBeNull();
  });

  test("a git failure is silent", async () => {
    expect(await run(`gh pr create --title x --body "x"`, notARepo)).toBeNull();
  });

  test("a non-Bash tool is ignored", async () => {
    expect(await run(`gh pr create --title x --body "x"`, designRepo, "Edit")).toBeNull();
  });

  test("--base is honored", async () => {
    // origin/main is HEAD, so the default base sees no change.
    expect(await run(`gh pr create --title x --body "x"`, baseRepo)).toBeNull();
    for (const flag of [
      "--base release",
      "--base=release",
      "-B release",
      "--base origin/release",
    ]) {
      const reason = await run(`gh pr create --title x ${flag} --body "x"`, baseRepo);
      expect(reason).toContain("src/Button.tsx");
    }
  });

  test("an unknown --base is silent", async () => {
    expect(await run(`gh pr create --base nope --title x --body "x"`, designRepo)).toBeNull();
  });
});

describe("flagValue", () => {
  test.each([
    [["--body", "a"], "a"],
    [["--body=a"], "a"],
    [["-b", "a"], "a"],
    [["-ba"], "a"],
    [["--body-file", "f"], undefined],
    [["--body", "a", "--body", "b"], "b"],
  ])("%p reads %p", (args, expected) => {
    expect(flagValue(args, "--body", "-b")).toBe(expected);
  });
});

describe("bodyProof", () => {
  test("text that merely mentions an image is not proof", () => {
    expect(bodyProof("Fix the img alt text and the ![ parser").ok).toBe(false);
  });

  test("a mix of raw and hosted images is proof", () => {
    const body =
      "![a](https://raw.githubusercontent.com/o/r/b/a.png) ![b](https://i.imgur.com/b.png)";
    expect(bodyProof(body)).toEqual({ ok: true, committedOnly: false });
  });
});
