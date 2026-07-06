#!/usr/bin/env bun
// Unified Handoff — port of scripts/handoff.sh. Creates/resumes session state
// at ~/.claude/handoffs/{handoff_TIMESTAMP.json,handoff_TIMESTAMP.md,latest.*}.
//
// Usage:
//   handoff.ts create [--summary "text"]
//   handoff.ts resume [id]
//   handoff.ts list
//   handoff.ts clean [keep]

import { existsSync, readFileSync } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  listArtifacts,
  pointLatest,
  readLatestTarget,
  resolveArtifact,
  timestampId,
} from "../lib/artifact-store.ts";
import { runGit } from "../lib/git.ts";
import { claudePath, isoNow } from "../lib/platform.ts";

const HANDOFF_DIR = claudePath("handoffs");

const RESOLVE_SPEC = {
  latestLink: "latest.md",
  idToName: (id: string) => `handoff_${id}.md`,
};

async function cmdCreate(args: string[]): Promise<void> {
  const flagIdx = args.findIndex((a) => a === "--summary" || a === "--message" || a === "-m");
  if (flagIdx !== -1 && args[flagIdx + 1] === undefined) {
    console.error(`Error: ${args[flagIdx]} requires a value`);
    process.exit(1);
  }
  const summary = flagIdx === -1 ? "" : (args[flagIdx + 1] ?? "");

  await mkdir(HANDOFF_DIR, { recursive: true });

  // 5-second cooldown to suppress duplicate fires.
  const latestJson = join(HANDOFF_DIR, "latest.json");
  if (existsSync(latestJson)) {
    try {
      const st = await stat(latestJson);
      const age = (Date.now() - st.mtimeMs) / 1000;
      if (age < 5) {
        console.log("");
        console.log("HANDOFF SKIPPED (cooldown)");
        console.log("------------------------------------");
        console.log(`Last handoff was ${age.toFixed(0)}s ago (< 5s cooldown).`);
        console.log("------------------------------------");
        return;
      }
    } catch {
      // ignore
    }
  }

  const ts = timestampId("", "_");
  const handoffJson = join(HANDOFF_DIR, `handoff_${ts}.json`);
  const handoffMd = join(HANDOFF_DIR, `handoff_${ts}.md`);
  const projectDir = process.cwd();
  const projectName = basename(projectDir);

  let gitBranch = "";
  let gitStatus = "";
  const gitDir = await runGit(["rev-parse", "--git-dir"]);
  if (gitDir) {
    gitBranch = await runGit(["branch", "--show-current"]);
    const statusOut = await runGit(["status", "--porcelain"]);
    gitStatus = statusOut.split("\n").slice(0, 20).join("\n");
  }
  const pendingChanges = gitStatus ? gitStatus.split("\n").filter(Boolean).length : 0;

  const json = {
    timestamp: isoNow(),
    project: { name: projectName, path: projectDir },
    git: { branch: gitBranch, pendingChanges },
    context: { summary, activeTodos: [], keyFiles: [], currentTask: "" },
    notes: "",
  };
  await writeFile(handoffJson, `${JSON.stringify(json, null, 2)}\n`);

  const md = `# Session Handoff - ${ts}

## Project
- **Name:** ${projectName}
- **Path:** ${projectDir}
- **Branch:** ${gitBranch}

## Pending Changes
\`\`\`
${gitStatus}
\`\`\`

## Session Summary
${summary || "<!-- Add summary of what was accomplished -->"}

## Active Todos
<!-- List any incomplete tasks -->

## Key Files
<!-- List important files for context -->

## Current Task
<!-- Describe what you were working on -->

## Notes for Next Session
<!-- Any important context for resuming -->

---
*Created: ${new Date().toString()}*
*Resume with: \`handoff.ts resume ${ts}\` or \`/resume-handoff ${ts}\`*
`;
  await writeFile(handoffMd, md);

  await Promise.all([
    pointLatest(HANDOFF_DIR, handoffJson, "latest.json"),
    pointLatest(HANDOFF_DIR, handoffMd, "latest.md"),
  ]);

  console.log("");
  console.log("HANDOFF CREATED");
  console.log("------------------------------------");
  console.log("");
  console.log("Files:");
  console.log(`   JSON: ${handoffJson}`);
  console.log(`   MD:   ${handoffMd}`);
  console.log("");
  console.log("Resume Command:");
  console.log(`   handoff.ts resume ${ts}`);
  console.log(`   /resume-handoff ${ts}`);
  console.log("");
  console.log("------------------------------------");
}

async function cmdResume(id: string): Promise<number> {
  const file = await resolveArtifact(HANDOFF_DIR, id, RESOLVE_SPEC);
  if (!file) {
    console.log("");
    if (id) {
      console.log("HANDOFF NOT FOUND");
      console.log("------------------------------------");
      console.log(`Handoff '${id}' not found.`);
    } else {
      console.log("NO HANDOFF FOUND");
      console.log("------------------------------------");
      console.log("No previous handoff found.");
    }
    console.log("------------------------------------");
    return 1;
  }
  console.log("");
  console.log(id ? `RESUMING SESSION: ${id}` : "RESUMING LATEST SESSION");
  console.log("------------------------------------");
  console.log("");
  console.log(readFileSync(file, "utf8"));
  console.log("");
  console.log("------------------------------------");
  return 0;
}

async function cmdList(): Promise<void> {
  console.log("");
  console.log("AVAILABLE HANDOFFS");
  console.log("------------------------------------");
  console.log("");

  if (!existsSync(HANDOFF_DIR)) {
    console.log("  (no handoffs directory)");
    console.log("------------------------------------");
    return;
  }
  const latestTarget = await readLatestTarget(HANDOFF_DIR, "latest.md");
  const entries = await listArtifacts(HANDOFF_DIR, /^handoff_.*\.md$/);
  for (const entry of entries) {
    const full = join(HANDOFF_DIR, entry);
    const id = entry.replace(/^handoff_|\.md$/g, "");
    const st = await stat(full).catch(() => null);
    const created = st ? new Date(st.mtimeMs).toISOString().slice(0, 16).replace("T", " ") : "?";
    const nameMatch = readFileSync(full, "utf8").match(/^\s*-\s*\*\*Name:\*\*\s*(.+)$/m);
    const project = nameMatch ? (nameMatch[1] ?? "").trim() : "unknown";
    const marker = entry === latestTarget ? " (latest)" : "";
    console.log(`  ${id.padEnd(20)}  ${project.padEnd(20)}  ${created}${marker}`);
  }
  if (entries.length === 0) console.log("  (no handoffs found)");
  console.log("");
  console.log("------------------------------------");
}

// Mirrors checkpoint.ts's cmdClean shape, but prunes both the .json and .md
// artifact per handoff (cleanupHandoffs in session-start.ts already does this
// on every session start with keep=20 — this is the on-demand equivalent).
// Falsy-zero guard: `clean 0` must delete everything, so `Number.isNaN` is
// used instead of `parsed || DEFAULT` (which would treat 0 as "unset").
const DEFAULT_KEEP = 20;

async function cmdClean(keepStr: string): Promise<void> {
  const parsed = Number.parseInt(keepStr, 10);
  const keep = Number.isNaN(parsed) ? DEFAULT_KEEP : parsed;

  await mkdir(HANDOFF_DIR, { recursive: true });

  const stale = async (pattern: RegExp): Promise<string[]> => {
    const names = await listArtifacts(HANDOFF_DIR, pattern);
    const entries: Array<{ file: string; mtime: number }> = [];
    for (const name of names) {
      const full = join(HANDOFF_DIR, name);
      try {
        const st = await stat(full);
        entries.push({ file: full, mtime: st.mtimeMs });
      } catch {
        // ignore
      }
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    return entries.slice(keep).map((e) => e.file);
  };

  const [jsonDrop, mdDrop] = await Promise.all([
    stale(/^handoff_.*\.json$/),
    stale(/^handoff_.*\.md$/),
  ]);
  const toDelete = [...jsonDrop, ...mdDrop];

  if (toDelete.length === 0) {
    console.log(`Nothing to clean. (keep: ${keep})`);
    return;
  }
  console.log(`Removing ${toDelete.length} old handoff files (keeping ${keep} of each type)...`);
  await Promise.all(toDelete.map((f) => unlink(f).catch(() => {})));
  console.log("Done.");
}

function cmdHelp(): void {
  console.log("");
  console.log("HANDOFF - Session State Management");
  console.log("------------------------------------");
  console.log("");
  console.log("Usage: handoff.ts <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log(`  create [--summary "text"]  Create a new handoff`);
  console.log("  resume [id]                Resume from a handoff (latest if no id)");
  console.log("  list                       List all available handoffs");
  console.log("  clean [keep]               Remove old handoffs (default: keep 20)");
  console.log("  help                       Show this help");
  console.log("");
  console.log("------------------------------------");
}

const [, , cmd = "help", ...args] = process.argv;
switch (cmd) {
  case "create":
    await cmdCreate(args);
    break;
  case "resume":
    process.exit(await cmdResume(args[0] ?? ""));
    break;
  case "list":
    await cmdList();
    break;
  case "clean":
    await cmdClean(args[0] ?? "");
    break;
  case "help":
  case "--help":
  case "-h":
    cmdHelp();
    break;
  default:
    console.log(`Unknown command: ${cmd}`);
    console.log("Run 'handoff.ts help' for usage information.");
    process.exit(1);
}
