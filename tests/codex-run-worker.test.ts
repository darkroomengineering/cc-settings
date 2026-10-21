// End-to-end check of the exec worker result. A fake `codex` on PATH records its
// argv, optionally writes a file into the repo, and copies a canned final message
// to the `--output-last-message` path; codex-run.ts runs in a child inside a temp
// git repo so the readiness check sees a real tree.

import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitBashPath, prependTestPath } from "./support/portable-process.ts";

const RUN = resolve(import.meta.dir, "../src/scripts/codex-run.ts");

const FAKE_CODEX = `#!/bin/sh
if [ "$1" = "login" ]; then exit 0; fi
printf '%s\\n' "$@" > "$FAKE_ARGV"
out=""
schema=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$arg"; fi
  if [ "$prev" = "--output-schema" ]; then schema="$arg"; fi
  prev="$arg"
done
if [ -n "$schema" ]; then cp "$schema" "$FAKE_SCHEMA_COPY"; fi
if [ -n "$FAKE_TOUCH" ]; then echo changed > "$FAKE_TOUCH"; fi
if [ -n "$out" ] && [ -n "$FAKE_RESULT" ]; then cp "$FAKE_RESULT" "$out"; fi
echo "final message"
`;

interface Run {
  stdout: string;
  stderr: string;
  code: number;
  argv: string[];
  schema: string;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

async function runCodexRun(
  args: string[],
  opts: { result?: unknown; touch?: string } = {},
): Promise<Run> {
  const dir = await mkdtemp(join(tmpdir(), "cc-codex-worker-"));
  try {
    const bin = join(dir, "bin");
    const repo = join(dir, "repo");
    await mkdir(bin);
    await mkdir(repo);
    await writeFile(join(bin, "codex"), FAKE_CODEX);
    await chmod(join(bin, "codex"), 0o755);
    await git(repo, "init", "-q");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "a.ts"), "export {};\n");
    await git(repo, "add", "a.ts");
    await git(repo, "commit", "-q", "-m", "init");

    const argvFile = join(dir, "argv.txt");
    const schemaCopy = join(dir, "schema.json");
    const resultFile = join(dir, "result.json");
    if (opts.result !== undefined) {
      await writeFile(
        resultFile,
        typeof opts.result === "string" ? opts.result : JSON.stringify(opts.result),
      );
    }
    const home = join(dir, "home");
    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: prependTestPath(bin),
      HOME: home,
      USERPROFILE: home,
      FAKE_ARGV: gitBashPath(argvFile),
      FAKE_SCHEMA_COPY: gitBashPath(schemaCopy),
      FAKE_RESULT: opts.result !== undefined ? gitBashPath(resultFile) : "",
      FAKE_TOUCH: opts.touch ? gitBashPath(join(repo, opts.touch)) : "",
    };
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SANDBOX;
    for (const key of ["CODEX_EXEC_MODEL", "CODEX_REVIEW_MODEL", "CODEX_ASK_MODEL"]) {
      delete env[key];
    }
    const proc = Bun.spawn([process.execPath, RUN, ...args], {
      cwd: repo,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const argv = (await readFile(argvFile, "utf8").catch(() => "")).split("\n").filter(Boolean);
    const schema = await readFile(schemaCopy, "utf8").catch(() => "");
    return { stdout, stderr, code, argv, schema };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const result = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  branch: "main",
  commit: "",
  files_changed: ["b.ts"],
  verify_cmd: "bun test",
  verify_result: { passed: true, output_tail: "1 pass" },
  blockers: [],
  ...over,
});

describe("codex-run.ts exec worker result", () => {
  test("exec passes the schema and last-message flags before the prompt", async () => {
    const run = await runCodexRun(["exec", "add b.ts"], { result: result(), touch: "b.ts" });
    expect(run.code, run.stderr).toBe(0);
    const schemaAt = run.argv.indexOf("--output-schema");
    const outAt = run.argv.indexOf("--output-last-message");
    expect(schemaAt).toBeGreaterThan(0);
    expect(outAt).toBeGreaterThan(0);
    expect(Math.max(schemaAt, outAt)).toBeLessThan(run.argv.indexOf("--"));
    const schema = JSON.parse(run.schema);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("verify_result");
  });

  test("ask and review do not request a structured result", async () => {
    for (const args of [["ask", "q"], ["review"]]) {
      const run = await runCodexRun(args);
      expect(run.code, run.stderr).toBe(0);
      expect(run.argv).not.toContain("--output-schema");
      expect(run.argv).not.toContain("--output-last-message");
    }
  });

  test("a matching claim with the file in the tree is ready", async () => {
    const run = await runCodexRun(["exec", "add b.ts"], { result: result(), touch: "b.ts" });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("── worker result");
    expect(run.stdout).toContain("ready: yes");
    expect(run.stdout).toContain("verify: bun test → passed");
  });

  test("a completed claim with a clean tree and no commit is not ready", async () => {
    const run = await runCodexRun(["exec", "add b.ts"], { result: result() });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("ready: no");
    expect(run.stdout).toContain("not ready: no commit and no uncommitted changes");
  });

  test("a prose final message is reported as unstructured without crashing", async () => {
    const run = await runCodexRun(["exec", "add b.ts"], {
      result: "Done, I changed b.ts.",
      touch: "b.ts",
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("ready: no (unstructured: final message is not JSON)");
  });

  test("a missing final message file is reported as unstructured", async () => {
    const run = await runCodexRun(["exec", "add b.ts"], { touch: "b.ts" });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("ready: no (unstructured: no final message)");
  });

  test("ask rejects --expected", async () => {
    const run = await runCodexRun(["ask", "--expected", "2", "q"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--expected applies to exec only");
  });
});
