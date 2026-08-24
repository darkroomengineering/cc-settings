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

/** Git Bash accepts forward-slash Windows paths in both argv and shell variables. */
export function gitBashPath(path: string): string {
  return path.replaceAll("\\", "/");
}
