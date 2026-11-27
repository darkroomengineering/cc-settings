// git-cow (github.com/gabrielkoerich/git-cow) creates git worktrees as
// copy-on-write clones of a spare checkout, so node_modules and build output
// come along. Detection here decides both whether setup wires the
// WorktreeCreate/WorktreeRemove hooks and whether it offers the install.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { info, progressOk, warn } from "./colors.ts";
import type { Profile } from "./light-profile.ts";
import { CLAUDE_DIR, isWindows } from "./platform.ts";
import { isInteractive, promptYn } from "./prompts.ts";

export const GIT_COW_VERSION = "0.6.0";
export const GIT_COW_INSTALL = [
  "cargo",
  "install",
  "git-cow",
  "--version",
  GIT_COW_VERSION,
  "--locked",
] as const;
const INSTALL_LINE = GIT_COW_INSTALL.join(" ");
const DECLINED_FILE = join(CLAUDE_DIR, ".git-cow-declined");
const QUESTION = "Install git-cow so agent worktrees start with dependencies already in place?";

/** Absolute path of a binary on `path` or in `~/.cargo/bin`, which cargo
 *  installs to and which a hook's PATH often lacks. */
function findCargoBin(
  name: string,
  path: string = process.env.PATH ?? "",
  home: string = homedir(),
): string | null {
  return Bun.which(name, { PATH: path }) ?? Bun.which(join(home, ".cargo", "bin", name));
}

export function findGitCow(path?: string, home?: string): string | null {
  return findCargoBin("git-cow", path, home);
}

/** True when setup should wire the worktree hooks: git-cow is installed and
 *  the platform can clone (git-cow has no Windows clone path). */
export function gitCowUsable(path?: string, home?: string): boolean {
  return !isWindows() && findGitCow(path, home) !== null;
}

function offerSilenced(fresh: boolean): boolean {
  return process.env.CC_GIT_COW === "0" || (!fresh && existsSync(DECLINED_FILE));
}

function offerApplies(profile: Profile): boolean {
  return profile === "full" && process.env.CC_SKIP_DEPS !== "1";
}

/** Ask the install question before the install starts, like the other setup
 *  questions. Returns the answer, or undefined when no question applies. */
export async function askGitCowUpfront(
  profile: Profile,
  fresh: boolean,
): Promise<boolean | undefined> {
  if (!offerApplies(profile) || isWindows() || offerSilenced(fresh)) return undefined;
  if (findGitCow() !== null || !isInteractive() || findCargoBin("cargo") === null) return undefined;
  return promptYn(QUESTION, false);
}

/** Dependencies-phase half of the offer: install on a yes, remember a no, and
 *  print a one-line hint otherwise. Never fails the install. */
export async function installGitCow(
  profile: Profile,
  answer: boolean | undefined,
  fresh: boolean,
): Promise<void> {
  if (!offerApplies(profile) || process.env.CC_GIT_COW === "0") return;
  if (isWindows()) {
    info("git-cow can't clone on Windows, so agent worktrees stay native.");
    return;
  }
  if (findGitCow() !== null) return;
  if (answer === false) {
    // A first install reaches this phase before ~/.claude exists.
    await mkdir(CLAUDE_DIR, { recursive: true })
      .then(() => writeFile(DECLINED_FILE, `${new Date().toISOString()}\n`))
      .catch(() => {});
    info(`Skipped git-cow. Setup won't ask again; remove ${DECLINED_FILE} to be asked.`);
    return;
  }
  if (offerSilenced(fresh)) return;
  const cargo = findCargoBin("cargo");
  if (answer !== true || cargo === null) {
    info(`Optional: \`${INSTALL_LINE}\` makes agent worktrees start with dependencies in place.`);
    return;
  }
  try {
    const proc = Bun.spawn([cargo, ...GIT_COW_INSTALL.slice(1)], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exit = await proc.exited;
    if (exit === 0 && findGitCow() !== null) progressOk(`git-cow ${GIT_COW_VERSION} installed`);
    else warn(`git-cow install failed (exit ${exit}); run \`${INSTALL_LINE}\` to retry`);
  } catch (e) {
    warn(`git-cow install failed: ${(e as Error).message}`);
  }
}
