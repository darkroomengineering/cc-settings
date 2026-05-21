#!/usr/bin/env bun
/**
 * new-skill — scaffold a new cc-settings skill
 *
 * Usage: bun src/scripts/new-skill.ts <skill-name>
 *
 * Creates skills/<name>/SKILL.md with starter frontmatter.
 * See docs/skill-authoring.md for full authoring guide.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function usage(): never {
  console.error("Usage: bun src/scripts/new-skill.ts <skill-name>");
  console.error("  skill-name must be kebab-case (e.g. my-skill)");
  process.exit(1);
}

function main() {
  const name = process.argv[2];

  if (!name) {
    console.error("Error: skill name is required");
    usage();
  }

  if (!NAME_PATTERN.test(name)) {
    console.error(
      `Error: skill name "${name}" is invalid. Must match ^[a-z0-9][a-z0-9-]*$ (kebab-case, no uppercase, no special chars)`,
    );
    process.exit(1);
  }

  // Locate the repo root (where this script lives two levels up)
  const repoRoot = join(import.meta.dir, "..", "..");
  const skillDir = join(repoRoot, "skills", name);

  if (existsSync(skillDir)) {
    console.error(`Error: skills/${name}/ already exists. Choose a different name or edit the existing skill.`);
    process.exit(1);
  }

  const skillMd = `---
name: ${name}
description: "TODO: describe what this skill does and when it triggers (min 50 chars). Include trigger phrases."
context: fork
---

# ${name}

TODO: write the skill body here.

See \`docs/skill-authoring.md\` for structure guidance, frontmatter rules, and review checklist.
`;

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

  console.log(`Created skills/${name}/SKILL.md`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit skills/${name}/SKILL.md — write the description (trigger phrases) and body`);
  console.log('  2. bun run lint:skills          — validate frontmatter (0 errors required)');
  console.log('  3. Add to MANAGED_SKILLS in src/setup.ts (alphabetical order)');
  console.log('  4. Add a row to MANUAL.md in the appropriate section and the "All Skills" table');
  console.log('  5. bun test && bun run typecheck — verify nothing broke');
}

main();
