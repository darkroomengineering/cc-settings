// The baseline keeps two distinct facts from the last full-profile install:
// `settings` is the merged restoration snapshot, including personal values;
// `team_settings` is the team's contribution before merging. Only the latter
// establishes ownership when pruning retired env keys or updating defaults.
// Legacy snapshots lack that evidence and must retain plain user-wins behavior.
// This multi-KB record lives separately from the small version sentinel read
// on every SessionStart. Permissions/hooks retain their existing merge policy.

import { join } from "node:path";
import { z } from "zod";
import { atomicWriteJson, readJsonOrNull } from "./json-io.ts";

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
  /** Team contribution before merging, excluding preserved personal values. */
  team_settings: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export type SettingsBaseline = z.infer<typeof SettingsBaselineSchema>;

export const BASELINE_FILENAME = ".cc-settings-baseline.json";

/**
 * Parse `~/.claude/.cc-settings-baseline.json` against
 * {@link SettingsBaselineSchema}.
 *
 * Returns the full parsed WRAPPER ({@link SettingsBaseline}: version +
 * written_at + settings + team_settings). Merge callers must use
 * `team_settings`; the merged `settings` snapshot cannot prove ownership.
 *
 * Returns null on a missing file, unparseable JSON, or a non-object top
 * level (array/primitive) — identical failure contract to readSentinel in
 * version-delta.ts, adapted to a null-based return since (unlike the
 * sentinel) there is no natural "empty object" default for a settings
 * snapshot. Never throws.
 */
export async function readSettingsBaseline(claudeDir: string): Promise<SettingsBaseline | null> {
  const path = join(claudeDir, BASELINE_FILENAME);
  try {
    const parsed = await readJsonOrNull(path);
    if (parsed === null) return null;
    const result = SettingsBaselineSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Write `~/.claude/.cc-settings-baseline.json` — the exact settings.json
 * content this install produced and the team's contribution before merging,
 * stamped with the cc-settings version and a
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
  teamSettings: Record<string, unknown>,
): Promise<void> {
  const record: SettingsBaseline = {
    version,
    written_at: new Date().toISOString(),
    settings,
    team_settings: teamSettings,
  };
  await atomicWriteJson(join(claudeDir, BASELINE_FILENAME), record);
}
