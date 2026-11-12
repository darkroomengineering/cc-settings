import { existsSync } from "node:fs";
import path from "node:path";

import type { Context } from "./types.ts";

const CONFIGS = ["oxlint.config.ts", ".oxlintrc.json"];
const roots = new Map<string, string | null>();

// The directory of the nearest oxlint config above `dir`, so a glob means the
// same as in the config's `files`, whatever directory oxlint runs in.
function configRoot(dir: string): string | null {
  const known = roots.get(dir);

  if (known !== undefined) {
    return known;
  }

  const root = findConfigRoot(dir);
  roots.set(dir, root);

  return root;
}

function findConfigRoot(dir: string): string | null {
  if (CONFIGS.some((name) => existsSync(path.join(dir, name)))) {
    return dir;
  }

  const parent = path.dirname(dir);

  return parent === dir ? null : configRoot(parent);
}

export function projectPath(context: Context): string {
  const file = path.isAbsolute(context.filename)
    ? context.filename
    : path.join(context.cwd, context.filename);

  const root = configRoot(path.dirname(file)) ?? context.cwd;

  return path.relative(root, file).split(path.sep).join("/");
}

const compiled = new Map<string, RegExp>();

/**
 * Matches `file` against a glob in the syntax of oxlint's `files`: `**` for
 * any number of directories, `*` and `?` inside one segment, `{a,b}` for
 * alternatives.
 */
export function matchesGlob(file: string, glob: string): boolean {
  let pattern = compiled.get(glob);

  if (!pattern) {
    pattern = new RegExp(`^${globSource(glob)}$`, "u");
    compiled.set(glob, pattern);
  }

  return pattern.test(file);
}

function globSource(glob: string): string {
  let source = "";
  let depth = 0;

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob.charAt(i);

    if (char === "*" && glob[i + 1] === "*") {
      // `**/` also matches no directory at all; a trailing `**` matches the rest.
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      source += "(?:";
      depth += 1;
    } else if (char === "}" && depth > 0) {
      source += ")";
      depth -= 1;
    } else if (char === "," && depth > 0) {
      source += "|";
    } else {
      source += char.replaceAll(/[.+^$()|[\]\\{}]/gu, "\\$&");
    }
  }

  return source;
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(file, glob));
}
