#!/usr/bin/env bun
/**
 * new-note — scaffold a new team-knowledge note
 *
 * Usage: bun src/scripts/new-note.ts <name> <kind> [--dir <path>]
 *
 * Creates <name>.md with starter frontmatter and body template.
 * kind must be one of: decision | convention | gotcha | incident | pattern
 * Target dir defaults to KNOWLEDGE_REPO_PATH env var if --dir is not given.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const VALID_KINDS = ["decision", "convention", "gotcha", "incident", "pattern"] as const;
type KnowledgeKind = (typeof VALID_KINDS)[number];

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function usage(): never {
  console.error("Usage: bun src/scripts/new-note.ts <name> <kind> [--dir <path>]");
  console.error(`  name  — kebab-case slug (e.g. use-rsc-for-data-fetching)`);
  console.error(`  kind  — one of: ${VALID_KINDS.join(" | ")}`);
  console.error(`  --dir — target directory (or set KNOWLEDGE_REPO_PATH)`);
  process.exit(1);
}

function getGitUserName(): string {
  try {
    const result = Bun.spawnSync(["git", "config", "user.name"]);
    if (result.exitCode === 0) {
      const name = new TextDecoder().decode(result.stdout).trim();
      if (name) return name;
    }
  } catch {
    // fall through
  }
  return process.env.USER ?? "unknown";
}

function parseArgs(): { name: string; kind: KnowledgeKind; dir: string | null } {
  const args = process.argv.slice(2);

  const dirIdx = args.indexOf("--dir");
  let dir: string | null = null;
  if (dirIdx !== -1) {
    dir = args[dirIdx + 1] ?? null;
    args.splice(dirIdx, 2);
  }

  const [name, kind] = args;
  return { name: name ?? "", kind: (kind ?? "") as KnowledgeKind, dir };
}

function main() {
  const { name, kind, dir: dirFlag } = parseArgs();

  if (!name) {
    console.error("Error: note name is required");
    usage();
  }

  if (!NAME_PATTERN.test(name)) {
    console.error(`Error: name "${name}" is invalid. Must be kebab-case (a-z, 0-9, hyphens only).`);
    process.exit(1);
  }

  if (!kind) {
    console.error("Error: kind is required");
    usage();
  }

  if (!VALID_KINDS.includes(kind as KnowledgeKind)) {
    console.error(`Error: kind "${kind}" is invalid. Must be one of: ${VALID_KINDS.join(", ")}`);
    process.exit(1);
  }

  const envPath = process.env.KNOWLEDGE_REPO_PATH;
  if (!dirFlag && !envPath) {
    console.error("Error: no target directory. Pass --dir <path> or set KNOWLEDGE_REPO_PATH.");
    process.exit(1);
  }

  const targetDir = resolve(dirFlag ?? (envPath as string));
  const outPath = join(targetDir, `${name}.md`);

  if (existsSync(outPath)) {
    console.error(
      `Error: ${outPath} already exists. Choose a different name or edit the existing note.`,
    );
    process.exit(1);
  }

  const addedBy = getGitUserName();

  const content = `---
name: ${name}
kind: ${kind}
tags: []
added-by: ${addedBy}
---

## What

TODO: describe what this note is about.

## Why

TODO: explain the reasoning or motivation.

## How to apply

TODO: describe how to put this knowledge into practice.
`;

  writeFileSync(outPath, content, "utf-8");

  console.log(`Created ${outPath}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit ${outPath} — fill in What / Why / How to apply`);
  console.log("  2. bun run lint:knowledge <dir>  — validate (0 errors required)");
  console.log("  3. git add, commit, and push");
}

main();
