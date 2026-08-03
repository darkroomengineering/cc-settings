// Regression for M17: the INSTALL regex must actually match the short forms
// (`bun i`, `npm i`) it explicitly documents covering, not just the long
// forms (`bun add`, `npm install`).
//
// The reminder is emitted via the hookSpecificOutput.additionalContext
// envelope (plain stdout never reaches the model on PreToolUse — see
// docs/hooks-reference.md "Sync vs Async Behavior"), so assertions parse the
// envelope JSON rather than matching raw stdout text.

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

function parseEnvelope(stdout: string): { hookEventName: string; additionalContext: string } {
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  return parsed.hookSpecificOutput;
}

describe("check-docs-before-install", () => {
  test("short forms (single space, the real-world shape) fire the reminder via the envelope", async () => {
    const react = await run("bun i react");
    const reactEnvelope = parseEnvelope(react.stdout);
    expect(reactEnvelope.hookEventName).toBe("PreToolUse");
    expect(reactEnvelope.additionalContext).toContain("Installing 'react'");

    const lodash = await run("npm i lodash");
    expect(parseEnvelope(lodash.stdout).additionalContext).toContain("Installing 'lodash'");
  });

  test("long forms still fire the reminder via the envelope", async () => {
    expect(parseEnvelope((await run("bun add react")).stdout).additionalContext).toContain(
      "Installing 'react'",
    );
    expect(parseEnvelope((await run("npm install lodash")).stdout).additionalContext).toContain(
      "Installing 'lodash'",
    );
    expect(parseEnvelope((await run("pnpm add zod")).stdout).additionalContext).toContain(
      "Installing 'zod'",
    );
    expect(parseEnvelope((await run("npx add cowsay")).stdout).additionalContext).toContain(
      "Installing 'cowsay'",
    );
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
