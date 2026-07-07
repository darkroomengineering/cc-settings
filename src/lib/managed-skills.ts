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
//   - src/lib/lint-skills.ts  — to assert ACTIVE_SKILLS matches skills/ on disk
//
// Previously duplicated across both files; the duplication caused real drift
// risk (every new skill required edits in two places).
//
// INVARIANT: ACTIVE_SKILLS must list exactly the directories under skills/.
// lint-skills enforces this — a skill added to skills/ without an ACTIVE_SKILLS
// entry fails `bun run lint:skills`. (This replaces the old installer-side prune
// loop that re-read skills/ directly to cover the gap; the gap is now a lint
// error instead of silent install drift.)

/** Currently shipped skills — present in skills/<name>/SKILL.md, installed to
 *  ~/.claude/skills/<name>/. Keep in sync with the skills/ directory. */
export const ACTIVE_SKILLS = [
  "adversarial-audit",
  "autoresearch",
  "build",
  "cc",
  "checkpoint",
  "codex",
  "component",
  "consolidate",
  "context-doc",
  "design-tokens",
  "dr-init",
  "explore",
  "fix",
  "freeze",
  "handoff",
  "harvest",
  "hook",
  "lighthouse",
  "nuclear-review",
  "oracle",
  "orchestrate",
  "plan-ceo-review",
  "plan-feature",
  "project",
  "proof-of-work",
  "qa",
  "refactor",
  "retro",
  "review",
  "review-batch",
  "share-learning",
  "ship",
  "strategist",
  "test",
  "tldr",
  "verify",
  "zero-tech-debt",
];

/** Upgrade-cleanup tombstones — skills removed in prior releases. Kept so a
 *  re-install on an older user prunes the obsolete directories. Do not remove;
 *  they are load-bearing for upgrades. When reviving one, move it to
 *  ACTIVE_SKILLS and recreate its skills/<name>/ directory. */
export const TOMBSTONE_SKILLS = [
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

/** Everything the installer may wipe + reinstall: active skills plus tombstones
 *  to prune. Consumers that only care about the wipe set use this. */
export const MANAGED_SKILLS = [...ACTIVE_SKILLS, ...TOMBSTONE_SKILLS];
