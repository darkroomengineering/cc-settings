#!/usr/bin/env bun
// Unified Handoff — port of scripts/handoff.sh. Creates/resumes session state
// at ~/.claude/handoffs/{handoff_TIMESTAMP.json,handoff_TIMESTAMP.md,latest.*}.
//
// Usage:
//   handoff.ts create [--summary "text"]
//   handoff.ts resume [id]
//   handoff.ts list

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readlink, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { runGit } from "../lib/git.ts";

const HANDOFF_DIR = join(homedir(), ".claude", "handoffs");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function cmdCreate(args: string[]): Promise<void> {
  let summary = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--summary" || a === "--message" || a === "-m") {
      const next = args[i + 1];
      if (next === undefined) {
        console.error(`Error: ${a} requires a value`);
        process.exit(1);
      }
      summary = next;
      i++;
    }
  }

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

  const ts = timestamp();
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
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
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

  for (const [sym, target] of [
    [join(HANDOFF_DIR, "latest.json"), basename(handoffJson)],
    [join(HANDOFF_DIR, "latest.md"), basename(handoffMd)],
  ] as const) {
    try {
      await unlink(sym);
    } catch {
      // ignore
    }
    await symlink(target, sym);
  }

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
  if (!id) {
    const latestMd = join(HANDOFF_DIR, "latest.md");
    if (!existsSync(latestMd)) {
      console.log("");
      console.log("NO HANDOFF FOUND");
      console.log("------------------------------------");
      console.log("No previous handoff found.");
      console.log("------------------------------------");
      return 1;
    }
    console.log("");
    console.log("RESUMING LATEST SESSION");
    console.log("------------------------------------");
    console.log("");
    console.log(readFileSync(latestMd, "utf8"));
    console.log("");
    console.log("------------------------------------");
    return 0;
  }
  const file = join(HANDOFF_DIR, `handoff_${id}.md`);
  if (!existsSync(file)) {
    console.log("");
    console.log("HANDOFF NOT FOUND");
    console.log("------------------------------------");
    console.log(`Handoff '${id}' not found.`);
    console.log("------------------------------------");
    return 1;
  }
  console.log("");
  console.log(`RESUMING SESSION: ${id}`);
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
  let latestTarget = "";
  try {
    latestTarget = await readlink(join(HANDOFF_DIR, "latest.md"));
  } catch {
    // ignore
  }
  const entries = readdirSync(HANDOFF_DIR)
    .filter((e) => /^handoff_.*\.md$/.test(e))
    .sort();
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
