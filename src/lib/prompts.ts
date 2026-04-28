// Interactive prompts — port of lib/prompts.sh.
//
// Wraps @inquirer/prompts so callers don't import it directly. Falls back to
// defaults when stdin isn't a TTY (CI, piped input).

import { confirm } from "@inquirer/prompts";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/** Yes/No prompt. Defaults to yes. Returns true for yes. */
export async function promptYn(message: string, defaultYes = true): Promise<boolean> {
  if (!isInteractive()) return defaultYes;
  try {
    return await confirm({ message, default: defaultYes });
  } catch {
    // Ctrl+C / stream closed → treat as "use default".
    return defaultYes;
  }
}
