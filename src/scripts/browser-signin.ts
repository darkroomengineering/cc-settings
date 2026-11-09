#!/usr/bin/env bun
// Opens the browser agent's Chrome profile in a normal window so the user can
// sign in to a site by hand. The agent's Chrome then starts signed in.
//   bun ~/.claude/src/scripts/browser-signin.ts <url>
//
// Never automates input. Refuses while another Chrome holds the profile,
// because two Chrome instances cannot share one user-data-dir.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE = "usage: bun ~/.claude/src/scripts/browser-signin.ts <http(s) url>";

/** chrome-devtools-mcp@1.11.0's default profile (BrowserManager.js #launch). */
export function profileDir(home: string = homedir()): string {
  return join(home, ".cache", "chrome-devtools-mcp", "chrome-profile");
}

export type ParsedArgs = { ok: true; url: string } | { ok: false; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length !== 1) return { ok: false, message: USAGE };
  const [raw = ""] = argv;
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return { ok: false, message: `not a URL: ${raw}\n${USAGE}` };
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, message: `only http and https URLs open here, got ${protocol}\n${USAGE}` };
  }
  return { ok: true, url: new URL(raw).href };
}

export type LockState =
  | { state: "free" }
  | { state: "stale"; pid: number }
  | { state: "in-use"; detail: string };

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Is a Chrome instance holding `dir`? POSIX Chrome keeps a `SingletonLock`
 *  symlink whose target is `<hostname>-<pid>`; Windows Chrome keeps `lockfile`. */
export function profileLock(
  dir: string,
  platform: NodeJS.Platform = process.platform,
  isAlive: (pid: number) => boolean = pidAlive,
): LockState {
  if (platform === "win32") {
    return existsSync(join(dir, "lockfile"))
      ? {
          state: "in-use",
          detail: `${join(dir, "lockfile")} exists (it may be stale if no Chrome is running; close every Chrome window on this profile, then retry)`,
        }
      : { state: "free" };
  }
  let target: string;
  try {
    target = readlinkSync(join(dir, "SingletonLock"));
  } catch (error) {
    // Only a missing lock means free; EINVAL (a regular file) or EACCES is unknown, so refuse.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "free" };
    return {
      state: "in-use",
      detail: `cannot read ${join(dir, "SingletonLock")}: ${String(error)}`,
    };
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid) || pid <= 0) {
    return { state: "in-use", detail: `unreadable SingletonLock target ${target}` };
  }
  return isAlive(pid)
    ? { state: "in-use", detail: `Chrome pid ${pid} holds it` }
    : { state: "stale", pid };
}

const WINDOWS_CHROME = "Google\\Chrome\\Application\\chrome.exe";

export function chromePath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  which: (bin: string) => string | null = Bun.which,
): string | undefined {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  if (platform === "darwin") {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return exists(mac) ? mac : undefined;
  }
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
      if (!base) continue;
      const candidate = `${base}\\${WINDOWS_CHROME}`;
      if (exists(candidate)) return candidate;
    }
    return undefined;
  }
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium"]) {
    const found = which(bin);
    if (found) return found;
  }
  return undefined;
}

/** The keychain and password-store flags must match Puppeteer's defaults
 *  (`chromeArguments` in chrome-devtools-mcp@1.11.0 build/src/third_party/index.js:78425),
 *  or cookies saved here are encrypted with a key the agent's Chrome cannot
 *  read. --disable-sync is also a Puppeteer default; it keeps the user's synced
 *  passwords and extensions out of the agent's profile. */
export function chromeArgs(profile: string, url: string): string[] {
  return [
    `--user-data-dir=${profile}`,
    "--use-mock-keychain",
    "--password-store=basic",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.message);
    return 2;
  }
  const profile = profileDir();
  mkdirSync(profile, { recursive: true });

  const lock = profileLock(profile);
  if (lock.state === "in-use") {
    console.error(
      `The browser profile is in use: ${lock.detail}.\n` +
        "A browser agent run or another sign-in window holds it. Wait for it to finish or close that window, then retry.",
    );
    return 1;
  }

  const chrome = chromePath();
  if (!chrome) {
    console.error("Google Chrome not found. Install it, or set CHROME_PATH to its executable.");
    return 1;
  }

  const child = spawn(chrome, chromeArgs(profile, parsed.url), {
    detached: true,
    stdio: "ignore",
  });
  try {
    await once(child, "spawn");
  } catch (error) {
    console.error(`Could not start Chrome at ${chrome}: ${String(error)}`);
    return 1;
  }
  child.unref();

  console.log(
    [
      `Opened ${parsed.url} in the browser agent's Chrome profile (${profile}).`,
      "Sign in in the window that opened, then close the window.",
      "The browser agent can't start while that window is open.",
      "This needs you at this machine; it won't work over Remote Control.",
    ].join("\n"),
  );
  return 0;
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
