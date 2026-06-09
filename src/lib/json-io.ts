// Generic JSON + atomic-file I/O. Extracted from src/lib/mcp.ts (was
// responsibility #1 of that file) so non-MCP callers (setup.ts, settings-merge,
// hooks-fingerprint, scripts) no longer import file I/O from a domain module.
//
// All writes are atomic (tmp + rename in the same directory) so a crash never
// leaves a half-written target.

import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Raised when JSON is unparseable. Callers MUST treat this as a hard failure. */
export class JsonParseError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`${path} is not valid JSON. Fix it or restore a backup before re-running setup.`);
    this.name = "JsonParseError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Stage + rename in the same directory so crashes don't leave a half-written target. */
export async function atomicWriteString(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, `.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/** atomicWriteString helper that JSON-serializes (2-space indent, trailing newline). */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await atomicWriteString(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readJsonOrNull(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // EACCES, EISDIR, … — an I/O problem, not a JSON problem. Rethrow as-is
    // so callers don't misdiagnose a permissions error as a corrupt file.
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new JsonParseError(path, err);
  }
}
