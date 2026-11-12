// Shared by the repo-local git hooks: finds the `git <sub>` commands in a shell
// command and the checkout each one runs in, so a hook that guards cc-settings
// leaves commits and pushes to other repositories alone.

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseShellCommand,
  type ShellSegment,
  SUBSTITUTION,
  scanShell,
  splitPipes,
} from "../../src/lib/hook-command.ts";

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
  const { segments, scopeParents } = scanShell(cmd);
  // A subshell starts in its parent's directory and its `cd` never leaks out.
  const dirs = new Map<number, string | null>([[0, cwd]]);
  const dirOf = (scope: number): string | null => {
    if (!dirs.has(scope)) dirs.set(scope, dirOf(scopeParents[scope] ?? 0));
    return dirs.get(scope) ?? null;
  };
  let prevJoiner: ShellSegment["joiner"] = null;
  for (const seg of segments) {
    const stages = splitPipes(seg.clean);
    // A pipeline stage or background job runs in a subshell of its own; which
    // directory later commands see is left to the running shell.
    const isolated = stages.length > 1 || seg.joiner === "|" || seg.joiner === "&" || prevJoiner === "|";
    prevJoiner = seg.joiner;
    for (const stage of stages) {
      const { word, args } = parseShellCommand(stage);
      if (word === "cd" || word === "pushd" || word === "popd") {
        const arg = args.find((a) => !a.startsWith("-") || a === "-");
        const from = dirOf(seg.scope);
        let next: string | null;
        if (isolated || word === "popd" || arg === "-") next = null;
        else if (arg === undefined) next = word === "cd" ? (process.env.HOME ?? null) : null;
        else next = from === null ? null : shellPath(arg, from);
        dirs.set(seg.scope, next);
        continue;
      }
      if (word !== "git") continue;
      let at: string | null = dirOf(seg.scope);
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as string;
        if (a === "-C" || (a.startsWith("-C") && a.length > 2)) {
          const value = a === "-C" ? args[++i] : a.slice(2);
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
  if (wrapped(cmd, sub)) targets.push(null);
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
