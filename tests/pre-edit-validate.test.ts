// Behavioral tests for pre-edit-validate.ts's core decision paths (allow /
// block / advisory-warn) — see M25 in docs/audits/codebase-audit-2026-07-08.md.
// The blanket fail-open smoke test (hook-fail-open.test.ts) only feeds
// garbage input; these exercise the real branches: missing file, exact-match
// found/not-found, >15-line old_string, and >1 occurrence.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "pre-edit-validate.ts");

async function runHook(
  toolInput: Record<string, unknown>,
): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    env: {
      ...process.env,
      TOOL_INPUT: JSON.stringify(toolInput),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

describe("pre-edit-validate — core decision paths", () => {
  test("allow: no file_path in tool_input → silent exit 0", async () => {
    const r = await runHook({});
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("block: target file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const missing = join(dir, "does-not-exist.ts");
      const r = await runHook({ file_path: missing, old_string: "whatever" });
      expect(r.exit).toBe(2);
      const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("File does not exist");
      expect(parsed.reason).toContain("Use Write tool to create new files");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allow: file exists, no old_string given → exit 0, silent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      await writeFile(file, "const x = 1;\n");
      const r = await runHook({ file_path: file });
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allow: old_string is an exact, unique match → exit 0, no advisory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      await writeFile(file, "function greet() {\n  return 'hello';\n}\n");
      const r = await runHook({ file_path: file, old_string: "return 'hello';" });
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("block: old_string not found at all (file changed since read)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      await writeFile(file, "const y = 2;\n");
      const r = await runHook({ file_path: file, old_string: "const z = 3;" });
      expect(r.exit).toBe(2);
      const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("old_string not found in a.ts");
      expect(parsed.reason).toContain("File may have changed since last read");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("block: old_string not an exact match but first line exists (whitespace mismatch diagnosis)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      await writeFile(file, "function f() {\n    return 1;\n}\n");
      // Same first line, but the second line's indentation doesn't match —
      // content.includes(oldString) is false, content.includes(firstLine) is true.
      const r = await runHook({
        file_path: file,
        old_string: "function f() {\n  return 1;\n}",
      });
      expect(r.exit).toBe(2);
      const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
      expect(parsed.reason).toContain("not found as exact match");
      expect(parsed.reason).toContain("First line exists");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("advisory: old_string over 15 lines warns but still allows (exit 0)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
      const body = lines.join("\n");
      await writeFile(file, `${body}\n`);
      // 20 lines → 19 newlines → lineCount 20 (> 15).
      const r = await runHook({ file_path: file, old_string: body });
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("Large edit target");
      expect(r.stdout).toContain("20 lines");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("advisory: ambiguous old_string (appears more than once) warns but still allows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-pev-"));
    try {
      const file = join(dir, "a.ts");
      await writeFile(file, "const dup = 1;\nconsole.log('x');\nconst dup = 1;\n");
      const r = await runHook({ file_path: file, old_string: "const dup = 1;" });
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain("appears 2 times");
      expect(r.stdout).toContain("Add more surrounding context");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
