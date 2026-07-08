#!/usr/bin/env bun
// Checkpoint CLI — port of scripts/checkpoint.sh.
//
// Stores per-project checkpoints at ~/.claude/checkpoints/<project>/chk-*.json
// plus a `latest` symlink. JSON schema preserved verbatim from the bash
// version (id, timestamp, project, description, git.{branch,sha,dirty,modifiedFiles}),
// extended with a sibling `chk-*.patch` file capturing `git diff HEAD` (tracked,
// staged+unstaged changes) so `restore` can perform a real rollback instead of
// just printing saved metadata. Checkpoints saved before this feature existed
// have no `hasPatch` key at all (undefined, not false) — that's how `restore`
// tells "legacy, print-only" apart from "new format, tree was clean at save time".
//
// Usage: checkpoint.ts <save|list|show|restore|clean> [args]

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
// break older readers. `hasPatch`/`patchFile`/`git.untrackedFiles` are
// `.optional()` (not `.default()`) on purpose: a checkpoint saved before this
// feature existed parses with `hasPatch === undefined`, which is exactly the
// signal `cmdRestore` uses to fall back to the legacy print-only path.
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
    untrackedFiles: z.array(z.string()).optional(),
  }),
  hasPatch: z.boolean().optional(),
  patchFile: z.string().optional(),
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

interface SaveResult {
  id: string;
  file: string;
  chk: Checkpoint;
}

/**
 * Core of `save`, shared with `restore`'s auto safety-checkpoint (a restore
 * is itself reversible only because it saves one of these before touching
 * anything). Captures git.diff HEAD as a sibling `.patch` file so a future
 * restore can reconstruct the exact working tree, not just its metadata.
 */
async function performSave(description: string): Promise<SaveResult> {
  const project = await getProjectName();
  const checkpointDir = claudePath("checkpoints", project);
  await ensureDir(checkpointDir);
  // timestampId is second-granularity — a save and a restore's safety
  // checkpoint landing in the same second would collide, and the safety save
  // would OVERWRITE the checkpoint being restored (json + patch). Suffix
  // until the filename is free.
  const baseId = timestampId("chk-", "-");
  let id = baseId;
  for (let n = 2; existsSync(join(checkpointDir, `${id}.json`)); n++) {
    id = `${baseId}-${n}`;
  }
  const file = join(checkpointDir, `${id}.json`);
  const patchFileName = `${id}.patch`;
  const [branchRes, shaRes, diffQuietRes, filesRes, diffHeadRes, untrackedRes] = await Promise.all([
    runProcessFull("git", ["branch", "--show-current"]),
    // Full sha, not --short: restore passes this to `git restore --source=`,
    // and short shas can become ambiguous as the repo grows.
    runProcessFull("git", ["rev-parse", "HEAD"]),
    runProcessFull("git", ["diff", "--quiet"]),
    runProcessFull("git", ["diff", "--name-only", "HEAD"]),
    runProcessFull("git", ["diff", "HEAD"]),
    runProcessFull("git", ["ls-files", "--others", "--exclude-standard"]),
  ]);
  // If we're in a git repo (rev-parse worked) but the patch capture itself
  // failed or timed out, refuse to write the checkpoint: a checkpoint that
  // silently missed the dirty state would let a later restore clobber
  // tracked files it never actually recorded.
  if (shaRes.exit === 0 && diffHeadRes.exit !== 0) {
    throw new Error(
      `checkpoint: git diff HEAD failed (exit ${diffHeadRes.exit}) — refusing to save a checkpoint that may not capture the working tree. ${diffHeadRes.stderr.trim()}`,
    );
  }
  const hasPatch = diffHeadRes.stdout.trim().length > 0;
  if (hasPatch) {
    await writeFile(join(checkpointDir, patchFileName), diffHeadRes.stdout);
  }
  const chk: Checkpoint = {
    id,
    timestamp: isoNow(),
    project,
    description,
    git: {
      branch: branchRes.stdout.trim() || "unknown",
      sha: shaRes.stdout.trim() || "unknown",
      dirty: diffQuietRes.exit !== 0,
      modifiedFiles: filesRes.stdout.trim()
        ? filesRes.stdout.trim().split("\n").filter(Boolean)
        : [],
      untrackedFiles: untrackedRes.stdout.trim()
        ? untrackedRes.stdout.trim().split("\n").filter(Boolean)
        : [],
    },
    hasPatch,
    ...(hasPatch ? { patchFile: patchFileName } : {}),
  };
  await writeFile(file, `${JSON.stringify(chk, null, 2)}\n`);
  await pointLatest(checkpointDir, file, "latest");
  return { id, file, chk };
}

async function cmdSave(description = "Checkpoint"): Promise<void> {
  const { id, file, chk } = await performSave(description);
  console.log(`${palette.green}Checkpoint saved:${palette.reset} ${id}`);
  console.log(`${palette.cyan}Description:${palette.reset} ${description}`);
  console.log(`${palette.blue}Location:${palette.reset} ${file}`);
  if (chk.hasPatch) {
    console.log(
      `${palette.blue}Patch:${palette.reset} ${chk.patchFile} (working-tree changes captured)`,
    );
  }
  const untracked = chk.git.untrackedFiles ?? [];
  if (untracked.length > 0) {
    console.log(
      `${palette.yellow}Note: ${untracked.length} untracked file(s) listed but not captured (content out of scope):${palette.reset}`,
    );
    for (const f of untracked) console.log(`  ${f}`);
  }
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

async function cmdRestore(target: string, opts: { force: boolean }): Promise<number> {
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
    runProcessFull("git", ["rev-parse", "HEAD"]),
  ]);
  const curBranch = curBranchRes.stdout.trim() || "unknown";
  const curSha = curShaRes.stdout.trim() || "unknown";
  const branchDiffers = curBranch !== chk.git.branch;
  // Prefix-tolerant comparison: checkpoints written before the full-sha fix
  // stored `rev-parse --short` output; treat short-vs-full of the same commit
  // as equal.
  const shaDiffers = !(curSha.startsWith(chk.git.sha) || chk.git.sha.startsWith(curSha));

  // Legacy checkpoint: saved before patch capture existed. There is nothing
  // to actually roll back to (no recorded diff), so keep the old print-only
  // behavior rather than pretend a real restore happened.
  if (chk.hasPatch === undefined) {
    if (branchDiffers) {
      console.log(
        `${palette.yellow}WARNING: Current branch (${curBranch}) differs from checkpoint (${chk.git.branch})${palette.reset}`,
      );
    }
    if (shaDiffers) {
      console.log(
        `${palette.yellow}WARNING: Current SHA (${curSha}) differs from checkpoint (${chk.git.sha})${palette.reset}`,
      );
    }
    console.log("");
    console.log(
      `${palette.yellow}Legacy checkpoint: metadata only, nothing restored.${palette.reset}`,
    );
    console.log(
      `${palette.yellow}This checkpoint predates patch capture — review the metadata below and continue manually.${palette.reset}`,
    );
    console.log(readFileSync(file, "utf8"));
    return 0;
  }

  if (branchDiffers && !opts.force) {
    console.log(
      `${palette.red}Refusing to restore: current branch (${curBranch}) differs from the checkpoint's branch (${chk.git.branch}).${palette.reset}`,
    );
    console.log(
      `${palette.yellow}Check out '${chk.git.branch}' first, or re-run with --force to restore anyway.${palette.reset}`,
    );
    return 1;
  }
  if (shaDiffers && !opts.force) {
    console.log(
      `${palette.red}Refusing to restore: current HEAD (${curSha}) differs from the checkpoint's SHA (${chk.git.sha}).${palette.reset}`,
    );
    console.log(
      `${palette.yellow}Restoring across commits can overwrite tracked file content beyond what the checkpoint recorded. Re-run with --force to proceed.${palette.reset}`,
    );
    return 1;
  }

  // Before touching anything: auto-save the CURRENT state so this restore is
  // itself reversible, even across a --force jump to a different sha/branch.
  const safety = await performSave(`Safety checkpoint before restoring ${chk.id}`);
  console.log(
    `${palette.blue}Safety checkpoint of current state saved:${palette.reset} ${safety.id}`,
  );
  console.log("");

  // Reset tracked files (worktree + index) to the checkpoint's sha. Never
  // touches untracked files — `restore .` only ever affects paths git already
  // tracks (or tracked at that source).
  const restoreRes = await runProcessFull("git", [
    "restore",
    `--source=${chk.git.sha}`,
    "--worktree",
    "--staged",
    ".",
  ]);
  if (restoreRes.exit !== 0) {
    console.log(`${palette.red}git restore failed:${palette.reset} ${restoreRes.stderr.trim()}`);
    console.log(
      `${palette.yellow}Nothing else was changed. Your prior state is safe in checkpoint ${safety.id}.${palette.reset}`,
    );
    return 1;
  }

  let patchApplied = false;
  if (chk.hasPatch) {
    const patchPath = join(dirname(file), chk.patchFile ?? `${chk.id}.patch`);
    if (!existsSync(patchPath)) {
      console.log(`${palette.red}Patch file missing:${palette.reset} ${patchPath}`);
      console.log(
        `${palette.yellow}Tracked files were reset to ${chk.git.sha}'s committed content, but the recorded working-tree changes could not be reapplied. Undo with: bun ~/.claude/src/scripts/checkpoint.ts restore ${safety.id} --force${palette.reset}`,
      );
      return 1;
    }
    const applyRes = await runProcessFull("git", ["apply", patchPath]);
    if (applyRes.exit !== 0) {
      console.log(
        `${palette.red}Failed to reapply saved working-tree changes:${palette.reset} ${applyRes.stderr.trim()}`,
      );
      console.log(
        `${palette.yellow}Tracked files were reset to ${chk.git.sha}'s committed content. Undo with: bun ~/.claude/src/scripts/checkpoint.ts restore ${safety.id} --force${palette.reset}`,
      );
      return 1;
    }
    patchApplied = true;
  }

  const untracked = chk.git.untrackedFiles ?? [];
  if (untracked.length > 0) {
    console.log(
      `${palette.yellow}Note: ${untracked.length} untracked file(s) existed at save time and were NOT restored (their content wasn't captured):${palette.reset}`,
    );
    for (const f of untracked) console.log(`  ${f}`);
    console.log("");
  }

  console.log(
    `${palette.green}Restored tracked files to checkpoint ${chk.id} (${chk.git.sha}).${palette.reset}`,
  );
  console.log(
    patchApplied
      ? `${palette.green}Reapplied the working-tree changes captured at save time.${palette.reset}`
      : `${palette.green}Checkpoint had no uncommitted changes at save time — the tree now matches ${chk.git.sha} exactly.${palette.reset}`,
  );
  console.log("");
  console.log(
    `${palette.blue}To undo this restore:${palette.reset} bun ~/.claude/src/scripts/checkpoint.ts restore ${safety.id} --force`,
  );
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
  // Per-entry catch: a single stat failure (e.g. ENOENT from a file removed by
  // a concurrent clean/save between listArtifacts' readdir and this lstatSync)
  // must only drop that one entry, not discard the whole already-enumerated
  // listing.
  const entries: Array<{ file: string; mtime: number }> = [];
  for (const name of names) {
    const full = join(checkpointDir, name);
    try {
      entries.push({ file: full, mtime: lstatSync(full).mtimeMs });
    } catch {
      // skip: vanished between readdir and stat
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
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
    // Best-effort: drop the sibling patch file too, if one was captured.
    const patchGuess = e.file.replace(/\.json$/, ".patch");
    try {
      await unlink(patchGuess);
    } catch {
      // ignore — legacy checkpoints have no patch file
    }
  }
  console.log(`${palette.green}Done.${palette.reset}`);
}

function usage(): void {
  console.log("Usage: checkpoint.ts <command> [args]");
  console.log("");
  console.log("Commands:");
  console.log("  save [description]      Save current state as checkpoint");
  console.log("  list                    List all checkpoints");
  console.log("  show [id]               Show checkpoint details (default: latest)");
  console.log("  restore [id] [--force]  Restore from checkpoint (default: latest)");
  console.log("  clean [keep]            Remove old checkpoints (default: keep 10)");
  console.log("");
  console.log("restore --force bypasses the branch/sha safety refusal. A safety");
  console.log("checkpoint of the current state is always saved before restoring.");
}

const [, , cmd = "help", ...rawArgs] = process.argv;
const force = rawArgs.includes("--force");
const args = rawArgs.filter((a) => a !== "--force");
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
    process.exit(await cmdRestore(args[0] ?? "", { force }));
    break;
  case "clean":
    await cmdClean(args[0] ?? "10");
    break;
  default:
    usage();
    process.exit(1);
}
