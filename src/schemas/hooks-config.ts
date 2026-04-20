import { z } from "zod";

// Schema for `hooks-config.json` (team-default) and `hooks-config.local.json`
// (personal override, gitignored). As of the Phase -1 deslop, the file has one
// live feature: `claude_md_monitor` thresholds consumed by session-start.sh.
//
// **Decision (Phase 1, ~/Desktop/cc-settings-MIGRATION.md Appendix A #5):**
// This file is *targeted for removal* in Phase 4. The three thresholds fold
// into `settings.json.env` as `CC_CLAUDE_MD_ENABLED`, `CC_CLAUDE_MD_WARN`,
// `CC_CLAUDE_MD_CRITICAL`. Phase 1 keeps the schema so the existing file
// parses cleanly; Phase 4 drops the file when session-start.ts lands.

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
