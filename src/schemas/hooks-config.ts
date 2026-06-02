import { z } from "zod";

// Schema for `hooks-config.json` (team-default) and `hooks-config.local.json`
// (personal override, gitignored). Carries one live feature:
// `claude_md_monitor` thresholds consumed by session-start.ts.
//
// Kept as the legacy compatibility shim for pre-Phase-7 installs that still
// have a `hooks-config.json` on disk; the thresholds are also mirrored into
// `settings.json.env` as `CC_CLAUDE_MD_ENABLED`, `CC_CLAUDE_MD_WARN`,
// `CC_CLAUDE_MD_CRITICAL` for new installs.

export const ClaudeMdMonitor = z.object({
  enabled: z.boolean(),
  warn_lines: z.number().int().positive(),
  critical_lines: z.number().int().positive(),
});

export const HooksConfig = z
  .object({
    _comment: z.string().optional(),
    claude_md_monitor: ClaudeMdMonitor.optional(),
  })
  .strict();

export type HooksConfig = z.infer<typeof HooksConfig>;
