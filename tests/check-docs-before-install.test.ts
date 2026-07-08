// Regression for M17: the INSTALL regex must actually match the short forms
// (`bun i`, `npm i`) it explicitly documents covering, not just the long
// forms (`bun add`, `npm install`).

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "check-docs-before-install.ts");

async function run(command: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", SCRIPT], {
    env: { ...process.env, TOOL_INPUT_command: command },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

describe("check-docs-before-install", () => {
  test("short forms (single space, the real-world shape) fire the reminder", async () => {
    expect((await run("bun i react")).stdout).toContain("Installing 'react'");
    expect((await run("npm i lodash")).stdout).toContain("Installing 'lodash'");
  });

  test("long forms still fire the reminder", async () => {
    expect((await run("bun add react")).stdout).toContain("Installing 'react'");
    expect((await run("npm install lodash")).stdout).toContain("Installing 'lodash'");
    expect((await run("pnpm add zod")).stdout).toContain("Installing 'zod'");
    expect((await run("npx add cowsay")).stdout).toContain("Installing 'cowsay'");
  });

  test("non-install commands never fire, and the hook always exits 0", async () => {
    const { stdout, exit } = await run("git status");
    expect(stdout).toBe("");
    expect(exit).toBe(0);
  });

  test("first arg starting with a flag is not reported as a package name", async () => {
    const { stdout } = await run("bun i --save-dev react");
    expect(stdout).not.toContain("Installing");
  });
});
