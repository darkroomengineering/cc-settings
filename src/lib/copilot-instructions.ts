// GitHub Copilot CLI reads $COPILOT_HOME/copilot-instructions.md (default
// ~/.copilot) in every session:
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
// The block is derived from the installed ~/.claude/AGENTS.md, so install,
// rollback, and uninstall all converge by re-running the sync afterwards.

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BlockMarkers,
  managedBlockRange,
  mergeInstructions,
  removeInstructions,
} from "./codex-native-agents.ts";
import { info, warn } from "./colors.ts";
import { CLAUDE_DIR } from "./platform.ts";

export const COPILOT_MARKERS: BlockMarkers = {
  start: "<!-- cc-settings:copilot:start -->",
  end: "<!-- cc-settings:copilot:end -->",
};

const COPILOT_NOTE = `## GitHub Copilot

These standards are shared with Claude Code and Codex. References to Claude Code tools, agents, hooks, skills, and output styles describe that host; use Copilot's equivalent where one exists and skip the rule where none does.`;

export type CopilotSyncResult = "written" | "removed" | "unchanged" | "skipped";

export function copilotHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.COPILOT_HOME ? resolve(env.COPILOT_HOME) : join(homedir(), ".copilot");
}

export async function syncCopilotInstructions(
  claudeDir: string = CLAUDE_DIR,
  home: string = copilotHome(),
): Promise<CopilotSyncResult> {
  // Never create ~/.copilot on a machine without Copilot CLI.
  if (!existsSync(home)) return "skipped";
  const target = join(home, "copilot-instructions.md");
  const [agents, existing] = await Promise.all([
    readFile(join(claudeDir, "AGENTS.md"), "utf8").catch(() => null),
    readFile(target, "utf8").catch(() => ""),
  ]);
  managedBlockRange(existing, COPILOT_MARKERS);
  if (agents === null) {
    const updated = removeInstructions(existing, COPILOT_MARKERS);
    if (updated === existing) return "unchanged";
    if (updated.trim().length === 0) await rm(target, { force: true });
    else await writeFile(target, updated);
    return "removed";
  }
  const block = `${COPILOT_MARKERS.start}\n${agents.trimEnd()}\n\n${COPILOT_NOTE}\n${COPILOT_MARKERS.end}`;
  const merged = mergeInstructions(existing, block, COPILOT_MARKERS);
  if (merged === existing) return "unchanged";
  await writeFile(target, merged);
  return "written";
}

/** Fail-open wrapper for setup: a Copilot problem never fails a Claude install. */
export async function reportCopilotSync(): Promise<void> {
  const target = join(copilotHome(), "copilot-instructions.md");
  try {
    const result = await syncCopilotInstructions();
    if (result === "written") info(`Copilot CLI instructions updated: ${target}`);
    else if (result === "removed") info(`Copilot CLI instructions removed from: ${target}`);
  } catch (err) {
    warn(`Skipped Copilot CLI instructions (${target}): ${(err as Error).message}`);
  }
}
