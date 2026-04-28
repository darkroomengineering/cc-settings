// Hook config reader — port of lib/hook-config.sh.
//
// Two-tier fallback:
//   1. ~/.claude/hooks-config.local.json   (personal, git-ignored)
//   2. ~/.claude/hooks-config.json         (team defaults)
//
// Validated against the HooksConfig zod schema on read; invalid files fall
// back to the next tier rather than poisoning the whole hook stack.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HooksConfig } from "../schemas/hooks-config.ts";

const CLAUDE_DIR = join(homedir(), ".claude");
const LOCAL = join(CLAUDE_DIR, "hooks-config.local.json");
const TEAM = join(CLAUDE_DIR, "hooks-config.json");

type Config = Record<string, unknown>;

function readValidated(path: string): Config | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = HooksConfig.safeParse(parsed);
    if (!validated.success) return null;
    return validated.data as Config;
  } catch {
    return null;
  }
}

/** Resolve a dot-path value in a nested config. */
function getDot(cfg: Config, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, cfg);
}

/**
 * Read a config value using dot-notation. Returns the first defined value
 * found (local → team). Returns `defaultValue` if neither file has the key.
 */
function getHookConfig<T>(keyPath: string, defaultValue: T): T;
function getHookConfig(keyPath: string): unknown;
function getHookConfig(keyPath: string, defaultValue?: unknown): unknown {
  for (const path of [LOCAL, TEAM]) {
    const cfg = readValidated(path);
    if (!cfg) continue;
    const v = getDot(cfg, keyPath);
    if (v !== undefined && v !== null) return v;
  }
  return defaultValue;
}

/** Convenience: typed read for the claude_md_monitor block used by session-start.
 *
 * Resolution order:
 *   1. settings.json env vars (CC_CLAUDE_MD_*) — authoritative, set by setup.ts
 *   2. legacy hooks-config.local.json → hooks-config.json (Phase 3 compatibility)
 *   3. hardcoded defaults
 *
 * The env-var path will become the only path once hooks-config.json is
 * deleted in Phase 4.11 cleanup (tracked in plans/migration-lthread.md).
 */
export function getClaudeMdMonitor(): {
  enabled: boolean;
  warnLines: number;
  criticalLines: number;
} {
  // Env var path (preferred). `true`/`false`/`1`/`0` accepted.
  const envEnabled = process.env.CC_CLAUDE_MD_MONITOR_ENABLED;
  const envWarn = process.env.CC_CLAUDE_MD_WARN_LINES;
  const envCrit = process.env.CC_CLAUDE_MD_CRITICAL_LINES;
  const enabled =
    envEnabled !== undefined
      ? envEnabled === "true" || envEnabled === "1"
      : getHookConfig<boolean>("claude_md_monitor.enabled", true);
  const warnLines =
    envWarn !== undefined
      ? Number.parseInt(envWarn, 10) || 400
      : getHookConfig<number>("claude_md_monitor.warn_lines", 400);
  const criticalLines =
    envCrit !== undefined
      ? Number.parseInt(envCrit, 10) || 600
      : getHookConfig<number>("claude_md_monitor.critical_lines", 600);
  return { enabled, warnLines, criticalLines };
}
