// Shared by the repo-local git hooks: finds the `git <sub>` commands in a shell
// command and the checkout each one runs in, so a hook that guards cc-settings
// leaves commits and pushes to other repositories alone.

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseShellCommand, SUBSTITUTION, scanShell, splitPipes } from "../../src/lib/hook-command.ts";

const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

// A `git <sub>` wrapped in `bash -c '...'`, `eval`, or a substitution hides
// inside one word, so the parser cannot see it or where it runs.
function wrapped(cmd: string, sub: string): boolean {
  const s = String.raw`\b${sub}\b`;
  return new RegExp(
    String.raw`(?:\beval|\b(?:ba|z|da|k)?sh\s+(?:-\w+\s+)*-\w*c)\s+["'][^"']*\bgit\b[^"']*${s}|\$\([^)]*\bgit\b[^)]*${s}|` +
      "`[^`]*\\bgit\\b[^`]*" +
      s,
  ).test(cmd);
}

function shellPath(arg: string, base: string): string | null {
  if (arg.includes("$") || arg.includes("`") || arg.includes(SUBSTITUTION)) return null;
  const home = process.env.HOME;
  const expanded = arg.replace(/^~(?=\/|$)/, home ?? "~");
  if (expanded.startsWith("~")) return null;
  return resolve(base, expanded);
}

/**
 * The directory each `git <sub>` in `cmd` runs in, in source order: its `-C`
 * path, else the directory the preceding `cd` commands moved to, else `cwd`.
 * An entry is null when only a running shell could tell (`$VAR`, `cd -`,
 * `--git-dir`, a wrapped command). An empty list means `cmd` runs no `git <sub>`.
 */
export function gitTargets(cmd: string, sub: string, cwd: string): Array<string | null> {
  const targets: Array<string | null> = [];
  let dir: string | null = cwd;
  for (const seg of scanShell(cmd).segments) {
    for (const stage of splitPipes(seg.clean)) {
      const { word, args } = parseShellCommand(stage);
      if (word === "cd") {
        const arg = args.find((a) => !a.startsWith("-") || a === "-");
        if (arg === undefined) dir = process.env.HOME ?? null;
        else if (arg === "-") dir = null;
        else if (dir !== null) dir = shellPath(arg, dir);
        continue;
      }
      if (word !== "git") continue;
      let at: string | null = dir;
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as string;
        if (a === "-C") {
          const value = args[++i];
          at = value === undefined || at === null ? null : shellPath(value, at);
        } else if (GIT_VALUE_FLAGS.has(a)) {
          if (a === "--git-dir" || a === "--work-tree") at = null;
          i++;
        } else if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=")) at = null;
        else if (a.startsWith("-")) continue;
        else {
          if (a === sub) targets.push(at);
          break;
        }
      }
    }
  }
  if (targets.length === 0 && wrapped(cmd, sub)) targets.push(null);
  return targets;
}

export interface Checkout {
  top: string;
  commonDir: string;
}

export function checkout(dir: string): Checkout | null {
  if (!existsSync(dir)) return null;
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) return null;
  const [top, commonDir] = new TextDecoder().decode(proc.stdout).trim().split("\n");
  if (!top || !commonDir) return null;
  return { top: realpathSync(top), commonDir: realpathSync(commonDir) };
}

/**
 * The cc-settings checkout to run the gate in, or null when no target is
 * cc-settings. A target whose checkout cannot be resolved counts as
 * cc-settings, so an unreadable command keeps the gate on.
 */
export function gatedCheckout(targets: Array<string | null>, projectDir: string): string | null {
  const project = checkout(projectDir);
  for (const target of targets) {
    const found = target === null ? null : checkout(target);
    if (found === null || project === null) return projectDir;
    if (found.commonDir === project.commonDir) return found.top;
  }
  return null;
}
