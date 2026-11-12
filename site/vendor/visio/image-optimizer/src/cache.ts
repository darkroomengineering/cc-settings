import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { encoder } from "./encode.ts";

/** Full sha256 of the source. Hash it once per source and derive every key from it. */
export function sourceHash(sourceBytes: Uint8Array): string {
  return createHash("sha256").update(sourceBytes).digest("hex");
}

/** The first 8 hex digits of a `sourceHash()`, for file names. */
export function shortHash(digest: string): string {
  return digest.slice(0, 8);
}

/** Short content hash of the source, for stable file names. */
export function contentHash(sourceBytes: Uint8Array): string {
  return shortHash(sourceHash(sourceBytes));
}

/**
 * The version of this package's encode settings. Bump it when an output
 * changes without a change to the parameters in the key: metadata, the
 * placeholder, an encoder option.
 */
export const CACHE_VERSION = 2;

/**
 * Keyed by the source's hash (`sourceHash()`), the encode parameters, the
 * Bun version (its codecs) and `CACHE_VERSION`, so a Bun upgrade or a change
 * to the settings re-encodes.
 */
export function cacheKey(source: string, params: string): string {
  return createHash("sha256")
    .update(`${source}|${params}|${encoder()}|${CACHE_VERSION}`)
    .digest("hex");
}

export async function readCache(
  dir: string,
  key: string,
  ext: string
): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path.join(dir, `${key}.${ext}`)));
  } catch {
    return null;
  }
}

/**
 * Writes a temporary file and renames it, so an interrupted write never
 * leaves a truncated file under the key.
 */
export async function writeCache(
  dir: string,
  key: string,
  ext: string,
  bytes: Uint8Array
) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${key}.${ext}`);
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;

  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function pruneCache(dir: string, used: Set<string>) {
  const entries = await readdir(dir).catch((): string[] => []);
  await Promise.all(
    entries
      .filter((name) => !used.has(name) && !name.endsWith(".tmp"))
      .map((name) => rm(path.join(dir, name), { force: true }))
  );
}
