import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Bump when the build's output changes without a change to its inputs. */
const CACHE_VERSION = 1;

/** The entries of this package that the Studio's bundle imports. */
const ENTRIES = ["define-studio.ts", "studio-cli.ts", "studio-schema.ts"];

/**
 * The entries and every file of this package they import, so a release that
 * changes any of them builds the Studio again: a list by hand missed
 * `languages.ts` and `asset.ts`.
 */
export function ownFiles(): string[] {
  const found = new Set(
    ENTRIES.map((name) => fileURLToPath(new URL(name, import.meta.url)))
  );

  for (const file of found) {
    const code = readFileSync(file, "utf-8");

    for (const match of code.matchAll(/from "(?<relative>\.\/[^"]+)"/gv)) {
      const relative = match.groups?.relative;

      if (relative) {
        found.add(path.resolve(path.dirname(file), relative));
      }
    }
  }

  return [...found].toSorted();
}

/** At the top of `studio/`: the CLI's own output and caches, not inputs of `sanity build`. */
const SKIP = new Set(["node_modules", "dist", ".sanity", "schema.json"]);

function files(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .filter((name) => dir !== base || !SKIP.has(name))
    .flatMap((name) => {
      const file = path.join(dir, name);
      // Follows a symlink, so an edit to a linked schema file rebuilds too.
      const stat = statSync(file, { throwIfNoEntry: false });

      if (stat?.isDirectory()) {
        return files(file, base);
      }

      return stat?.isFile() ? [path.relative(base, file)] : [];
    });
}

function lockfile(dir: string): string | undefined {
  for (let at = dir; ; at = path.dirname(at)) {
    const file = path.join(at, "bun.lock");

    if (existsSync(file)) {
      return file;
    }

    if (path.dirname(at) === at) {
      return undefined;
    }
  }
}

/** `undefined` without a lockfile, where a dependency could change unseen. */
export function studioKey(
  studioDir: string,
  env: Record<string, string | undefined>
) {
  const lock = lockfile(studioDir);

  if (!lock) {
    return;
  }

  const hash = createHash("sha256").update(`${CACHE_VERSION}\0`);

  for (const file of files(studioDir).toSorted()) {
    hash.update(`${file}\0`).update(readFileSync(path.join(studioDir, file)));
  }

  for (const file of ownFiles()) {
    hash.update(`\0${path.basename(file)}\0`).update(readFileSync(file));
  }

  hash.update(readFileSync(lock));

  for (const name of Object.keys(env).toSorted()) {
    if (name.startsWith("SANITY_STUDIO_")) {
      hash.update(`\0${name}=${env[name] ?? ""}`);
    }
  }

  return hash.digest("hex").slice(0, 16);
}

export function cachedStudio(
  cacheDir: string,
  key: string
): string | undefined {
  const dir = path.join(cacheDir, key);

  return existsSync(path.join(dir, "index.html")) ? dir : undefined;
}

export function keepStudio(cacheDir: string, key: string, out: string) {
  mkdirSync(cacheDir, { recursive: true });
  const tmp = path.join(cacheDir, `${key}.${process.pid}.tmp`);
  cpSync(out, tmp, { recursive: true });
  rmSync(path.join(cacheDir, key), { recursive: true, force: true });
  renameSync(tmp, path.join(cacheDir, key));

  for (const entry of readdirSync(cacheDir)) {
    if (entry !== key) {
      rmSync(path.join(cacheDir, entry), { recursive: true, force: true });
    }
  }
}
