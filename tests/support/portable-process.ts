import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, extname, join } from "node:path";

/**
 * Put a fixture command directory first without assuming POSIX's `:` PATH delimiter.
 * On Windows, Bun resolves commands through PATHEXT, so extensionless shell fixtures
 * also need a small `.cmd` entry point that hands the implementation to Git Bash.
 */
export function prependTestPath(bin: string, current = process.env.PATH ?? ""): string {
  if (process.platform === "win32") {
    for (const name of readdirSync(bin)) {
      const implementation = join(bin, name);
      if (extname(name) || !statSync(implementation).isFile()) continue;
      writeFileSync(
        `${implementation}.cmd`,
        `@echo off\r\nbash "%~dp0${basename(implementation)}" %*\r\n`,
      );
    }
  }
  return `${bin}${delimiter}${current}`;
}

/**
 * The host environment without its PATH, for a child whose PATH the test sets.
 * Windows names the variable `Path`; spreading `process.env` and then adding
 * `PATH` hands the child both, and it may resolve commands from the inherited one.
 */
export function envWithoutPath(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"),
  );
}

/** Git Bash accepts forward-slash Windows paths in both argv and shell variables. */
export function gitBashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Encode a shell fixture as an explicit Bash command for test-only process seams. */
export function shellFixtureCommand(script: string): string {
  const bash = Bun.which("bash");
  if (!bash) throw new Error("Test shell fixture requires bash");
  return JSON.stringify([bash, script]);
}
