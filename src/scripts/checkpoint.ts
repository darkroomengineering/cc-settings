#!/usr/bin/env bun
// Checkpoint CLI — port of scripts/checkpoint.sh.
//
// Stores per-project checkpoints at ~/.claude/checkpoints/<project>/chk-*.json
// plus a `latest` symlink. JSON schema preserved verbatim from the bash
// version (id, timestamp, project, description, git.{branch,sha,dirty,modifiedFiles}).
//
// Usage: checkpoint.ts <save|list|show|restore|clean> [args]

import { existsSync, lstatSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir, readlink, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { palette } from "../lib/colors.ts";

async function getProjectName(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) === 0 && out) return basename(out);
  return basename(process.cwd());
}

async function runGit(args: string[]): Promise<{ exit: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = (await new Response(proc.stdout).text()).trim();
  return { exit: await proc.exited, stdout };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function checkpointId(d: Date = new Date()): string {
  return `chk-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

type Checkpoint = {
  id: string;
  timestamp: string;
  project: string;
  description: string;
  git: {
    branch: string;
    sha: string;
    dirty: boolean;
    modifiedFiles: string[];
  };
};

async function cmdSave(description = "Checkpoint"): Promise<void> {
  const project = await getProjectName();
  const checkpointDir = join(homedir(), ".claude", "checkpoints", project);
  await ensureDir(checkpointDir);
  const id = checkpointId();
  const file = join(checkpointDir, `${id}.json`);
  const [branchRes, shaRes, diffRes, filesRes] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["rev-parse", "--short", "HEAD"]),
    runGit(["diff", "--quiet"]),
    runGit(["diff", "--name-only", "HEAD"]),
  ]);
  const chk: Checkpoint = {
    id,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    project,
    description,
    git: {
      branch: branchRes.stdout || "unknown",
      sha: shaRes.stdout || "unknown",
      dirty: diffRes.exit !== 0,
      modifiedFiles: filesRes.stdout ? filesRes.stdout.split("\n").filter(Boolean) : [],
    },
  };
  await writeFile(file, `${JSON.stringify(chk, null, 2)}\n`);
  const latest = join(checkpointDir, "latest");
  try {
    await unlink(latest);
  } catch {
    // ignore
  }
  await symlink(basename(file), latest);
  console.log(`${palette.green}Checkpoint saved:${palette.reset} ${id}`);
  console.log(`${palette.cyan}Description:${palette.reset} ${description}`);
  console.log(`${palette.blue}Location:${palette.reset} ${file}`);
}

async function cmdList(): Promise<void> {
  const project = await getProjectName();
  const checkpointDir = join(homedir(), ".claude", "checkpoints", project);
  await ensureDir(checkpointDir);
  let entries: string[];
  try {
    entries = readdirSync(checkpointDir)
      .filter((e) => e.endsWith(".json"))
      .sort();
  } catch {
    entries = [];
  }
  if (entries.length === 0) {
    console.log(`${palette.yellow}No checkpoints found for project: ${project}${palette.reset}`);
    return;
  }
  console.log(`${palette.blue}Checkpoints for ${palette.cyan}${project}${palette.reset}:`);
  console.log("");
  let latestTarget = "";
  try {
    latestTarget = await readlink(join(checkpointDir, "latest"));
  } catch {
    // ignore
  }
  for (const name of entries) {
    const full = join(checkpointDir, name);
    try {
      const chk = JSON.parse(readFileSync(full, "utf8")) as Checkpoint;
      const marker = name === latestTarget ? ` ${palette.green}(latest)${palette.reset}` : "";
      console.log(
        `  ${palette.cyan}${chk.id}${palette.reset}  ${chk.timestamp}  ${chk.description}${marker}`,
      );
    } catch {
      // skip corrupt files
    }
  }
  console.log("");
}

async function resolveTarget(target: string): Promise<string | null> {
  const project = await getProjectName();
  const checkpointDir = join(homedir(), ".claude", "checkpoints", project);
  if (!target) {
    try {
      const linkTarget = await readlink(join(checkpointDir, "latest"));
      const full = join(checkpointDir, linkTarget);
      return existsSync(full) ? full : null;
    } catch {
      return null;
    }
  }
  const full = join(checkpointDir, `${target}.json`);
  return existsSync(full) ? full : null;
}

async function cmdShow(target: string): Promise<number> {
  const file = await resolveTarget(target);
  if (!file) {
    console.log(
      `${palette.red}${target ? `Checkpoint not found: ${target}` : "No latest checkpoint found."}${palette.reset}`,
    );
    return 1;
  }
  console.log(`${palette.blue}Checkpoint Details:${palette.reset}`);
  console.log(readFileSync(file, "utf8"));
  return 0;
}

async function cmdRestore(target: string): Promise<number> {
  const file = await resolveTarget(target);
  if (!file) {
    console.log(
      `${palette.red}${target ? `Checkpoint not found: ${target}` : "No latest checkpoint found."}${palette.reset}`,
    );
    return 1;
  }
  const chk = JSON.parse(readFileSync(file, "utf8")) as Checkpoint;
  console.log(`${palette.green}Restoring checkpoint:${palette.reset} ${chk.id}`);
  console.log(`${palette.cyan}Description:${palette.reset} ${chk.description}`);
  console.log(`${palette.blue}Branch:${palette.reset} ${chk.git.branch} @ ${chk.git.sha}`);
  console.log("");
  const [curBranchRes, curShaRes] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["rev-parse", "--short", "HEAD"]),
  ]);
  const curBranch = curBranchRes.stdout || "unknown";
  const curSha = curShaRes.stdout || "unknown";
  if (curBranch !== chk.git.branch) {
    console.log(
      `${palette.yellow}WARNING: Current branch (${curBranch}) differs from checkpoint (${chk.git.branch})${palette.reset}`,
    );
  }
  if (curSha !== chk.git.sha) {
    console.log(
      `${palette.yellow}WARNING: Current SHA (${curSha}) differs from checkpoint (${chk.git.sha})${palette.reset}`,
    );
  }
  console.log("");
  console.log(
    `${palette.green}Checkpoint state loaded. Review above and continue work.${palette.reset}`,
  );
  console.log(readFileSync(file, "utf8"));
  return 0;
}

async function cmdClean(keepStr: string): Promise<void> {
  const keep = Number.parseInt(keepStr, 10) || 10;
  const project = await getProjectName();
  const checkpointDir = join(homedir(), ".claude", "checkpoints", project);
  await ensureDir(checkpointDir);
  let entries: Array<{ file: string; mtime: number }>;
  try {
    entries = readdirSync(checkpointDir)
      .filter((e) => e.endsWith(".json"))
      .map((e) => {
        const full = join(checkpointDir, e);
        return { file: full, mtime: lstatSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    entries = [];
  }
  if (entries.length <= keep) {
    console.log(
      `${palette.green}Nothing to clean. ${entries.length} checkpoints (keep: ${keep}).${palette.reset}`,
    );
    return;
  }
  const toDelete = entries.slice(keep);
  console.log(
    `${palette.yellow}Removing ${toDelete.length} old checkpoints (keeping ${keep})...${palette.reset}`,
  );
  for (const e of toDelete) {
    try {
      unlinkSync(e.file);
    } catch {
      // ignore
    }
  }
  console.log(`${palette.green}Done.${palette.reset}`);
}

function usage(): void {
  console.log("Usage: checkpoint.ts <command> [args]");
  console.log("");
  console.log("Commands:");
  console.log("  save [description]   Save current state as checkpoint");
  console.log("  list                 List all checkpoints");
  console.log("  show [id]            Show checkpoint details (default: latest)");
  console.log("  restore [id]         Restore from checkpoint (default: latest)");
  console.log("  clean [keep]         Remove old checkpoints (default: keep 10)");
}

const [, , cmd = "help", ...args] = process.argv;
switch (cmd) {
  case "save":
    await cmdSave(args[0]);
    break;
  case "list":
    await cmdList();
    break;
  case "show":
    process.exit(await cmdShow(args[0] ?? ""));
    break;
  case "restore":
    process.exit(await cmdRestore(args[0] ?? ""));
    break;
  case "clean":
    await cmdClean(args[0] ?? "10");
    break;
  default:
    usage();
}

// Suppress unused-import diagnostic for `stat` (reserved for future schema check).
void stat;
