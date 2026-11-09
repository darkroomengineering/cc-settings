import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";
import { spawnCapture } from "./support/proc.ts";

const DRIVER = resolve(import.meta.dir, "support/session-worktrees-driver.ts");
const CONFIG = resolve(import.meta.dir, "../src/bunfig.toml");
let home: string;
let bin: string;
let tmp: string;
let repository: string;
let linked: string;
let gitMap: Record<string, string[]>;

function shellQuote(value: string): string {
  return `'${gitBashPath(value).replaceAll("'", "'\\''")}'`;
}

async function executable(path: string, source: string): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(`${path}.ts`, source);
  // drive() strips PATH to the fixture bin, so a Windows entry point cannot reach Git Bash.
  // Writing no extensionless file also keeps prependTestPath from replacing this one.
  if (process.platform === "win32") {
    await writeFile(
      `${path}.cmd`,
      `@echo off\r\n"${process.execPath}" --no-env-file "--config=${CONFIG}" "${path}.ts" %*\r\n`,
    );
    return;
  }
  await writeFile(
    path,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} --no-env-file --config=${shellQuote(CONFIG)} ${shellQuote(`${path}.ts`)} "$@"\n`,
  );
  await chmod(path, 0o755);
}

async function worktree(name: string, main = false): Promise<string> {
  const root = join(home, name);
  const common = join(home, "repo", ".git");
  const git = main ? common : join(common, "worktrees", name);
  await Promise.all([mkdir(root, { recursive: true }), mkdir(git, { recursive: true })]);
  gitMap[root] = [git, common, root];
  return root;
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "session-worktrees-")));
  bin = join(home, "bin");
  tmp = join(home, ".claude", "tmp");
  gitMap = {};
  repository = await worktree("repo", true);
  linked = await worktree("linked");
  await executable(
    join(bin, "git"),
    `
const args = process.argv.slice(2);
const map = JSON.parse(process.env.GIT_FIXTURE ?? '{}');
const fields = args[0] === '-C' ? map[args[1]] : undefined;
if (!fields) process.exit(1);
console.log(fields.join('\\n'));
`,
  );
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

interface Step {
  output: string[];
  errors: string[];
  cwd?: string;
}

function event(name: string, session = "a", cwd = repository): Record<string, unknown> {
  return { hook_event_name: name, session_id: session, cwd };
}

function created(path: string, tool = "Agent", session = "a"): Record<string, unknown> {
  return {
    ...event("PostToolUse", session),
    tool_name: tool,
    tool_response: { worktreePath: path },
  };
}

async function drive(
  payloads: unknown[],
  extra: Record<string, string> = {},
  cwd?: string,
): Promise<Step[]> {
  const { stdout, exit } = await spawnCapture(
    [process.execPath, "--no-env-file", `--config=${CONFIG}`, DRIVER],
    {
      cwd,
      stdin: JSON.stringify(payloads),
      env: {
        HOME: home,
        USERPROFILE: home,
        CC_SETTINGS_HOME: join(home, ".claude"),
        CC_SESSION_WORKTREE_CLEANUP_ENABLED: undefined,
        CLAUDE_CODE_SESSION_ID: undefined,
        PATH: prependTestPath(bin, ""),
        GIT_FIXTURE: JSON.stringify(gitMap),
        CALLS: join(home, "programa-calls.jsonl"),
        ...extra,
      },
    },
  );
  expect(exit).toBe(0);
  return JSON.parse(stdout) as Step[];
}

async function programa(location = join(bin, "programa")): Promise<void> {
  await executable(
    location,
    `
import { appendFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (process.env.SAFETY_RECEIPT) {
  writeFileSync(process.env.SAFETY_RECEIPT, JSON.stringify({
    cwd: process.cwd(),
    stateFiles: readdirSync(process.env.STATE_DIR).filter(name => name.startsWith('session-worktrees-')),
  }));
}
if (process.env.PROGRAMA_EXIT) {
  console.error('unknown flag --path');
  process.exit(Number(process.env.PROGRAMA_EXIT));
}
if (process.env.REMOVE_WORKTREES === '1') {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path') rmSync(args[i + 1], { recursive: true });
  }
}
console.log(process.env.PROGRAMA_JSON ?? '{}');
`,
  );
}

async function calls(): Promise<string[][]> {
  try {
    return (await readFile(join(home, "programa-calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function stateFiles(): Promise<string[]> {
  try {
    return (await readdir(tmp)).filter((name) => name.startsWith("session-worktrees-"));
  } catch {
    return [];
  }
}

describe("session worktree ownership", () => {
  test("separate sessions clean only their own paths and discard only their own records", async () => {
    const other = await worktree("other");
    await programa();
    await drive([created(linked), created(other, "Task", "b")]);
    expect(await stateFiles()).toHaveLength(2);
    await drive([event("SessionEnd", "a")]);
    expect(await calls()).toEqual([
      ["storage", "clean", "--path", linked, "--now", "--include-external", "--json"],
    ]);
    expect(await stateFiles()).toHaveLength(1);
    await drive([event("SessionEnd", "b")]);
    expect((await calls())[1]).toEqual([
      "storage",
      "clean",
      "--path",
      other,
      "--now",
      "--include-external",
      "--json",
    ]);
    expect(await stateFiles()).toEqual([]);
  });

  test("the main checkout never becomes a cleanup scope", async () => {
    await programa();
    await drive([created(repository, "EnterWorktree"), event("SessionEnd")]);
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("starting and ending inside a manual worktree never acquires it", async () => {
    await programa();
    await drive([event("SessionStart", "a", linked)], { REMOVE_WORKTREES: "1" }, linked);
    expect(await stateFiles()).toEqual([]);
    await drive([event("SessionEnd", "a", linked)], { REMOVE_WORKTREES: "1" }, linked);
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
    expect((await stat(linked)).isDirectory()).toBe(true);
  });

  test("changing into a manual worktree never acquires it", async () => {
    await programa();
    await drive([{ ...event("CwdChanged"), new_cwd: linked }]);
    expect(await stateFiles()).toEqual([]);
    await drive([event("SessionEnd", "a", linked)], { REMOVE_WORKTREES: "1" }, linked);
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
    expect((await stat(linked)).isDirectory()).toBe(true);
  });

  test("structured tool results build one deduplicated scoped invocation", async () => {
    const second = await worktree("second; echo unsafe");
    const third = await worktree("third");
    await programa();
    const steps = await drive([
      created(linked),
      created(second, "EnterWorktree"),
      created(third),
      created(third, "Task"),
      event("SessionEnd"),
    ]);
    expect(await calls()).toEqual([
      [
        "storage",
        "clean",
        "--path",
        linked,
        "--path",
        second,
        "--path",
        third,
        "--now",
        "--include-external",
        "--json",
      ],
    ]);
    expect(steps.flatMap((step) => step.output)).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("parallel completions retain every session path", async () => {
    const roots = await Promise.all(["one", "two", "three", "four"].map((name) => worktree(name)));
    await programa();
    await Promise.all(roots.map((root) => drive([created(root)])));
    await drive([event("SessionEnd")]);
    const invocation = (await calls())[0] ?? [];
    const paths = invocation.filter((_value, index) => invocation[index - 1] === "--path");
    expect(paths.sort()).toEqual(roots.sort());
    expect(await calls()).toHaveLength(1);
  });

  test("subdirectories normalize to linked root and corrupted main-checkout records cannot broaden scope", async () => {
    const subdir = join(linked, "src");
    await mkdir(subdir);
    gitMap[subdir] = gitMap[linked] ?? [];
    await programa();
    await drive([created(subdir, "EnterWorktree")]);
    const [file] = await stateFiles();
    if (!file) throw new Error("Missing session record");
    await appendFile(
      join(tmp, file),
      `${JSON.stringify(repository)}\n${JSON.stringify(home)}\nnot-json\n`,
    );
    await drive([event("SessionEnd")]);
    expect(await calls()).toEqual([
      ["storage", "clean", "--path", linked, "--now", "--include-external", "--json"],
    ]);
  });

  test("unrelated tools, unsupported responses and invalid session input never acquire paths", async () => {
    await programa();
    await drive([
      { ...event("PostToolUse"), tool_name: "Bash", tool_response: { worktreePath: linked } },
      { ...event("PostToolUse"), tool_name: ["Agent"], tool_response: { worktreePath: linked } },
      { ...event("PostToolUse"), tool_name: "Agent", tool_response: `worktreePath: ${linked}` },
      { ...event("PostToolUse"), tool_name: "Task", tool_response: { worktreePath: 1 } },
      {
        ...event("PostToolUse"),
        tool_name: "EnterWorktree",
        tool_response: [{ worktreePath: linked }],
      },
      created(linked, "Agent", ""),
      "invalid json",
      event("SessionEnd"),
    ]);
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });
});

describe("cleanup fails open", () => {
  test("the hook leaves its target and deletes session state before Programa starts", async () => {
    await programa();
    await drive([created(linked)]);
    const receipt = join(home, "safety-receipt.json");
    const steps = await drive(
      [event("SessionEnd", "a", linked)],
      { CAPTURE_CWD: "1", SAFETY_RECEIPT: receipt, STATE_DIR: tmp },
      linked,
    );
    expect(steps).toEqual([{ output: [], errors: [], cwd: tmp }]);
    expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({ cwd: tmp, stateFiles: [] });
    expect(await calls()).toEqual([
      ["storage", "clean", "--path", linked, "--now", "--include-external", "--json"],
    ]);
  });

  test("missing Programa is silent and still deletes the session record", async () => {
    const steps = await drive([created(linked), event("SessionEnd")]);
    expect(steps).toEqual([
      { output: [], errors: [] },
      { output: [], errors: [] },
    ]);
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("an older Programa exits nonzero once, logs the skip and never retries broader cleanup", async () => {
    await programa();
    const steps = await drive([created(linked), event("SessionEnd")], {
      PROGRAMA_EXIT: "2",
    });
    expect(await calls()).toEqual([
      ["storage", "clean", "--path", linked, "--now", "--include-external", "--json"],
    ]);
    expect(steps.flatMap((step) => step.output)).toEqual([]);
    expect(steps[1]?.errors.join("\n")).toContain("exit 2");
    expect(await stateFiles()).toEqual([]);
  });

  test("invalid Programa JSON is swallowed with a diagnostic and no removal claim", async () => {
    await programa();
    await drive([created(linked)]);
    const steps = await drive([event("SessionEnd", "a", linked)], { PROGRAMA_JSON: "not-json" });
    expect(await calls()).toHaveLength(1);
    expect(steps[0]?.output).toEqual([]);
    expect(steps[0]?.errors).toHaveLength(1);
    expect(await stateFiles()).toEqual([]);
  });

  test("disabled cleanup makes no invocation and discards records from earlier enabled events", async () => {
    await programa();
    await drive([created(linked)]);
    expect(await stateFiles()).toHaveLength(1);
    await drive([event("SessionEnd")], { CC_SESSION_WORKTREE_CLEANUP_ENABLED: "false" });
    expect(await calls()).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });

  test("HOME local-bin fallback works without a Programa entry on PATH", async () => {
    await programa(join(home, ".local", "bin", "programa"));
    await drive([created(linked, "Task"), event("SessionEnd", "a", linked)]);
    expect(await calls()).toEqual([
      ["storage", "clean", "--path", linked, "--now", "--include-external", "--json"],
    ]);
  });

  test("only confirmed removal prints one plain summary line", async () => {
    const second = await worktree("second");
    await programa();
    const steps = await drive(
      [created(linked, "EnterWorktree"), created(second, "Task"), event("SessionEnd")],
      { REMOVE_WORKTREES: "1" },
    );
    expect(steps.flatMap((step) => step.output)).toEqual(["Removed 2 merged worktrees"]);
    expect(steps.flatMap((step) => step.errors)).toEqual([]);
    expect(await stateFiles()).toEqual([]);
  });
});
