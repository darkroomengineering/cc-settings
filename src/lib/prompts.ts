// Interactive prompts — port of lib/prompts.sh.
//
// Uses node:readline/promises (built into Bun) for a yes/no confirm rather than
// pulling @inquirer/confirm and its ~10-package transitive tree for a single
// prompt. Falls back to defaults when stdin isn't a TTY (CI, piped input).

import { createInterface } from "node:readline/promises";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/** Secret prompt: one line from a TTY with echo off, so the value never lands
 *  in terminal scrollback. Uses the same readline path as promptYn (raw-mode
 *  stdin under Bun does not reliably deliver keystrokes); echo is switched off
 *  with `stty -echo` for the duration and restored in every exit path. Returns
 *  "" when stdin is not a TTY, on Enter with no input, on Ctrl+C, or Ctrl+D. */
export async function promptSecret(message: string): Promise<string> {
  if (!isInteractive()) return "";
  const stty = (mode: "-echo" | "echo") => {
    try {
      Bun.spawnSync(["stty", mode], { stdin: "inherit", stdout: "ignore", stderr: "ignore" });
    } catch {
      // stty missing (Windows): the prompt still works, only echoed.
    }
  };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ac = new AbortController();
  rl.once("SIGINT", () => ac.abort());
  stty("-echo");
  try {
    return (await rl.question(message, { signal: ac.signal })).trim();
  } catch {
    return "";
  } finally {
    stty("echo");
    rl.close();
    process.stdout.write("\n");
  }
}

/** Yes/No prompt. Defaults to yes. Returns true for yes. */
export async function promptYn(message: string, defaultYes = true): Promise<boolean> {
  if (!isInteractive()) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C while the question is pending: abort the read so question() rejects
  // and we fall back to the default. readline's close() alone does NOT unblock
  // a pending question() — only an AbortSignal rejects it — so without this the
  // prompt would hang on SIGINT (the behavior @inquirer/confirm gave for free).
  const ac = new AbortController();
  rl.once("SIGINT", () => ac.abort());
  try {
    const hint = defaultYes ? "(Y/n)" : "(y/N)";
    const answer = (await rl.question(`${message} ${hint} `, { signal: ac.signal }))
      .trim()
      .toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
  } catch {
    // EOF / closed stream (Ctrl+D, piped input ending) or SIGINT (AbortError)
    // → use the default.
    return defaultYes;
  } finally {
    rl.close();
  }
}
