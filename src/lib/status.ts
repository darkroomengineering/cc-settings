// Status data-gathering logic, extracted from src/setup.ts cmdStatus().
//
// gatherStatus() is a pure(-ish) function: it reads the filesystem and returns
// a structured StatusData object with no console output. printStatus() lives in
// src/setup.ts and handles rendering.
//
// Having the data-gathering separated lets tests assert on specific fields
// without capturing or parsing console output.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_JSON_PATH, readJsonOrNull } from "./mcp.ts";
import type {
  EnvVarEntry,
  GitDriftData,
  HooksData,
  McpData,
  PermissionsData,
  SkillsData,
  StatusData,
  VersionSentinelData,
} from "./status-types.ts";

// The env vars that CLAUDE-FULL.md promises are always set after install.
export const EXPECTED_ENV_VARS = [
  "CLAUDE_CODE_EFFORT_LEVEL",
  "ENABLE_PROMPT_CACHING_1H",
  "ENABLE_TOOL_SEARCH",
  "CLAUDE_CODE_NO_FLICKER",
  "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
];

// Managed skill directories — mirrored from src/setup.ts so gatherStatus
// can compute which shipped skills are present/missing without importing
// the entire setup module.
export const MANAGED_SKILLS = [
  "autoresearch",
  "build",
  "cc",
  "checkpoint",
  "component",
  "consolidate",
  "context-doc",
  "design-tokens",
  "dr-init",
  "explore",
  "fix",
  "handoff",
  "hook",
  "lighthouse",
  "oracle",
  "orchestrate",
  "plan-feature",
  "project",
  "qa",
  "refactor",
  "review",
  "ship",
  "test",
  "tldr",
  "verify",
  "zero-tech-debt",
  // Kept for upgrade cleanup only.
  "ask",
  "audit",
  "cc-sync",
  "cc-update",
  "compare-approaches",
  "context",
  "create-handoff",
  "darkroom-init",
  "debug",
  "discovery",
  "docs",
  "f-thread",
  "figma",
  "init",
  "l-thread",
  "learn",
  "lenis",
  "long-task",
  "prd",
  "premortem",
  "resume-handoff",
  "share-learning",
  "tdd",
  "teams",
  "versions",
  "write-a-skill",
  "zoom-out",
];

async function runCapture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return proc.exitCode === 0 ? out.trim() : "";
}

async function gatherGitDrift(sourceDir: string, claudeDir: string): Promise<GitDriftData> {
  const sha = await runCapture(["git", "-C", sourceDir, "rev-parse", "--short", "HEAD"]);
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  let behind: number | null = null;
  if (existsSync(sentinelPath)) {
    const since = (await Bun.file(sentinelPath).stat()).mtime.toISOString();
    const count = await runCapture([
      "git",
      "-C",
      sourceDir,
      "rev-list",
      "--count",
      "HEAD",
      `--since=${since}`,
    ]);
    const n = Number.parseInt(count, 10);
    behind = Number.isFinite(n) ? n : null;
  }
  return { sha, behind };
}

/**
 * Gather all status data from the filesystem. No console output.
 *
 * @param sourceDir  Path to the cc-settings source repo checkout.
 * @param claudeDir  Path to the ~/.claude directory (install target).
 * @param packagedVersion  The VERSION constant from setup.ts — passed in so
 *                         this function doesn't need to import it.
 */
export async function gatherStatus(
  sourceDir: string,
  claudeDir: string,
  packagedVersion: string,
): Promise<StatusData> {
  // --- Sentinel ---
  interface RawSentinel {
    version?: string;
    installed_at?: string;
  }
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  let sentinelRaw: RawSentinel | null = null;
  if (existsSync(sentinelPath)) {
    try {
      sentinelRaw = JSON.parse(await readFile(sentinelPath, "utf8")) as RawSentinel;
    } catch {
      // malformed — treat as absent
    }
  }
  const sentinel: VersionSentinelData = {
    version: sentinelRaw?.version ?? null,
    installedAt: sentinelRaw?.installed_at ?? null,
  };

  // --- Git drift ---
  let git: GitDriftData | null = null;
  if (existsSync(join(sourceDir, ".git"))) {
    git = await gatherGitDrift(sourceDir, claudeDir);
  }

  // --- Skills ---
  const skillsDir = join(claudeDir, "skills");
  const installedSkills = existsSync(skillsDir)
    ? new Set(await readdir(skillsDir).catch(() => []))
    : new Set<string>();
  const shippedSkills = MANAGED_SKILLS.filter((s) => existsSync(join(sourceDir, "skills", s)));
  const missing = shippedSkills.filter((s) => !installedSkills.has(s));
  const skills: SkillsData = {
    shippedCount: shippedSkills.length,
    presentCount: shippedSkills.length - missing.length,
    missing,
  };

  // --- Settings.json ---
  const userSettingsPath = join(claudeDir, "settings.json");
  const userSettings = (await readJsonOrNull<Record<string, unknown>>(userSettingsPath)) ?? {};

  // Hooks
  const hooksObj = (userSettings.hooks ?? {}) as Record<string, unknown>;
  const hookEvents = Object.keys(hooksObj);
  const hookGroupCount = hookEvents.reduce(
    (n, ev) => n + (Array.isArray(hooksObj[ev]) ? (hooksObj[ev] as unknown[]).length : 0),
    0,
  );
  const hooks: HooksData = { events: hookEvents, groupCount: hookGroupCount };

  // Env vars
  const envObj = (userSettings.env ?? {}) as Record<string, unknown>;
  const envVars: EnvVarEntry[] = EXPECTED_ENV_VARS.map((key) => ({
    key,
    value: envObj[key] !== undefined ? String(envObj[key]) : undefined,
  }));

  // Permissions
  const perms = (userSettings.permissions ?? {}) as Record<string, unknown>;
  const permissions: PermissionsData = {
    allowCount: Array.isArray(perms.allow) ? (perms.allow as unknown[]).length : 0,
    denyCount: Array.isArray(perms.deny) ? (perms.deny as unknown[]).length : 0,
  };

  // MCP servers from ~/.claude.json
  const claudeJson = await readJsonOrNull<{ mcpServers?: Record<string, unknown> }>(
    CLAUDE_JSON_PATH,
  );
  const mcp: McpData = { servers: Object.keys(claudeJson?.mcpServers ?? {}) };

  // --- Warnings ---
  const warnings: { message: string }[] = [];
  if (missing.length > 0) warnings.push({ message: `${missing.length} skill(s) missing` });
  if (sentinel.version && sentinel.version !== packagedVersion) {
    warnings.push({
      message: `installed v${sentinel.version} ≠ packaged v${packagedVersion} (re-run to update)`,
    });
  }
  const missingEnvKeys = envVars.filter((e) => e.value === undefined);
  if (missingEnvKeys.length > 0) {
    warnings.push({ message: `${missingEnvKeys.length} env var(s) unset` });
  }

  return {
    packagedVersion,
    sentinel,
    git,
    skills,
    hooks,
    envVars,
    permissions,
    mcp,
    warnings,
  };
}
