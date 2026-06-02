// Canonical list of cc-settings-managed skill directories.
//
// "Managed" means: the installer is allowed to wipe and re-write these on every
// install. Hand-authored skills outside this list are preserved.
//
// The list is split into two sections:
//   1. Currently shipped skills — present in skills/<name>/SKILL.md, installed
//      to ~/.claude/skills/<name>/
//   2. Upgrade-cleanup tombstones — names of skills that were removed in prior
//      releases. Kept here so re-install on an older user prunes the obsolete
//      directories from ~/.claude/skills/. Do not remove tombstones; they are
//      load-bearing for upgrades. When promoting a tombstone (renaming back
//      into active use is rare), move it to the active section.
//
// Imported by:
//   - src/setup.ts            — to know what to wipe + reinstall
//   - src/lib/status.ts       — to compute present/missing for `cc status`
//
// Previously duplicated across both files; the duplication caused real drift
// risk (every new skill required edits in two places).
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
  "nuclear-review",
  "oracle",
  "orchestrate",
  "plan-feature",
  "project",
  "qa",
  "refactor",
  "review",
  "share-learning",
  "ship",
  "test",
  "tldr",
  "verify",
  "zero-tech-debt",
  // Kept for upgrade cleanup only — these skills were removed and must be wiped on re-install.
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
  "tdd",
  "teams",
  "versions",
  "write-a-skill",
  "zoom-out",
];
