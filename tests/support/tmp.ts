import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway directory under the OS tmpdir, named `<prefix>-XXXXXX` so a
 *  leaked run is easy to spot with `ls $TMPDIR`. */
export async function sandbox(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** Recursively removes one or more sandbox directories; missing ones are a no-op. */
export async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}
