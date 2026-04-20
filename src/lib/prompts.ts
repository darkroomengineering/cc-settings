// Interactive prompts — port of lib/prompts.sh.
//
// Wraps @inquirer/prompts so callers don't import it directly. Supports a
// global non-interactive mode that auto-returns defaults (used by CI + tests).

import { confirm, input, select } from "@inquirer/prompts";

let interactive = true;

/** Force non-interactive mode. In this mode, all prompts return their default. */
export function setInteractive(on: boolean): void {
  interactive = on;
}

export function isInteractive(): boolean {
  return interactive && process.stdin.isTTY === true;
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

/** Free-form text prompt with optional default. */
export async function promptText(message: string, defaultValue?: string): Promise<string | null> {
  if (!isInteractive()) return defaultValue ?? null;
  try {
    return await input({
      message,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    });
  } catch {
    return defaultValue ?? null;
  }
}

/** Single choice from a list of labelled options. */
export async function promptChoice<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  defaultValue?: T,
): Promise<T | null> {
  if (!isInteractive()) return defaultValue ?? null;
  try {
    return await select({
      message,
      choices,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    });
  } catch {
    return defaultValue ?? null;
  }
}
