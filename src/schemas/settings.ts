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
  sessionUrl: z.boolean().optional(), // added 2.1.183: false omits the claude.ai session link from commits/PRs
});

// doc-canonical values are auto|in-process|tmux|iterm2 (iterm2 added 2.1.186);
// manual|disabled kept as a superset to not reject older configs.
export const TeammateMode = z.enum(["auto", "in-process", "tmux", "iterm2", "manual", "disabled"]);

// Credential protection modes (sandbox.credentials). 2.1.187 introduced
// `deny`; 2.1.199 added `mask` for env vars and 2.1.221 for files. `mask`
// shows sandboxed commands a per-session sentinel while the sandbox proxy
// swaps the real value back in on egress to `injectHosts` (each of which must
// itself be covered by network.allowedDomains; with no injectHosts the value
// is substituted on every allowed domain). Masking REQUIRES
// network.tlsTerminate — without it the sentinel reaches the server unchanged
// and auth fails closed. `mask` entries, tlsTerminate, and allowPlaintextInject
// are honored only from user settings, managed settings, or --settings; they
// are ignored in a repo's .claude/settings.json. When the same name is listed
// `deny` in any scope, `deny` wins.
const CredentialMode = z.enum(["deny", "mask"]);

// `decode: "jwt"` masks a JWT-shaped secret with a *synthetic* JWT (alg HS256,
// sub `fake_value_<uuid>`, exp 9999999999) instead of an opaque sentinel, so
// tools that structurally parse the token still work. With `maskClaims`, only
// those string claims inside the payload are replaced and the rest stays
// readable. Both FAIL OPEN: if the value does not verify as a JWT, or none of
// `maskClaims` is present as a string claim, the entry is skipped and the real
// secret is left visible inside the sandbox (console warning only).
const CredentialDecode = z.enum(["jwt"]);

export const CredentialEnvVar = z.looseObject({
  name: z.string(),
  mode: CredentialMode,
  injectHosts: z.array(z.string()).optional(),
  decode: CredentialDecode.optional(), // 2.1.224
  maskClaims: z.array(z.string()).optional(), // 2.1.224 — requires decode: "jwt"
});

// `extract` is a regex needing >=1 capture group; only group 1 of each match
// is replaced, so structured files (.netrc, JSON, YAML) stay parseable.
// Without it the entire file body becomes one sentinel. `onExtractNoMatch`
// and `maskDuplicates` apply only when mode is "mask" AND extract is set.
// Platform note: file masking is Linux/WSL behavior — on macOS a `mask` file
// entry behaves as `deny` while filesystem isolation is on. Claude Code falls
// back to `deny` for anything it cannot mask safely (directory, glob, >8 MiB,
// or non-UTF-8).
export const CredentialFile = z.looseObject({
  path: z.string(),
  mode: CredentialMode,
  extract: z.string().optional(),
  injectHosts: z.array(z.string()).optional(),
  onExtractNoMatch: z.enum(["warn", "deny", "error"]).optional(), // default "warn"
  maskDuplicates: z.boolean().optional(), // default false
  // 2.1.224 — with decode: "jwt" and no `extract`, Claude Code applies a
  // built-in JWT pattern, so every JWT in the file is masked.
  decode: CredentialDecode.optional(),
  maskClaims: z.array(z.string()).optional(), // requires decode: "jwt"
});

// 2.1.224 — declares which env-var trio forms an AWS credential pair, so the
// sandbox proxy can re-sign SigV4 requests with the real secret on egress.
// Claude Code adds the conventional AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/
// AWS_SESSION_TOKEN trio implicitly unless a configured pair already claims one
// of those names. A pair only registers when BOTH the key-id and secret vars
// are whole-value `mode: "mask"` entries (no `extract`, no `decode`); masking
// only the secret logs a warning and signs requests that fail upstream.
export const AwsCredentialPair = z.looseObject({
  accessKeyIdVar: z.string(),
  secretAccessKeyVar: z.string(),
  sessionTokenVar: z.string().optional(),
});

// 2.1.224 — what to do with the SigV4 request kinds the proxy cannot re-sign.
// Ordinary header-signed requests are always re-signed and are not configurable
// here. All three default to "deny"; "passthrough" forwards the request
// unmodified, which still fails upstream because the signature covers the
// masked placeholder — it exists to surface the upstream error instead of a
// local denial.
export const Sigv4Policy = z.looseObject({
  streaming: z.enum(["deny", "passthrough"]).optional(),
  presigned: z.enum(["deny", "passthrough"]).optional(),
  sigv4a: z.enum(["deny", "passthrough"]).optional(),
});

// Sandbox config (introduced 2.1.98–2.1.108). Nested objects are loose: the
// shape is still evolving upstream and a strict object silently strips keys
// it does not model (this is how allowedDomains went missing until 2.1.223).
export const Sandbox = z.looseObject({
  failIfUnavailable: z.boolean().optional(),
  enableWeakerNetworkIsolation: z.boolean().optional(), // macOS: weaker network isolation for MITM proxy verification
  allowAppleEvents: z.boolean().optional(), // 2.1.181 — macOS: allow sandboxed commands to send Apple Events
  network: z
    .looseObject({
      allowedDomains: z.array(z.string()).optional(),
      deniedDomains: z.array(z.string()).optional(),
      // managed settings only — block non-allowed domains instead of prompting
      allowManagedDomainsOnly: z.boolean().optional(),
      // 2.1.219 — deny hosts not on the allowlist outright instead of
      // prompting. Turns the allowlist from advisory into enforcing.
      strictAllowlist: z.boolean().optional(),
      // 2.1.199 — proxy terminates TLS itself so it can substitute masked
      // credentials inside request headers and bodies. Required by any
      // `mode: "mask"` entry. Empty object is the documented enabling form.
      tlsTerminate: z.looseObject({}).optional(),
      // Unix-socket egress from inside the sandbox. Load-bearing for
      // cross-session messaging: a sandboxed Bash command can only post to a
      // session's inbox socket (CLAUDE_CODE_MESSAGING_SOCKET) if that path is
      // reachable. allowAllUnixSockets skips the Linux seccomp filter entirely.
      allowUnixSockets: z.array(z.string()).optional(),
      allowAllUnixSockets: z.boolean().optional(),
    })
    .optional(),
  filesystem: z
    .looseObject({
      allowRead: z.array(z.string()).optional(),
      allowWrite: z.array(z.string()).optional(), // re-allow write paths inside denyWrite regions
      disabled: z.boolean().optional(), // 2.1.216 — skip filesystem isolation while keeping network egress control
    })
    .optional(),
  // 2.1.187 — declare credential files + env vars sandboxed commands must not
  // touch. Complements the process-wide CLAUDE_CODE_SUBPROCESS_ENV_SCRUB.
  credentials: z
    .looseObject({
      files: z.array(CredentialFile).optional(),
      envVars: z.array(CredentialEnvVar).optional(),
      // lets the proxy inject real credentials into unencrypted requests
      allowPlaintextInject: z.boolean().optional(),
      awsPairs: z.array(AwsCredentialPair).optional(), // 2.1.224
      sigv4: Sigv4Policy.optional(), // 2.1.224
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
  emojiCompletionEnabled: z.boolean().optional(), // 2.1.217 — emoji shortcode autocomplete in the prompt input (`:heart:` → ❤️)

  // Collaboration
  teammateMode: TeammateMode.optional(),
  attribution: Attribution.optional(),
  // 2.1.224 cross-session messaging (macOS/Linux; not on Bedrock/Vertex/
  // Foundry). What this session does with messages arriving from your OTHER
  // sessions: "accept" delivers, "hold" shows a notice and waits for approval,
  // "refuse" drops silently. Unset is NOT "accept" — Claude Code decides per
  // message from the two sessions' permission modes, holding anything sent by
  // a bypassPermissions session to a session that also bypasses. Precedence is
  // unusual: a "refuse" in project or local settings beats every other scope.
  crossSessionInbound: z.enum(["accept", "hold", "refuse"]).optional(),
  // 2.1.224 — require explicit approval before SendMessage reaches a session on
  // another machine (Remote Control / claude.ai). `true` from any scope wins,
  // so a checked-in project file can turn it on but never off. Same-machine
  // messages never prompt.
  isolatePeerMachines: z.boolean().optional(),
  // 2.1.226 — auto-connect the session to Remote Control at startup so it is
  // reachable from claude.ai/phone without running /remote-control by hand.
  remoteControlAtStartup: z.boolean().optional(),
  // 2.1.224 — how long an unanswered approval dialog (including a held inbound
  // message) stays open before Claude Code drops it. Duration strings, not a
  // number; upstream default is "5m". Same domain as askUserQuestionTimeout.
  dialogExpiry: z.enum(["60s", "5m", "10m", "never"]).optional(),

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
  // 2.1.219 — advisory ceiling on how many agents a dynamic workflow should
  // spawn; upstream default is "medium" (aim for fewer than 15). Settings-file
  // counterpart of /config's "Dynamic workflow size". Typed as a bare string
  // rather than an enum: the changelog names the default but never enumerates
  // the accepted values, and guessing a closed set here would reject a real
  // one. Narrow it once upstream documents the domain.
  workflowSizeGuideline: z.string().optional(),
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
  advisorModel: z.string().optional(), // 2.1.98 — stronger model the session consults mid-turn via the advisor server tool; `/advisor <model>` persists here. Alias or full ID; pairing (advisor ≥ executor capability) is validated at runtime, and Fable-as-advisor needs 2.1.170+. See docs/agent-models.md "Advisor".
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
  blockedMarketplaces: z.array(z.string()).optional(), // marketplace IDs that users cannot install from; 2.1.223: an entry may be an owner wildcard "owner/*" matching every marketplace repo under that GitHub org
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
  strictKnownMarketplaces: z.array(z.string()).optional(), // allowlist of marketplace IDs considered trusted; 2.1.223: an entry may be an owner wildcard "owner/*" matching every marketplace repo under that GitHub org
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
  axScreenReader: z.boolean().optional(), // 2.1.208 — screen-reader mode: flat plain-text rendering without borders/animations; counterparts --ax-screen-reader flag and CLAUDE_AX_SCREEN_READER env var
  respondToBashCommands: z.boolean().optional(), // 2.1.186 — `!` bash output auto-triggers a Claude response (default true); set false to restore prior behavior
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
  vimInsertModeRemaps: z.record(z.string(), z.string()).optional(), // 2.1.208 — vim mode: map two-key insert-mode sequences (e.g. "jj") to a target; per docs "<Esc>" is the only supported target today, kept permissive
});

export type Settings = z.infer<typeof Settings>;
