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

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return Number.parseInt(raw, 10) || fallback;
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
