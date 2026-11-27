// rsrc (github.com/SamuelZ12/research-sources) reads X, Reddit, Hacker News,
// YouTube, LinkedIn and App Store pages for agents; the research-sources skill
// drives it. Setup offers a uv install pinned to a reviewed commit.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { info, progressOk, warn } from "./colors.ts";
import type { Profile } from "./light-profile.ts";
import { CLAUDE_DIR, isWindows } from "./platform.ts";
import { isInteractive, promptYn } from "./prompts.ts";

// The upstream commit a security review approved. Bumping it needs a fresh
// security review of the new commit. skills/research-sources/ and
// docs/install.md repeat it; tests/rsrc.test.ts fails when they disagree.
export const RSRC_COMMIT = "e8d2b62820f7ce3b137705cf0ac1f47b52b02395";
export const RSRC_INSTALL = [
  "uv",
  "tool",
  "install",
  `git+https://github.com/SamuelZ12/research-sources@${RSRC_COMMIT}`,
] as const;
const INSTALL_LINE = RSRC_INSTALL.join(" ");
const DECLINED_FILE = join(CLAUDE_DIR, ".rsrc-declined");
const QUESTION =
  "Install rsrc so agents can read X, Reddit, Hacker News, YouTube, LinkedIn and App Store pages?";

/** Where `uv tool install` puts executables, which a hook's PATH often lacks. */
function uvToolBinDir(home: string): string {
  return process.env.UV_TOOL_BIN_DIR || join(home, ".local", "bin");
}

// SHORTCUT: any installed rsrc counts as current, so setup never reinstalls it.
// ceiling: a machine stays on the commit it first installed after RSRC_COMMIT moves.
// upgrade: when RSRC_COMMIT moves, read the installed commit from
// `uv tool list --show-version-specifiers` or uv's receipt and offer the reinstall.
export function findRsrc(
  path: string = process.env.PATH ?? "",
  home: string = homedir(),
): string | null {
  return Bun.which("rsrc", { PATH: path }) ?? Bun.which(join(uvToolBinDir(home), "rsrc"));
}

/** uv on PATH, or in ~/.local/bin where its standalone installer puts it. */
function findUv(path: string = process.env.PATH ?? "", home: string = homedir()): string | null {
  return Bun.which("uv", { PATH: path }) ?? Bun.which(join(home, ".local", "bin", "uv"));
}

function offerSilenced(fresh: boolean): boolean {
  return process.env.CC_RSRC === "0" || (!fresh && existsSync(DECLINED_FILE));
}

function offerApplies(profile: Profile): boolean {
  return profile === "full" && process.env.CC_SKIP_DEPS !== "1";
}

/** Ask the install question before the install starts, like the other setup
 *  questions. Returns the answer, or undefined when no question applies. */
export async function askRsrcUpfront(
  profile: Profile,
  fresh: boolean,
): Promise<boolean | undefined> {
  if (!offerApplies(profile) || isWindows() || offerSilenced(fresh)) return undefined;
  if (findRsrc() !== null || !isInteractive() || findUv() === null) return undefined;
  return promptYn(QUESTION, false);
}

/** Dependencies-phase half of the offer: install on a yes, remember a no, and
 *  print a one-line hint otherwise. Never fails the install. */
export async function installRsrc(
  profile: Profile,
  answer: boolean | undefined,
  fresh: boolean,
): Promise<void> {
  if (!offerApplies(profile) || process.env.CC_RSRC === "0") return;
  if (isWindows()) {
    // Upstream tests rsrc on macOS only, so setup offers it on macOS and Linux.
    info(`rsrc is offered on macOS and Linux only; \`${INSTALL_LINE}\` installs it untested here.`);
    return;
  }
  if (findRsrc() !== null) return;
  if (answer === false) {
    // A first install reaches this phase before ~/.claude exists.
    await mkdir(CLAUDE_DIR, { recursive: true })
      .then(() => writeFile(DECLINED_FILE, `${new Date().toISOString()}\n`))
      .catch(() => {});
    info(`Skipped rsrc. Setup won't ask again; remove ${DECLINED_FILE} to be asked.`);
    return;
  }
  if (offerSilenced(fresh)) return;
  const uv = findUv();
  if (answer !== true || uv === null) {
    info(
      `Optional: \`${INSTALL_LINE}\` lets agents read X, Reddit, Hacker News, YouTube, LinkedIn and App Store pages.`,
    );
    return;
  }
  try {
    const proc = Bun.spawn([uv, ...RSRC_INSTALL.slice(1)], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exit = await proc.exited;
    if (exit !== 0) warn(`rsrc install failed (exit ${exit}); run \`${INSTALL_LINE}\` to retry`);
    else if (findRsrc() === null)
      warn("uv installed rsrc outside PATH and ~/.local/bin; add uv's tool bin directory to PATH.");
    else progressOk(`rsrc installed at ${RSRC_COMMIT.slice(0, 7)}`);
  } catch (e) {
    warn(`rsrc install failed: ${(e as Error).message}`);
  }
}
