// Structured data returned by gatherStatus(). All fields are populated by
// gatherStatus; printStatus() (in src/setup.ts) renders them to the console.
// Having a typed intermediate lets us unit-test the data-gathering logic
// without capturing console output.

export interface VersionSentinelData {
  /** Installed version string, e.g. "11.2.1". Null when sentinel is absent or malformed. */
  version: string | null;
  /** ISO timestamp from the sentinel's installed_at field. Null when absent. */
  installedAt: string | null;
  /** Install profile ("full" | "light"). Absent in sentinels written before v11.21.0. */
  profile?: "full" | "light";
}

export interface GitDriftData {
  /** Short git SHA of repo HEAD. Empty string when git is unavailable. */
  sha: string;
  /**
   * Number of commits since last install (based on sentinel mtime).
   * null when sentinel is absent (can't compute drift).
   */
  behind: number | null;
}

export interface SkillsData {
  /** Total number of shipped skills (those with a skills/<name> directory in source). */
  shippedCount: number;
  /** Number of shipped skills currently present in ~/.claude/skills/. */
  presentCount: number;
  /** Names of shipped skills that are missing from the install target. */
  missing: string[];
}

export interface HooksData {
  /** Hook event names that have at least one group registered. */
  events: string[];
  /** Total number of hook groups across all events. */
  groupCount: number;
}

export interface EnvVarEntry {
  key: string;
  /** The configured value, or undefined if the var is not set. */
  value: string | undefined;
}

export interface PermissionsData {
  allowCount: number;
  denyCount: number;
}

export interface McpData {
  /** Names of MCP servers configured in ~/.claude.json. */
  servers: string[];
}

export interface StatusWarning {
  message: string;
}

export interface AutoUpdateData {
  /** Enrollment decision from the sentinel's auto_update field.
   *  undefined = never decided (absent from the sentinel — NOT "declined"). */
  enrolled: boolean | undefined;
  /** Whether the launchd plist file exists on disk. */
  plistPresent: boolean;
  /** Breadcrumb from the last nightly run (~/.claude/tmp/auto-update-last-run.json). */
  lastRun: { at: string; status: string } | null;
}

export interface StatusData {
  /** Packaged (source) version — the VERSION constant from setup.ts. */
  packagedVersion: string;
  sentinel: VersionSentinelData;
  /** Git drift info. Null when source dir is not a git checkout. */
  git: GitDriftData | null;
  skills: SkillsData;
  hooks: HooksData;
  /** Audit of the env vars that CLAUDE-FULL.md promises are set. */
  envVars: EnvVarEntry[];
  permissions: PermissionsData;
  mcp: McpData;
  /** Auto-update job status — macOS only (undefined on other platforms). */
  autoUpdate?: AutoUpdateData;
  /** Aggregated warnings (skill gaps, version mismatch, missing env vars). */
  warnings: StatusWarning[];
}
