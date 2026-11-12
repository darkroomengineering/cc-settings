import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { SUBSET_SETTINGS } from "./harfbuzz-subset.ts";

// harfbuzzjs does not export its package.json, so walk up from the main
// entry to it.
export function versionOf(pkg: string, main?: string): string {
  try {
    let dir = path.dirname(main ?? createRequire(import.meta.url).resolve(pkg));

    for (;;) {
      const json = path.join(dir, "package.json");

      if (existsSync(json)) {
        // SAFETY: an installed package.json has a version; the name is checked below.
        const { name, version } = JSON.parse(readFileSync(json, "utf-8")) as {
          name?: string;
          version: string;
        };

        if (name === pkg) {
          return version;
        }
      }

      if (path.dirname(dir) === dir) {
        return "unknown";
      }

      dir = path.dirname(dir);
    }
  } catch {
    return "unknown";
  }
}

// Raised when entries an older version wrote can be wrong.
const CACHE_VERSION = "2";

export function cacheKey(
  sourceBytes: Uint8Array,
  unicodeRange: string,
  axes: Record<string, number> = {}
): string {
  const pinned = Object.keys(axes)
    .toSorted()
    .map((k) => `${k}=${axes[k]}`)
    .join(",");

  return createHash("sha256")
    .update(CACHE_VERSION)
    .update(sourceBytes)
    .update(unicodeRange)
    .update(pinned)
    .update(SUBSET_SETTINGS)
    .update(versionOf("harfbuzzjs"))
    .update(versionOf("wawoff2"))
    .digest("hex");
}

/** A whole WOFF2 file: the 'wOF2' signature, and the length the header gives. */
function isWoff2(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return (
    view.getUint32(0) === 0x77_4f_46_32 && view.getUint32(8) === bytes.length
  );
}

export function readCache(dir: string, key: string): Uint8Array | null {
  let bytes: Uint8Array;

  try {
    bytes = new Uint8Array(readFileSync(path.join(dir, `${key}.woff2`)));
  } catch {
    return null;
  }

  return isWoff2(bytes) ? bytes : null;
}

export function writeCache(dir: string, key: string, bytes: Uint8Array) {
  mkdirSync(dir, { recursive: true });
  // Written aside and renamed, so a killed build never leaves half a file.
  const file = path.join(dir, `${key}.woff2`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}
