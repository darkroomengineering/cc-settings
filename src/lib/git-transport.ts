// Which way an agent can push to this repo's GitHub origin, decided from what
// the machine has: a loaded SSH key, a gh login, a 1Password agent. SessionStart
// prints the result as one `Git push:` line, so an agent follows it instead of
// trying SSH, failing, and trying again.
//
// Credentials are never read: `ssh-add -l` and `gh auth token` run with their
// output discarded and only the exit code kept. `gh auth status` is avoided
// because it calls the network. ~/.ssh/config is never opened.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runGit } from "./git.ts";

export interface TransportProbe {
  /** `ssh` is `git@github.com:o/r`, `ssh-url` is `ssh://git@github.com/o/r`, `none` is no GitHub origin. */
  origin: "ssh" | "ssh-url" | "https" | "none";
  /** `ssh-add -l` exit code 0 / 1 / 2. */
  sshKeys: "loaded" | "none" | "no-agent";
  onePassword: boolean;
  /** The 1Password agent socket answers `ssh-add -l` with a key (it is unlocked). */
  onePasswordUnlocked: boolean;
  ghLoggedIn: boolean;
  /** Commits are signed with 1Password's `op-ssh-sign`. */
  signing1P: boolean;
}

const PROBE_TIMEOUT_MS = 1500;

// The empty helper clears inherited ones (osxkeychain, a store file), so gh's token is the only credential.
const GH_CREDENTIAL = "-c credential.helper= -c credential.helper='!gh auth git-credential'";

const SSH_PREFIX = { ssh: "git@github.com:", "ssh-url": "ssh://git@github.com/" } as const;

function insteadOfPush(origin: "ssh" | "ssh-url"): string {
  return `git -c url."https://github.com/".insteadOf=${SSH_PREFIX[origin]} ${GH_CREDENTIAL} push origin HEAD`;
}

const GH_HTTPS_PUSH = `git ${GH_CREDENTIAL} push origin HEAD`;

/** The lines SessionStart prints for a probe. Pure. */
export function gitTransportLines(probe: TransportProbe): string[] {
  if (probe.origin === "none") return [];
  const lines: string[] = [];
  const { origin } = probe;

  if (origin !== "https" && probe.sshKeys === "loaded") {
    lines.push("Git push: SSH (an agent has a key loaded).");
  } else if (probe.ghLoggedIn) {
    if (origin === "https") {
      lines.push(`Git push: gh login (${GH_HTTPS_PUSH}).`);
    } else {
      const unlock = probe.onePassword ? " (or ask the user to unlock 1Password to use SSH)" : "";
      lines.push(
        `Git push: no SSH key is loaded, so every push in this session, inside or outside /ship, uses the gh login and never retries SSH; this command is the supported path, not an untested fallback: ${insteadOfPush(origin)}${unlock}`,
      );
    }
  } else {
    const how = probe.onePassword ? " or unlock 1Password" : " or load an SSH key with ssh-add";
    lines.push(
      `Git push: not logged in. Do not attempt a push; ask the user to run gh auth login${how}.`,
    );
  }

  if (probe.signing1P && !probe.onePasswordUnlocked) {
    lines.push(
      "Commits are signed through 1Password: ask the user to unlock it before committing.",
    );
  }
  return lines;
}

/** Exit code of `bin args` with output discarded; null when it cannot run or times out. */
async function exitCodeOf(
  bin: string,
  args: string[],
  env?: Record<string, string | undefined>,
): Promise<number | null> {
  try {
    const proc = Bun.spawn([bin, ...args], {
      env: env ?? process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      timeout: PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const code = await proc.exited;
    return proc.signalCode ? null : code;
  } catch {
    return null;
  }
}

function sshKeyState(code: number | null): TransportProbe["sshKeys"] {
  if (code === 0) return "loaded";
  return code === 1 ? "none" : "no-agent";
}

function originKind(url: string): TransportProbe["origin"] {
  if (/^git@github\.com:/i.test(url)) return "ssh";
  if (/^ssh:\/\/(?:[^@/]+@)?github\.com[/:]/i.test(url)) return "ssh-url";
  if (/^https?:\/\/(?:[^@/]+@)?github\.com\//i.test(url)) return "https";
  return "none";
}

const ONE_PASSWORD_SOCKET = join(
  homedir(),
  "Library",
  "Group Containers",
  "2BUA8C4S2C.com.1password",
  "t",
  "agent.sock",
);

/** Gathers the probe for the repo at `cwd` (default: the process cwd). Never throws. */
export async function probeGitTransport(cwd?: string): Promise<TransportProbe> {
  const probe: TransportProbe = {
    origin: "none",
    sshKeys: "no-agent",
    onePassword: false,
    onePasswordUnlocked: false,
    ghLoggedIn: false,
    signing1P: false,
  };
  try {
    probe.origin = originKind(await runGit(["remote", "get-url", "--push", "origin"], { cwd }));
    if (probe.origin === "none") return probe;

    probe.onePassword = process.platform === "darwin" && existsSync(ONE_PASSWORD_SOCKET);
    const gitConfig = (key: string, type?: string) =>
      runGit(["config", ...(type ? [`--type=${type}`] : []), "--get", key], { cwd });
    const [gh, gpgsign, format, program] = await Promise.all([
      exitCodeOf("gh", ["auth", "token"]),
      gitConfig("commit.gpgsign", "bool"),
      gitConfig("gpg.format"),
      gitConfig("gpg.ssh.program"),
    ]);
    probe.ghLoggedIn = gh === 0;
    // The 1Password probe is macOS-only, so off macOS an agent's state is unknown: say nothing.
    probe.signing1P =
      process.platform === "darwin" &&
      gpgsign === "true" &&
      format === "ssh" &&
      program.toLowerCase().includes("op-ssh-sign");

    const onePasswordEnv = { ...process.env, SSH_AUTH_SOCK: ONE_PASSWORD_SOCKET };
    const [agent, onePasswordAgent] = await Promise.all([
      process.env.SSH_AUTH_SOCK ? exitCodeOf("ssh-add", ["-l"]) : Promise.resolve(null),
      probe.onePassword ? exitCodeOf("ssh-add", ["-l"], onePasswordEnv) : Promise.resolve(null),
    ]);
    probe.onePasswordUnlocked = onePasswordAgent === 0;
    probe.sshKeys = process.env.SSH_AUTH_SOCK
      ? sshKeyState(agent)
      : sshKeyState(probe.onePassword ? onePasswordAgent : null);
  } catch {
    // An unexpected failure must not read as "not logged in": print nothing.
    probe.origin = "none";
  }
  return probe;
}

/** The `Git push:` lines for the repo at `cwd`. Never throws. */
export async function gitTransportAwareness(cwd?: string): Promise<string[]> {
  try {
    return gitTransportLines(await probeGitTransport(cwd));
  } catch {
    return [];
  }
}
