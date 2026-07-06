#!/usr/bin/env bun
// Checkpoint CLI — port of scripts/checkpoint.sh.
//
// Stores per-project checkpoints at ~/.claude/checkpoints/<project>/chk-*.json
// plus a `latest` symlink. JSON schema preserved verbatim from the bash
// version (id, timestamp, project, description, git.{branch,sha,dirty,modifiedFiles}).
//
// Usage: checkpoint.ts <save|list|show|restore|clean> [args]

import { lstatSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  listArtifacts,
  pointLatest,
  readLatestTarget,
  resolveArtifact,
  timestampId,
} from "../lib/artifact-store.ts";
import { palette } from "../lib/colors.ts";
import { runGit, runProcessFull } from "../lib/git.ts";
import { claudePath, isoNow } from "../lib/platform.ts";

async function getProjectName(): Promise<string> {
  const out = await runGit(["rev-parse", "--show-toplevel"]);
  return out ? basename(out) : basename(process.cwd());
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// Checkpoint files live under the user's home and can be hand-edited —
// validate on read instead of trusting a cast. Loose so future fields don't
// break older readers.
const CheckpointSchema = z.looseObject({
  id: z.string(),
  timestamp: z.string(),
  project: z.string(),
  description: z.string(),
  git: z.looseObject({
    branch: z.string(),
    sha: z.string(),
    dirty: z.boolean(),
    modifiedFiles: z.array(z.string()),
  }),
});
type Checkpoint = z.infer<typeof CheckpointSchema>;

/** Parse + validate a checkpoint file. Null on malformed JSON or bad shape. */
function readCheckpoint(file: string): Checkpoint | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const result = CheckpointSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const RESOLVE_SPEC = {
  latestLink: "latest",
  idToName: (id: string) => `${id}.json`,
};

async function cmdSave(description = "Checkpoint"): Promise<void> {
  const project = await getProjectName();
  const checkpointDir = claudePath("checkpoints", project);
  await ensureDir(checkpointDir);
  const id = timestampId("chk-", "-");
  const file = join(checkpointDir, `${id}.json`);
  const [branchRes, shaRes, diffRes, filesRes] = await Promise.all([
    runProcessFull("git", ["branch", "--show-current"]),
    runProcessFull("git", ["rev-parse", "--short", "HEAD"]),
    runProcessFull("git", ["diff", "--quiet"]),
    runProcessFull("git", ["diff", "--name-only", "HEAD"]),
  ]);
  const chk: Checkpoint = {
    id,
    timestamp: isoNow(),
    project,
    description,
    git: {
      branch: branchRes.stdout.trim() || "unknown",
      sha: shaRes.stdout.trim() || "unknown",
      dirty: diffRes.exit !== 0,
      modifiedFiles: filesRes.stdout.trim()
        ? filesRes.stdout.trim().split("\n").filter(Boolean)
        : [],
    },
  };
  await writeFile(file, `${JSON.stringify(chk, null, 2)}\n`);
  await pointLatest(checkpointDir, file, "latest");
  console.log(`${palette.green}Checkpoint saved:${palette.reset} ${id}`);
  console.log(`${palette.cyan}Description:${palette.reset} ${description}`);
  console.log(`${palette.blue}Location:${palette.reset} ${file}`);
}

async function cmdList(): Promise<void> {
  const project = await getProjectName();
  const checkpointDir = claudePath("checkpoints", project);
  await ensureDir(checkpointDir);
  const entries = await listArtifacts(checkpointDir, /\.json$/);
  if (entries.length === 0) {
    console.log(`${palette.yellow}No checkpoints found for project: ${project}${palette.reset}`);
    return;
  }
  console.log(`${palette.blue}Checkpoints for ${palette.cyan}${project}${palette.reset}:`);
  console.log("");
  const latestTarget = await readLatestTarget(checkpointDir, "latest");
  for (const name of entries) {
    const chk = readCheckpoint(join(checkpointDir, name));
    if (!chk) continue; // skip corrupt files
    const marker = name === latestTarget ? ` ${palette.green}(latest)${palette.reset}` : "";
    console.log(
      `  ${palette.cyan}${chk.id}${palette.reset}  ${chk.timestamp}  ${chk.description}${marker}`,
    );
  }
  console.log("");
}

async function resolveTarget(target: string): Promise<string | null> {
  const project = await getProjectName();
  const checkpointDir = claudePath("checkpoints", project);
  return resolveArtifact(checkpointDir, target, RESOLVE_SPEC);
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
  const chk = readCheckpoint(file);
  if (!chk) {
    console.log(`${palette.red}Malformed checkpoint file: ${file}${palette.reset}`);
    console.log(
      `${palette.yellow}Expected JSON with id, timestamp, project, description, and git fields. Was it hand-edited?${palette.reset}`,
    );
    return 1;
  }
  console.log(`${palette.green}Restoring checkpoint:${palette.reset} ${chk.id}`);
  console.log(`${palette.cyan}Description:${palette.reset} ${chk.description}`);
  console.log(`${palette.blue}Branch:${palette.reset} ${chk.git.branch} @ ${chk.git.sha}`);
  console.log("");
  const [curBranchRes, curShaRes] = await Promise.all([
    runProcessFull("git", ["branch", "--show-current"]),
    runProcessFull("git", ["rev-parse", "--short", "HEAD"]),
  ]);
  const curBranch = curBranchRes.stdout.trim() || "unknown";
  const curSha = curShaRes.stdout.trim() || "unknown";
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
  // `|| 10` would misread an explicit "0" (delete all checkpoints) as unset,
  // silently reviving the default of 10. Only NaN (unparseable) falls back.
  const parsedKeep = Number.parseInt(keepStr, 10);
  const keep = Number.isNaN(parsedKeep) ? 10 : parsedKeep;
  const project = await getProjectName();
  const checkpointDir = claudePath("checkpoints", project);
  await ensureDir(checkpointDir);
  const names = await listArtifacts(checkpointDir, /\.json$/);
  let entries: Array<{ file: string; mtime: number }>;
  try {
    entries = names
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
      await unlink(e.file);
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
