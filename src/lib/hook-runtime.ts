// Shared runtime for cc-settings hooks. Three patterns the parallelmax hooks
// duplicate: stdin-JSON parsing with env fallback, ~/.claude/tmp/<name>.json
// state IO, top-level fail-open wrapper. Extracted in v11.1.1 — see CHANGELOG.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TMP_DIR = join(homedir(), ".claude", "tmp");

/** Read a stdin JSON payload; on parse failure, fall back to env. */
export async function readHookInput<T extends Record<string, unknown>>(
  envFallbacks?: Partial<Record<keyof T & string, string>>,
): Promise<Partial<T>> {
  const raw = await Bun.stdin.text();
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    if (!envFallbacks) return {};
    const out: Record<string, unknown> = {};
    for (const [k, envVar] of Object.entries(envFallbacks)) {
      if (envVar && process.env[envVar]) out[k] = process.env[envVar];
    }
    return out as Partial<T>;
  }
}

/** Read a JSON state file at ~/.claude/tmp/<name>.json. Returns fallback on any error. */
export async function readState<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(TMP_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Atomic-ish write to ~/.claude/tmp/<name>.json. Creates the dir if missing. */
export async function writeState(name: string, data: unknown): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(join(TMP_DIR, name), JSON.stringify(data));
}

/** Run a hook main() with the cc-settings fail-open convention. Catches and
 *  swallows any error so a hook never blocks a tool call. */
export async function runHook(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch {
    // Fail open — never break a tool call due to a hook error.
  }
}
