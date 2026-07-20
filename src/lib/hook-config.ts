// CLAUDE.md-monitor thresholds for session-start.ts.
//
// Resolution: settings.json env vars (CC_CLAUDE_MD_*) — written by setup.ts at
// install time — with hardcoded defaults when unset.
//
// History: this module used to keep a two-tier hooks-config.{local.,}json file
// fallback (with zod validation and a dot-path resolver) alive solely to
// back-fill these three values. The installer has deleted those files on every
// install since the env-var collapse (setup.ts cleanOldConfig), so the file
// tier could never fire on a managed install — removed in the hooks-cluster
// audit cleanup.

const DEFAULT_WARN_LINES = 400;
const DEFAULT_CRITICAL_LINES = 600;

/** Parse an integer env var, falling back to `fallback` only on genuine NaN
 *  (unset or unparseable) — never on a falsy-but-valid 0. `|| fallback` would
 *  misread a legitimate 0 (e.g. CC_CLAUDE_MD_WARN_LINES=0) as unset, silently
 *  reviving the default. Shared by every intEnv-shaped call site in the hooks
 *  cluster (see parseIntArg below for the CLI-arg counterpart). */
export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Same NaN-only-fallback rule as intEnv, for a raw CLI-arg string instead of
 *  an env var name (e.g. `checkpoint.ts clean 0` must delete everything, not
 *  silently revive the default keep-count). */
export function parseIntArg(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Typed read of the claude_md_monitor thresholds used by session-start.
 *  Async only for call-site compatibility (session-start.ts awaits it). */
export async function getClaudeMdMonitor(): Promise<{
  enabled: boolean;
  warnLines: number;
  criticalLines: number;
}> {
  const envEnabled = process.env.CC_CLAUDE_MD_MONITOR_ENABLED;
  return {
    // `true`/`1` accepted; unset defaults to enabled.
    enabled: envEnabled === undefined ? true : envEnabled === "true" || envEnabled === "1",
    warnLines: intEnv("CC_CLAUDE_MD_WARN_LINES", DEFAULT_WARN_LINES),
    criticalLines: intEnv("CC_CLAUDE_MD_CRITICAL_LINES", DEFAULT_CRITICAL_LINES),
  };
}
