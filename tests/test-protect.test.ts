import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  addedMarkers,
  bashFindings,
  isTestFile,
  main,
  SKIP_MARKERS,
} from "../src/hooks/test-protect.ts";
import { captureIO } from "../src/lib/hook-runtime.ts";

const CWD = "/repo-that-does-not-exist";
const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "test-protect.ts");

async function run(payload: Record<string, unknown>): Promise<string[]> {
  const io = captureIO(JSON.stringify(payload));
  await main(io);
  return io.asks;
}

describe("isTestFile", () => {
  test.each([
    "tests/x.test.ts",
    "src/a.spec.tsx",
    "src/__tests__/a.ts",
    "e2e/flow.ts",
    "src/test/java/A.java",
    "pkg/a_test.go",
    "test_a.py",
  ])("%s is a test file", (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  test.each(["src/a.ts", "x.test.ts.bak", "contest/a.ts", "tests"])(
    "%s is not a test file",
    (path) => {
      expect(isTestFile(path)).toBe(false);
    },
  );
});

describe("addedMarkers", () => {
  test.each([...SKIP_MARKERS])("detects %s when added", (marker) => {
    expect(addedMarkers("", `foo ${marker}x)`)).toEqual([marker]);
  });

  test("identifiers that merely end in a marker are not markers", () => {
    expect(addedMarkers("", "process.exit(1); submit.skip")).toEqual([]);
  });

  test("it.skip( reports only it.skip, not the .skip( inside it", () => {
    expect(addedMarkers("", "it.skip('a', () => {})")).toEqual(["it.skip"]);
  });

  test("@pytest.mark.skip(reason=...) reports one marker", () => {
    expect(addedMarkers("", "@pytest.mark.skip(reason='flaky')")).toEqual(["@pytest.mark.skip"]);
  });

  test("an unchanged marker count adds nothing", () => {
    expect(addedMarkers("it.skip('a')", "it.skip('b')")).toEqual([]);
  });

  test("removing a marker adds nothing", () => {
    expect(addedMarkers("it.skip('a')", "it('a')")).toEqual([]);
  });
});

describe("bashFindings asks", () => {
  test.each([
    ["rm tests/x.test.ts", "deletes tests/x.test.ts"],
    ["rm -r tests", "deletes tests"],
    ["unlink e2e/a.ts", "deletes e2e/a.ts"],
    ["git rm --cached tests/a.test.ts", "deletes tests/a.test.ts"],
    ["git -C . rm tests/a.test.ts", "deletes tests/a.test.ts"],
    ["rm 'tests/a b.test.ts'", "deletes tests/a b.test.ts"],
    [
      "mv tests/x.test.ts tests/x.test.ts.bak",
      "renames tests/x.test.ts to tests/x.test.ts.bak, which no test runner picks up",
    ],
    [
      "mv tests/a.test.ts tests/a.ts",
      "renames tests/a.test.ts to tests/a.ts, which no test runner picks up",
    ],
    [
      "mv src/a.spec.ts /tmp/",
      `renames src/a.spec.ts to ${join("/tmp/", "a.spec.ts")}, which no test runner picks up`,
    ],
  ])("%s", async (command, finding) => {
    expect(await bashFindings(command, CWD)).toEqual([finding]);
  });
});

describe("bashFindings silent", () => {
  test.each([
    "mv a.test.ts b.test.ts",
    "mv -t old tests/a.test.ts",
    "git mv src/a.spec.ts archive/",
    "echo rm tests/x.test.ts",
    "git commit -m 'rm tests/x.test.ts'",
    "rm src/foo.ts",
  ])("%s", async (command) => {
    expect(await bashFindings(command, CWD)).toEqual([]);
  });

  test("an unterminated quote does not throw", async () => {
    expect(await bashFindings("rm 'src/x", CWD)).toEqual([]);
  });
});

describe("main: Bash", () => {
  test("a delete and a rename in one command become one ask joined by '; '", async () => {
    const asks = await run({
      tool_name: "Bash",
      cwd: CWD,
      tool_input: { command: "rm tests/x.test.ts && mv tests/a.test.ts tests/a.ts" },
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toStartWith("[Test Guard] deletes tests/x.test.ts; renames tests/a.test.ts");
  });
});

describe("main: Edit", () => {
  test("adding a marker to a test file asks", async () => {
    const asks = await run({
      tool_name: "Edit",
      cwd: CWD,
      tool_input: { file_path: "tests/a.test.ts", old_string: "it('a'", new_string: "it.skip('a'" },
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toStartWith(`[Test Guard] adds it.skip to ${join("tests", "a.test.ts")}`);
  });

  test("adding a marker to a non-test file is silent", async () => {
    const asks = await run({
      tool_name: "Edit",
      cwd: CWD,
      tool_input: { file_path: "src/a.ts", old_string: "it('a'", new_string: "it.skip('a'" },
    });
    expect(asks).toEqual([]);
  });

  test("replace_all does not bypass the count rule", async () => {
    const added = await run({
      tool_name: "Edit",
      cwd: CWD,
      tool_input: {
        file_path: "tests/a.test.ts",
        old_string: "it(",
        new_string: "it.only(",
        replace_all: true,
      },
    });
    expect(added).toHaveLength(1);
    const unchanged = await run({
      tool_name: "Edit",
      cwd: CWD,
      tool_input: {
        file_path: "tests/a.test.ts",
        old_string: "it.skip('a'",
        new_string: "it.skip('b'",
        replace_all: true,
      },
    });
    expect(unchanged).toEqual([]);
  });

  test("a non-string new_string is silent", async () => {
    const asks = await run({
      tool_name: "Edit",
      cwd: CWD,
      tool_input: { file_path: "tests/a.test.ts", old_string: "it(", new_string: 42 },
    });
    expect(asks).toEqual([]);
  });
});

describe("main: Write", () => {
  let dir: string;
  const existing = "it('a', () => {});\nit.skip('b', () => {});\n";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "test-protect-"));
    await mkdir(join(dir, "tests"));
    await writeFile(join(dir, "tests", "a.test.ts"), existing);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a new test file with markers is silent", async () => {
    const asks = await run({
      tool_name: "Write",
      cwd: dir,
      tool_input: { file_path: "tests/new.test.ts", content: "it.skip('a', () => {});" },
    });
    expect(asks).toEqual([]);
  });

  test("an existing test file gaining markers asks; relative path resolves against cwd", async () => {
    const asks = await run({
      tool_name: "Write",
      cwd: dir,
      tool_input: { file_path: "tests/a.test.ts", content: `${existing}it.only('c', () => {});\n` },
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toStartWith(`[Test Guard] adds .only( to ${join("tests", "a.test.ts")}`);
  });

  test("rewriting with the same markers is silent", async () => {
    const asks = await run({
      tool_name: "Write",
      cwd: dir,
      tool_input: { file_path: "tests/a.test.ts", content: "it.skip('renamed', () => {});\n" },
    });
    expect(asks).toEqual([]);
  });

  test("a non-string content is silent", async () => {
    const asks = await run({
      tool_name: "Write",
      cwd: dir,
      tool_input: { file_path: "tests/a.test.ts", content: null },
    });
    expect(asks).toEqual([]);
  });

  test("a missing cwd resolves the path against process.cwd()", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: "tests/a.test.ts", content: `${existing}xit('c', () => {});\n` },
    };
    const original = process.cwd();
    process.chdir(dir);
    try {
      expect(await run(payload)).toHaveLength(1);
      expect(await run({ ...payload, cwd: join(dir, "elsewhere") })).toEqual([]);
    } finally {
      process.chdir(original);
    }
  });
});

describe("fail-open (standalone process)", () => {
  async function spawnHook(stdin: string): Promise<{ stdout: string; exit: number }> {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "TOOL_NAME" || key === "TOOL_INPUT" || key.startsWith("TOOL_INPUT_")) {
        delete env[key];
      }
    }
    const proc = Bun.spawn(["bun", HOOK], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(stdin);
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exit: await proc.exited };
  }

  test("a malformed payload exits 0 with no output", async () => {
    expect(await spawnHook("{not json")).toEqual({ stdout: "", exit: 0 });
  });

  test("a read error inside the hook exits 0 with no output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "test-protect-eisdir-"));
    try {
      await mkdir(join(dir, "tests", "dir.test.ts"), { recursive: true });
      const payload = {
        tool_name: "Write",
        cwd: dir,
        tool_input: { file_path: "tests/dir.test.ts", content: "it.only('a', () => {});" },
      };
      await expect(main(captureIO(JSON.stringify(payload)))).rejects.toThrow();
      expect(await spawnHook(JSON.stringify(payload))).toEqual({ stdout: "", exit: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
