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
import { z } from "zod";
import { Settings } from "../schemas/settings.ts";
import { runGit } from "./git.ts";
import { readJsonOrNull } from "./json-io.ts";
import { LIGHT_SKILLS } from "./light-profile.ts";
import { MANAGED_SKILLS } from "./managed-skills.ts";
import { CLAUDE_JSON_PATH } from "./mcp.ts";
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

// Zod schema for the version sentinel file (~/.claude/.cc-settings-version).
// Loose so future fields added by newer installers don't break reads. Kept
// here (module level) rather than inside gatherStatus so it is defined once
// regardless of how often gatherStatus is called.
export const VersionSentinel = z.looseObject({
  version: z.string().optional(),
  installed_at: z.string().optional(),
  profile: z.enum(["full", "light"]).optional(),
});

// The env vars that CLAUDE-FULL.md promises are always set after install.
export const EXPECTED_ENV_VARS = [
  "CLAUDE_CODE_EFFORT_LEVEL",
  "ENABLE_PROMPT_CACHING_1H",
  "ENABLE_TOOL_SEARCH",
  "CLAUDE_CODE_NO_FLICKER",
  "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
];

async function gatherGitDrift(sourceDir: string, claudeDir: string): Promise<GitDriftData> {
  const sha = await runGit(["rev-parse", "--short", "HEAD"], { cwd: sourceDir });
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  let behind: number | null = null;
  if (existsSync(sentinelPath)) {
    const since = (await Bun.file(sentinelPath).stat()).mtime.toISOString();
    const count = await runGit(["rev-list", "--count", "HEAD", `--since=${since}`], {
      cwd: sourceDir,
    });
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
  const sentinelPath = join(claudeDir, ".cc-settings-version");
  let sentinelVersion: string | null = null;
  let sentinelInstalledAt: string | null = null;
  let sentinelProfile: "full" | "light" | undefined;
  if (existsSync(sentinelPath)) {
    try {
      const parsed = JSON.parse(await readFile(sentinelPath, "utf8"));
      const result = VersionSentinel.safeParse(parsed);
      if (result.success) {
        sentinelVersion = result.data.version ?? null;
        sentinelInstalledAt = result.data.installed_at ?? null;
        sentinelProfile = result.data.profile;
      }
      // On validation failure, sentinelVersion / sentinelInstalledAt stay null
      // (treated as absent). The sentinel file has only 3 known fields and
      // is written by writeVersionSentinel() in setup.ts, so a schema failure
      // means the file is corrupt or tampered — falling back to null is safe.
    } catch {
      // JSON.parse threw — malformed file, treat as absent
    }
  }
  const sentinel: VersionSentinelData = {
    version: sentinelVersion,
    installedAt: sentinelInstalledAt,
    profile: sentinelProfile,
  };

  // --- Git drift ---
  let git: GitDriftData | null = null;
  if (existsSync(join(sourceDir, ".git"))) {
    git = await gatherGitDrift(sourceDir, claudeDir);
  }

  // --- Skills ---
  // For a light install, compare against LIGHT_SKILLS (share-learning only)
  // rather than MANAGED_SKILLS — otherwise all intentionally absent skills
  // would be reported as "missing".
  const effectiveProfile = sentinel.profile ?? "full";
  const skillsDir = join(claudeDir, "skills");
  const installedSkills = existsSync(skillsDir)
    ? new Set(await readdir(skillsDir).catch(() => []))
    : new Set<string>();
  const candidateSkills =
    effectiveProfile === "light"
      ? [...LIGHT_SKILLS]
      : MANAGED_SKILLS.filter((s) => existsSync(join(sourceDir, "skills", s)));
  // For light, only count skills that actually exist in the source repo.
  const shippedSkills =
    effectiveProfile === "light"
      ? candidateSkills.filter((s) => existsSync(join(sourceDir, "skills", s)))
      : candidateSkills;
  const missing = shippedSkills.filter((s) => !installedSkills.has(s));
  const skills: SkillsData = {
    shippedCount: shippedSkills.length,
    presentCount: shippedSkills.length - missing.length,
    missing,
  };

  // --- Settings.json ---
  // Parse once with the Settings schema instead of bare-casting each field.
  // Fail-soft exactly like the sentinel above: an unparseable settings.json is
  // treated as absent. Settings is a loose schema, so unknown root keys pass
  // through and never fail the parse.
  const userSettingsPath = join(claudeDir, "settings.json");
  const settingsResult = Settings.safeParse((await readJsonOrNull(userSettingsPath)) ?? {});
  const userSettings: Settings = settingsResult.success ? settingsResult.data : {};

  // Hooks
  const hooksBlock = userSettings.hooks ?? {};
  const hookEvents = Object.keys(hooksBlock);
  const hookGroupCount = Object.values(hooksBlock).reduce(
    (n, groups) => n + (groups?.length ?? 0),
    0,
  );
  const hooks: HooksData = { events: hookEvents, groupCount: hookGroupCount };

  // Env vars
  const envObj = userSettings.env ?? {};
  const envVars: EnvVarEntry[] = EXPECTED_ENV_VARS.map((key) => ({
    key,
    value: envObj[key],
  }));

  // Permissions
  const permissions: PermissionsData = {
    allowCount: userSettings.permissions?.allow?.length ?? 0,
    denyCount: userSettings.permissions?.deny?.length ?? 0,
  };

  // MCP servers from ~/.claude.json
  const claudeJson = (await readJsonOrNull(CLAUDE_JSON_PATH)) as {
    mcpServers?: Record<string, unknown>;
  } | null;
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
