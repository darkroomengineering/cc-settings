import { z } from "zod";
import { HooksBlock } from "./hooks.ts";
import { McpServers } from "./mcp.ts";
import { Permissions } from "./permissions.ts";

// Schema-authoring note: when typing an enum SETTING, prefer a permissive
// superset over the doc-literal values. Claude Code persists values its own
// docs omit (e.g. effortLevel "max", teammateMode "in-process"). The root is
// a loose object, which tolerates unknown KEYS — but NOT invalid VALUES of
// known keys — so a too-literal enum rejects a real live settings.json.

// --- Sub-schemas ----------------------------------------------------------

export const SpinnerVerbs = z.object({
  mode: z.enum(["replace", "append"]),
  verbs: z.array(z.string().min(1)).min(1),
});

// Suppress built-in spinner tips (2.1.122). Shape is partially documented;
// only `excludeDefault` is referenced upstream. Loose so future fields
// don't break user configs at install time.
export const SpinnerTipsOverride = z.looseObject({
  excludeDefault: z.boolean().optional(),
});

export const StatusLine = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
  refreshInterval: z.number().int().positive().optional(), // added 2.1.104
});

export const Attribution = z.object({
  commit: z.string().optional(),
  pr: z.string().optional(),
});

// doc-canonical values are auto|in-process|tmux; manual|disabled kept as a
// superset to not reject older configs.
export const TeammateMode = z.enum(["auto", "in-process", "tmux", "manual", "disabled"]);

// Sandbox config (introduced 2.1.98–2.1.108). Not yet in any user config in
// this repo; fields verified via docs + changelog. Loose on the root
// because the shape is still evolving.
export const Sandbox = z.looseObject({
  failIfUnavailable: z.boolean().optional(),
  enableWeakerNetworkIsolation: z.boolean().optional(), // macOS: weaker network isolation for MITM proxy verification
  network: z
    .object({
      deniedDomains: z.array(z.string()).optional(),
    })
    .optional(),
  filesystem: z
    .object({
      allowRead: z.array(z.string()).optional(),
      allowWrite: z.array(z.string()).optional(), // re-allow write paths inside denyWrite regions
    })
    .optional(),
  bwrapPath: z.string().optional(), // 2.1.133 — Linux/WSL bubblewrap binary override
  socatPath: z.string().optional(), // 2.1.133 — Linux/WSL socat binary override
});

// Model-specific overrides map (2.1.105). Value shape undocumented-but-open;
// keep it permissive until the scanner surfaces its schema.
export const ModelOverrides = z.record(z.string(), z.unknown());

// Worktree config (2.1.133). `baseRef` chooses whether new worktrees branch
// from origin/<default> (`fresh`, the post-2.1.133 default) or local HEAD
// (`head`, the 2.1.128–2.1.132 default). Use `head` to keep unpushed commits.
// `bgIsolation: "none"` (added 2.1.143) lets background sessions edit the
// working copy directly without EnterWorktree, for repos where worktrees are
// impractical.
export const Worktree = z.looseObject({
  baseRef: z.enum(["fresh", "head"]).optional(),
  bgIsolation: z.enum(["none"]).optional(),
});

// Per-skill override map (2.1.129). Hides or trims skills from the model /
// `/` picker. `off`: hide entirely; `user-invocable-only`: hide from model;
// `name-only`: collapse description.
export const SkillOverrides = z.record(
  z.string(),
  z.enum(["off", "user-invocable-only", "name-only"]),
);

// --- Root -----------------------------------------------------------------

// Loose, not strict: Claude Code writes undocumented keys (theme,
// enabledPlugins, agentPushNotifEnabled) to settings.json, so a strict schema
// can never validate a real live file. Typos in OUR config/*.json fragments
// are caught by a dedicated test in tests/schemas.test.ts instead.
export const Settings = z.looseObject({
  $schema: z.string().optional(),

  env: z.record(z.string(), z.string()).optional(),

  model: z.string().optional(),

  // Appearance + UX
  spinnerVerbs: SpinnerVerbs.optional(),
  spinnerTipsOverride: SpinnerTipsOverride.optional(), // 2.1.122
  statusLine: StatusLine.optional(),
  showThinkingSummaries: z.boolean().optional(),

  // Collaboration
  teammateMode: TeammateMode.optional(),
  attribution: Attribution.optional(),

  // Filesystem conventions
  plansDirectory: z.string().optional(),
  includeGitInstructions: z.boolean().optional(),

  // Core
  permissions: Permissions.optional(),
  hooks: HooksBlock.optional(),
  mcpServers: McpServers.optional(),

  // Global toggles / newer knobs (from upstream docs, may not be in user configs yet)
  disableAllHooks: z.boolean().optional(),
  disableAutoMode: z.enum(["disable"]).optional(),
  disableBypassPermissionsMode: z.enum(["disable"]).optional(),
  skipDangerousModePermissionPrompt: z.boolean().optional(), // skip the confirmation before entering bypass-permissions mode; ignored in project settings (per docs)
  effortLevel: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(), // persist /effort across sessions; settings.json counterpart of CLAUDE_CODE_EFFORT_LEVEL. The key's docs list 4 values, but the env var + real live configs also use "max" — superset to not reject observed values.
  disableSkillShellExecution: z.boolean().optional(), // 2.1.98
  disableBundledSkills: z.boolean().optional(), // 2.1.169 — hide Anthropic's bundled skills, workflows, and built-in slash commands from the model; env counterpart CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
  disableDeepLinkRegistration: z.boolean().optional(), // 2.1.103
  autoScrollEnabled: z.boolean().optional(), // 2.1.102
  autoMemoryDirectory: z.string().optional(), // 2.1.101
  cleanupPeriodDays: z.number().int().min(1).optional(), // transcript + orphaned-worktree retention; default 30, min 1 (0 rejected upstream)
  channelsEnabled: z.boolean().optional(), // 2.1.128: also gates `--channels` for console (API key) auth in managed-settings orgs
  allowedChannelPlugins: z.array(z.string()).optional(), // 2.1.107 (team/enterprise)
  allowedMcpServers: z.array(z.string()).optional(), // 2.1.112
  deniedMcpServers: z.array(z.string()).optional(), // 2.1.112
  allowAllClaudeAiMcps: z.boolean().optional(), // 2.1.149 — load claude.ai cloud MCP connectors alongside managed-mcp.json
  enabledMcpjsonServers: z.array(z.string()).optional(), // allowlist for project .mcp.json server names
  disabledMcpjsonServers: z.array(z.string()).optional(), // blocklist for project .mcp.json server names
  modelOverrides: ModelOverrides.optional(), // 2.1.105
  feedbackSurveyRate: z.number().optional(), // 2.1.106 (enterprise)
  sandbox: Sandbox.optional(), // 2.1.98–2.1.108 nested
  changelogUrl: z.string().optional(),
  prUrlTemplate: z.string().optional(), // 2.1.119 — substitutes {host}, {owner}, {repo}, {number}, {url}
  worktree: Worktree.optional(), // 2.1.133
  skillOverrides: SkillOverrides.optional(), // 2.1.129 (now functional)
  parentSettingsBehavior: z.enum(["first-wins", "merge"]).optional(), // 2.1.133 (admin-tier)

  // --- GENERAL ---
  agent: z.string().optional(), // default agent name for subagent invocations
  alwaysThinkingEnabled: z.boolean().optional(), // always show extended thinking even on short turns
  autoMemoryEnabled: z.boolean().optional(), // enable/disable the auto-memory system
  autoMode: z.looseObject({}).optional(), // auto-mode configuration object (shape evolving)
  autoUpdatesChannel: z.enum(["stable", "latest"]).optional(), // which release channel to track for updates
  claudeMdExcludes: z.array(z.string()).optional(), // glob patterns for CLAUDE.md files to exclude
  defaultShell: z.enum(["bash", "powershell"]).optional(), // shell used by the Bash tool
  enableAllProjectMcpServers: z.boolean().optional(), // auto-enable every server listed in .mcp.json
  fallbackModel: z.union([z.string(), z.array(z.string())]).optional(), // 2.1.166 — up to three fallback models tried in order when the primary is overloaded/unavailable; settings.json counterpart of --fallback-model (which now also applies to interactive sessions). string | string[] superset: the CLI flag takes one model, the setting allows up to three, and upstream docs don't yet pin the shape.
  fastModePerSessionOptIn: z.boolean().optional(), // per-session fast-mode opt-in flag
  fileSuggestion: z.looseObject({}).optional(), // file-suggestion UI configuration object
  footerLinksRegexes: z.array(z.unknown()).optional(), // 2.1.176 — regex-matched link badges in the footer row (user or managed settings); entry shape not yet pinned upstream
  includeCoAuthoredBy: z.boolean().optional(), // deprecated: use attribution instead
  language: z.string().optional(), // UI language / locale override (e.g. "en", "ja")
  maxSkillDescriptionChars: z.number().int().positive().optional(), // per-skill description character cap for the model
  otelHeadersHelper: z.string().optional(), // shell command that emits OTEL auth headers
  outputStyle: z.string().optional(), // output rendering style override
  respectGitignore: z.boolean().optional(), // honour .gitignore when listing files
  skillListingBudgetFraction: z.number().optional(), // fraction of context budget reserved for skill listings
  skipWebFetchPreflight: z.boolean().optional(), // skip the preflight check before web-fetch tool calls
  sshConfigs: z.array(z.unknown()).optional(), // SSH tunnel/proxy configuration entries
  useAutoModeDuringPlan: z.boolean().optional(), // run auto-mode during the plan phase
  voice: z.looseObject({}).optional(), // voice input/output configuration object
  voiceEnabled: z.boolean().optional(), // enable the voice interface
  wheelScrollAccelerationEnabled: z.boolean().optional(), // 2.1.174 — toggle mouse-wheel scroll acceleration in fullscreen mode

  // --- ENTERPRISE/MANAGED ---
  allowedHttpHookUrls: z.array(z.string()).optional(), // allowlist of HTTP endpoints hooks may call
  allowManagedHooksOnly: z.boolean().optional(), // block user-defined hooks; only managed hooks run
  allowManagedMcpServersOnly: z.boolean().optional(), // block user-defined MCP servers
  allowManagedPermissionRulesOnly: z.boolean().optional(), // block user-defined permission rules
  availableModels: z.array(z.string()).optional(), // restrict the model picker to this list
  blockedMarketplaces: z.array(z.string()).optional(), // marketplace IDs that users cannot install from
  claudeMd: z.string().optional(), // managed system-prompt override (replaces CLAUDE.md lookup)
  companyAnnouncements: z.array(z.string()).optional(), // banner messages shown at session start
  disableAgentView: z.boolean().optional(), // hide the agent-activity panel in the TUI
  disableRemoteControl: z.boolean().optional(), // prevent remote-control / programmatic session takeover
  enforceAvailableModels: z.boolean().optional(), // 2.1.175 — managed: availableModels allowlist also constrains the Default model; user/project cannot widen a managed list
  forceRemoteSettingsRefresh: z.boolean().optional(), // force a settings reload from the managed settings URL
  httpHookAllowedEnvVars: z.array(z.string()).optional(), // env vars forwarded to HTTP hooks
  minimumVersion: z.string().optional(), // minimum Claude Code version required; older clients are blocked
  pluginTrustMessage: z.string().optional(), // custom trust-confirmation message shown when installing plugins
  policyHelper: z.looseObject({}).optional(), // policy-helper configuration object (enterprise)
  requiredMaximumVersion: z.string().optional(), // 2.1.163 — managed: refuse to start if the version is above this
  requiredMinimumVersion: z.string().optional(), // 2.1.163 — managed: refuse to start if the version is below this; pairs with requiredMaximumVersion to define an allowed range
  strictKnownMarketplaces: z.array(z.string()).optional(), // allowlist of marketplace IDs considered trusted
  strictPluginOnlyCustomization: z
    .union([z.boolean(), z.array(z.enum(["skills", "agents", "hooks", "mcp"]))])
    .optional(), // restrict customization to plugin-provided items only; true = all categories
  wslInheritsWindowsSettings: z.boolean().optional(), // WSL sessions inherit the Windows-side managed settings

  // --- AUTH/PROVIDER ---
  apiKeyHelper: z.string().optional(), // shell command that emits an Anthropic API key
  awsAuthRefresh: z.string().optional(), // shell command called to refresh AWS credentials
  awsCredentialExport: z.string().optional(), // shell command that exports AWS credential env vars
  forceLoginMethod: z.enum(["claudeai", "console"]).optional(), // lock the login flow to a specific provider
  forceLoginOrgUUID: z.union([z.string(), z.array(z.string())]).optional(), // restrict login to a specific org UUID (or list)
  gcpAuthRefresh: z.string().optional(), // shell command called to refresh GCP credentials

  // --- UX ---
  awaySummaryEnabled: z.boolean().optional(), // show a session recap on re-entry after background work
  editorMode: z.enum(["normal", "vim"]).optional(), // input editor keybindings
  preferredNotifChannel: z
    .enum([
      "auto",
      "terminal_bell",
      "iterm2",
      "iterm2_with_bell",
      "kitty",
      "ghostty",
      "notifications_disabled",
    ])
    .optional(), // preferred desktop/terminal notification channel
  prefersReducedMotion: z.boolean().optional(), // suppress animations in the TUI
  showClearContextOnPlanAccept: z.boolean().optional(), // offer context-clear prompt after accepting a plan
  showTurnDuration: z.boolean().optional(), // show per-turn elapsed time in the TUI
  spinnerTipsEnabled: z.boolean().optional(), // show tips in the thinking spinner
  syntaxHighlightingDisabled: z.boolean().optional(), // disable syntax highlighting in code blocks
  terminalProgressBarEnabled: z.boolean().optional(), // show a progress bar for long-running operations
  tui: z.enum(["fullscreen", "default"]).optional(), // TUI rendering mode (fullscreen uses alternate screen)
  viewMode: z.enum(["default", "verbose", "focus"]).optional(), // controls how much detail the TUI shows
});

export type Settings = z.infer<typeof Settings>;
