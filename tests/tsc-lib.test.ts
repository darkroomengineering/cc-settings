import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTsc, scrubProjectSubprocessEnv } from "../src/lib/tsc.ts";

/** A throwaway project with one deliberately broken file. */
function brokenProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-tsclib-"));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }),
  );
  writeFileSync(join(dir, "a.ts"), 'export const x: number = "nope";\n');
  return dir;
}

describe("runTsc", () => {
  test("reports type errors and exits non-zero", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir });
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toContain("TS2322");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  // Regression: `--pretty` colourises even when piped, splitting the header as
  // `error<ESC>[0m<ESC>[90m TS2322`. The cache-retry matcher expects
  // `error TS####`, so without stripping ANSI it can never fire on the
  // pre-commit path — an unusable cache would block the commit instead of
  // falling back to a cold run.
  test("pretty output still carries a matchable diagnostic once ANSI is stripped", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir, pretty: true });
      expect(r.exitCode).not.toBe(0);
      // Raw pretty output does NOT contain the adjacent form the matcher wants.
      expect(/error TS\d+/.test(r.combined)).toBe(false);
      // Stripped, it does — this is what the retry check operates on.
      const stripped = Bun.stripANSI(r.combined);
      expect(/error TS\d+/.test(stripped)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  test("incremental:false still reports the same errors", async () => {
    const dir = brokenProject();
    try {
      const r = await runTsc({ cwd: dir, incremental: false });
      expect(r.exitCode).not.toBe(0);
      expect(r.combined).toContain("TS2322");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  // The project's own compiler is project-controlled code: it must not see the
  // hook payload (tool input, session ids, cc-settings paths) in its environment.
  test("the project's compiler receives no hook payload variables", async () => {
    const dir = brokenProject();
    const observed = join(dir, "observed.json");
    const payload = ["TOOL_INPUT", "SESSION_ID", "CLAUDE_CODE_SESSION_ID", "CC_SETTINGS_SOURCE"];
    const saved = Object.fromEntries(payload.map((n) => [n, process.env[n]]));
    try {
      mkdirSync(join(dir, "node_modules", "typescript", "bin"), { recursive: true });
      writeFileSync(
        join(dir, "node_modules", "typescript", "bin", "tsc"),
        `await Bun.write(process.env.OBSERVED_PATH, JSON.stringify(process.env));\nprocess.exit(1);\n`,
      );
      for (const n of payload) process.env[n] = "secret";
      process.env.OBSERVED_PATH = observed;
      await runTsc({ cwd: dir, incremental: false });
      const env = JSON.parse(readFileSync(observed, "utf8")) as Record<string, string>;
      for (const n of payload) expect(env[n], n).toBeUndefined();
      expect(env.OBSERVED_PATH).toBe(observed);
      // Windows reports the variable as `Path`.
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
      expect(pathKey && typeof env[pathKey]).toBe("string");
    } finally {
      for (const n of payload) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
      delete process.env.OBSERVED_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);

  // The cache must never turn a broken project into a silent pass: run twice
  // against the same cwd and assert the warm run still reports the error.
  test("warm cache does not produce a false clean", async () => {
    const dir = brokenProject();
    try {
      const cold = await runTsc({ cwd: dir });
      const warm = await runTsc({ cwd: dir });
      expect(cold.combined).toContain("TS2322");
      expect(warm.combined).toContain("TS2322");
      expect(warm.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 130_000);
});

describe("scrubProjectSubprocessEnv", () => {
  test("drops the hook payload variables a project subprocess must not see", () => {
    const names = [
      "TOOL_INPUT",
      "TOOL_INPUT_command",
      "PROMPT",
      "SESSION_ID",
      "OTHER_SESSION_ID",
      "TRANSCRIPT_PATH",
      "CLAUDE_TRANSCRIPT_PATH",
      "HOOK_INPUT",
      "HOOK_EVENT_NAME",
      "CLAUDE_HOOK_EVENT",
      "PLUGIN_ROOT",
      "PLUGIN_DATA",
      "CC_SETTINGS_HOME",
      "CC_SETTINGS_SOURCE",
    ];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) process.env[n] = "secret";
      process.env.SAFE_PROOF_ENV = "ordinary-value";
      const env = scrubProjectSubprocessEnv();
      for (const n of names) expect(env[n], n).toBeUndefined();
      expect(env.SAFE_PROOF_ENV).toBe("ordinary-value");
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
      delete process.env.SAFE_PROOF_ENV;
    }
  });
});
