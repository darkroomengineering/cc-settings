// Settings baseline snapshot — Phase 1 of the three-way settings-merge design
// (docs/settings-merge-three-way-design.md §1). Records what cc-settings itself
// wrote to ~/.claude/settings.json on the last successful full-profile install,
// so a future three-way merge (base/team/user) has a real recorded fact instead
// of reconstructing "what did we install last time" from the hand-maintained
// DEPRECATED_PERMISSION_PATTERNS / DEPRECATED_COMMAND_PATTERNS regex registries
// in settings-merge.ts.
//
// Lives in its own file (~/.claude/.cc-settings-baseline.json), not the version
// sentinel (~/.claude/.cc-settings-version) — see the design doc §1 for why:
// the baseline is the ENTIRE merged settings.json (multi-KB: config/40-hooks.json
// alone is 317 lines, plus permissions/env/statusLine), while the sentinel is
// read on every SessionStart and must stay small. The baseline is written once
// per full-profile install and never touched by a hot path.
//
// As of v15.3.0 readSettingsBaseline has its first production caller:
// installSettings reads the previous install's baseline and threads its env
// block into mergeSettings as `baselineEnv`, so env keys cc-settings retires
// between versions are pruned three-way (old install wrote it + new config
// dropped it + user never changed it) instead of surviving forever or
// requiring a DEPRECATED_ENV_KEYS registry entry. That is the first slice of
// the design doc's engine — deliberately scoped to env only. The FULL
// three-way merge (permissions/hooks, generalizing the deprecated-pattern
// registries per the design doc's case 7) remains designed, costed, and
// DECLINED — see the design doc's note 7.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "./json-io.ts";

/**
 * Canonical schema for `~/.claude/.cc-settings-baseline.json`.
 *
 * z.looseObject + per-field `.catch(undefined)`, same pattern as
 * SentinelSchema in version-delta.ts: an unrecognized top-level key (written
 * by a NEWER installer than this code) passes through instead of failing, and
 * a single malformed field degrades to "absent" for THAT field only rather
 * than invalidating the whole read. Only a non-object top level (corrupt
 * JSON, or JSON that parses to a primitive/array) fails outright —
 * readSettingsBaseline treats that as "absent", same as a missing file.
 */
export const SettingsBaselineSchema = z.looseObject({
  /** cc-settings VERSION (src/setup.ts) at write time. */
  version: z.string().optional().catch(undefined),
  /** ISO timestamp of the write. */
  written_at: z.string().optional().catch(undefined),
  /** The merged settings.json content this install actually wrote. */
  settings: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export type SettingsBaseline = z.infer<typeof SettingsBaselineSchema>;

export const BASELINE_FILENAME = ".cc-settings-baseline.json";

/**
 * Parse `~/.claude/.cc-settings-baseline.json` against
 * {@link SettingsBaselineSchema}.
 *
 * Returns the full parsed WRAPPER ({@link SettingsBaseline}: version +
 * written_at + settings), not just the inner `settings` field. A future
 * three-way-merge caller wants `written_at`/`version` alongside the settings
 * snapshot (e.g. to distinguish "corrupt" from "stale"), so unwrapping to
 * bare settings here would throw that context away for no gain. A call site
 * that only wants the settings object gets it the same way the design doc's
 * own sketch does: `(await readSettingsBaseline(dir))?.settings ?? null`.
 *
 * Returns null on a missing file, unparseable JSON, or a non-object top
 * level (array/primitive) — identical failure contract to readSentinel in
 * version-delta.ts, adapted to a null-based return since (unlike the
 * sentinel) there is no natural "empty object" default for a settings
 * snapshot. Never throws.
 */
export async function readSettingsBaseline(claudeDir: string): Promise<SettingsBaseline | null> {
  const path = join(claudeDir, BASELINE_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const result = SettingsBaselineSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Write `~/.claude/.cc-settings-baseline.json` — the exact settings.json
 * content this install produced, stamped with the cc-settings version and a
 * timestamp. Called once per full-profile install, right after the merged
 * settings.json is read back for the hooks fingerprint (src/setup.ts,
 * installSettings) — reuses that same read, no second disk hit. Atomic
 * write (tmp + rename, via atomicWriteJson) so a crash never leaves a
 * parseable-but-wrong baseline on disk.
 */
export async function writeSettingsBaseline(
  claudeDir: string,
  version: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const record: SettingsBaseline = {
    version,
    written_at: new Date().toISOString(),
    settings,
  };
  await atomicWriteJson(join(claudeDir, BASELINE_FILENAME), record);
}
