// Interactive prompts — port of lib/prompts.sh.
//
// Wraps @inquirer/confirm so callers don't import it directly. Falls back to
// defaults when stdin isn't a TTY (CI, piped input). We use the standalone
// @inquirer/confirm subpackage rather than @inquirer/prompts because we only
// need yes/no.

import confirm from "@inquirer/confirm";

function isInteractive(): boolean {
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
