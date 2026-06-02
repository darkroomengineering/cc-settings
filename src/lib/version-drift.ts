// Version-drift detection for the statusline nudge. The installer stamps
// ~/.claude/.cc-settings-version with the installed version AND the repo path it
// was installed from. After `git pull` bumps the VERSION constant in the repo's
// src/setup.ts but before the user re-runs setup.sh, installed < packaged — the
// install is stale. SessionStart computes this once and caches it; the statusline
// renders a nudge from the cached flag (hot-path safe).
//
// Every reader fails soft (returns null / not-stale): a missing sentinel, a
// sentinel without repo_path (installed before this feature), a deleted clone,
// or malformed input all resolve to "no nudge".

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compareVersion } from "./version-delta.ts";

// The sentinel reader (readSentinelInfo) and its SentinelInfo type live in
// version-delta.ts — the single source for ~/.claude/.cc-settings-version reads.
// This module composes that with the repo's packaged VERSION to detect drift.

export interface DriftResult {
  stale: boolean;
  installed: string | null;
  packaged: string | null;
}

// Match `const VERSION = "11.12.0"` in the repo's src/setup.ts. Anchored on
// `const VERSION` so a stray `VERSION = ...` in a comment can't shadow it.
const VERSION_CONST_RE = /\bconst VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/;

/** Read the repo's packaged VERSION constant from <repoPath>/src/setup.ts.
 *  Returns null if the repo is gone or the constant can't be parsed. Never throws. */
export async function readPackagedVersion(repoPath: string | null): Promise<string | null> {
  if (!repoPath) return null;
  const setupPath = join(repoPath, "src", "setup.ts");
  if (!existsSync(setupPath)) return null;
  try {
    const src = await readFile(setupPath, "utf8");
    const m = VERSION_CONST_RE.exec(src);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Stale when both versions are known and packaged is strictly newer. */
export function computeDrift(installed: string | null, packaged: string | null): DriftResult {
  const stale = installed !== null && packaged !== null && compareVersion(packaged, installed) > 0;
  return { stale, installed, packaged };
}
