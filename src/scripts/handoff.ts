#!/usr/bin/env bun
// Unified Handoff — port of scripts/handoff.sh. Creates/resumes session state
// at ~/.claude/handoffs/<project>/{handoff_TIMESTAMP.json,handoff_TIMESTAMP.md,latest.*}.
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
  pruneArtifacts,
  readLatestTarget,
  resolveArtifact,
  timestampId,
} from "../lib/artifact-store.ts";
import { getProjectName, runGit, runProcessFull } from "../lib/git.ts";
import { parseIntArg } from "../lib/hook-config.ts";
import { readHookInput } from "../lib/hook-runtime.ts";
import { claudePath, isoNow } from "../lib/platform.ts";
import { readDigest, toProjectRelative } from "../lib/session-ledger.ts";

/** Value of a `--flag value` pair, or "" when absent. */
function argValue(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  return i === -1 ? "" : (args[i + 1] ?? "");
}

// Pre-per-project-scoping global directory. Kept as a one-time READ fallback
// (see resolveHandoffDir) so handoffs saved before this migration remain
// resumable — new handoffs are always written to the project-scoped dir.
const LEGACY_HANDOFF_DIR = claudePath("handoffs");

const RESOLVE_SPEC = {
  latestLink: "latest.md",
  idToName: (id: string) => `handoff_${id}.md`,
};

async function projectHandoffDir(): Promise<string> {
  const project = await getProjectName();
  return claudePath("handoffs", project);
}

/**
 * Directory to READ handoffs from: the project-scoped store if it exists,
 * else (migration path) the legacy global directory — so handoffs written
 * before per-project scoping remain resumable. Falls back exactly once; all
 * writes go to the project-scoped dir regardless of this fallback.
 */
async function resolveHandoffDir(): Promise<string> {
  const dir = await projectHandoffDir();
  if (existsSync(dir)) return dir;
  return existsSync(LEGACY_HANDOFF_DIR) ? LEGACY_HANDOFF_DIR : dir;
}

async function cmdCreate(args: string[]): Promise<void> {
  const flagIdx = args.findIndex((a) => a === "--summary" || a === "--message" || a === "-m");
  if (flagIdx !== -1 && args[flagIdx + 1] === undefined) {
    console.error(`Error: ${args[flagIdx]} requires a value`);
    process.exit(1);
  }
  const summary = flagIdx === -1 ? "" : (args[flagIdx + 1] ?? "");
  // No --summary means this is the hook-driven path (PreCompact/SessionEnd
  // call `create` with no flags) — mark the record so a reader can tell an
  // unattended auto-save from a deliberate manual one.
  const source = summary ? "manual" : "auto";

  // Hook metadata arrives on stdin, and ONLY when --from-hook is passed.
  // Reading stdin unconditionally would hang a manual `handoff.ts create` at
  // an interactive terminal, so the hook opts in explicitly. --session-id is
  // the same information by flag, for tests and manual reproduction.
  const sessionIdArg = argValue(args, "--session-id");
  let sessionId = sessionIdArg;
  let trigger = argValue(args, "--trigger");
  if (args.includes("--from-hook")) {
    const hook = await readHookInput<{ session_id: string; trigger: string }>({
      session_id: "CLAUDE_SESSION_ID",
    });
    if (!sessionId && typeof hook.session_id === "string") sessionId = hook.session_id;
    if (!trigger && typeof hook.trigger === "string") trigger = hook.trigger;
  }

  const handoffDir = await projectHandoffDir();
  await mkdir(handoffDir, { recursive: true });

  // 5-second cooldown to suppress duplicate fires.
  const latestJson = join(handoffDir, "latest.json");
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
  const handoffJson = join(handoffDir, `handoff_${ts}.json`);
  const handoffMd = join(handoffDir, `handoff_${ts}.md`);
  const projectDir = process.cwd();
  const projectName = basename(projectDir);

  let gitBranch = "";
  let gitStatus = "";
  let recentCommits: string[] = [];
  // rev-parse gates the rest (not-a-repo early exit) — must run first. The
  // three reads that only make sense once we know we're in a repo are
  // independent of each other, so they run as one parallel wave (mirrors
  // checkpoint.ts's performSave Promise.all shape) instead of three
  // sequential awaits on this PreCompact hot path.
  const gitDir = await runGit(["rev-parse", "--git-dir"]);
  if (gitDir) {
    const [branchOut, statusRes, logOut] = await Promise.all([
      runGit(["branch", "--show-current"]),
      // runGit trims the WHOLE output, which would eat the leading space off
      // the first porcelain line (format is `XY path`, and X is often a
      // literal space) — that shifts every downstream fixed-offset slice by
      // one character on just the first entry. runProcessFull leaves stdout
      // untouched, so the two-char status prefix stays a stable width.
      runProcessFull("git", ["status", "--porcelain"]),
      runGit(["log", "-3", "--pretty=%s"]),
    ]);
    gitBranch = branchOut;
    gitStatus = statusRes.stdout.split("\n").filter(Boolean).slice(0, 20).join("\n");
    recentCommits = logOut ? logOut.split("\n").filter(Boolean) : [];
  }
  const gitFiles = gitStatus
    ? gitStatus
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
    : [];
  const pendingChanges = gitFiles.length;

  // The session ledger is the only record of files that were edited AND
  // committed during this session — `git status` has already forgotten them.
  // Ledger paths are absolute; relativize against the repo toplevel so they
  // are directly comparable with porcelain output (always repo-root-relative).
  const digest = await readDigest(sessionId);
  const repoRoot = gitDir ? await runGit(["rev-parse", "--show-toplevel"]) : "";
  const ledgerChanged = toProjectRelative(digest.changes, repoRoot);
  const ledgerRead = toProjectRelative(digest.reads, repoRoot);

  // Key Files is the union: what is dirty right now, plus what this session is
  // observed to have changed. Order puts still-dirty files first, since those
  // are what a resuming reader has to deal with immediately.
  const modifiedFiles = [...new Set([...gitFiles, ...ledgerChanged])];

  // Best-effort content for the automatic (no --summary) path: everything
  // that CAN be derived from git without a transcript is populated here
  // (branch, modified files, recent commits, project root). activeTodos and
  // currentTask genuinely can't be derived from git state alone, so they stay
  // empty placeholders regardless of `source` — that's an honest limitation,
  // not a bug (see skills/handoff/SKILL.md "What Gets Saved").
  const json = {
    timestamp: isoNow(),
    project: { name: projectName, path: projectDir },
    git: { branch: gitBranch, pendingChanges },
    context: { summary, activeTodos: [], keyFiles: modifiedFiles, currentTask: "" },
    recentCommits,
    notes: "",
    source,
    // Provenance — how PostCompact finds THIS handoff to backfill later.
    sessionId,
    trigger,
    // Mechanically observed, kept separate from anything model-derived: these
    // are paths a tool actually touched and errors a tool actually returned.
    // `context.summary` is the only field that carries intent or rationale.
    artifacts: {
      filesModified: ledgerChanged,
      filesRead: ledgerRead,
      toolFailures: digest.failures,
    },
  };
  await writeFile(handoffJson, `${JSON.stringify(json, null, 2)}\n`);

  const keyFilesSection = modifiedFiles.length
    ? modifiedFiles.map((f) => `- ${f}`).join("\n")
    : "<!-- No uncommitted changes at save time -->";
  const recentCommitsSection = recentCommits.length
    ? recentCommits.map((c) => `- ${c}`).join("\n")
    : "<!-- No commits found -->";
  const bullets = (items: string[], empty: string) =>
    items.length ? items.map((f) => `- ${f}`).join("\n") : empty;
  const filesModifiedSection = bullets(
    ledgerChanged,
    "<!-- No file changes observed this session -->",
  );
  const filesReadSection = bullets(ledgerRead, "<!-- No file reads observed this session -->");
  const toolFailuresSection = digest.failures.length
    ? digest.failures.map((f) => `- \`${f.tool}\`: ${f.error}`).join("\n")
    : "<!-- No tool failures observed this session -->";

  const md = `# Session Handoff - ${ts}

## Project
- **Name:** ${projectName}
- **Path:** ${projectDir}
- **Branch:** ${gitBranch}
- **Source:** ${source}${source === "auto" ? " (hook-triggered, no --summary)" : ""}

## Pending Changes
\`\`\`
${gitStatus}
\`\`\`

## Session Summary
${summary || "<!-- Add summary of what was accomplished -->"}

## Active Todos
<!-- List any incomplete tasks -->

## Key Files
${keyFilesSection}

## Files Modified
<!-- Observed via the session ledger — survives commits, unlike git status -->
${filesModifiedSection}

## Files Read
${filesReadSection}

## Tool Failures
${toolFailuresSection}

## Recent Commits
${recentCommitsSection}

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
    pointLatest(handoffDir, handoffJson, "latest.json"),
    pointLatest(handoffDir, handoffMd, "latest.md"),
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
  const dir = await resolveHandoffDir();
  const file = await resolveArtifact(dir, id, RESOLVE_SPEC);
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

  const dir = await resolveHandoffDir();
  if (!existsSync(dir)) {
    console.log("  (no handoffs directory)");
    console.log("------------------------------------");
    return;
  }
  const latestTarget = await readLatestTarget(dir, "latest.md");
  const entries = await listArtifacts(dir, /^handoff_.*\.md$/);
  for (const entry of entries) {
    const full = join(dir, entry);
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
// Operates on the project-scoped dir only (the write-side store) — it does not
// reach into the legacy global dir that resolveHandoffDir() falls back to for
// reads.
const DEFAULT_KEEP = 20;

async function cmdClean(keepStr: string): Promise<void> {
  // An explicit "0" must delete everything, not silently revive DEFAULT_KEEP
  // — parseIntArg only falls back on genuine NaN.
  const keep = parseIntArg(keepStr, DEFAULT_KEEP);

  const handoffDir = await projectHandoffDir();
  await mkdir(handoffDir, { recursive: true });

  const [jsonDrop, mdDrop] = await Promise.all([
    pruneArtifacts(handoffDir, /^handoff_.*\.json$/, keep),
    pruneArtifacts(handoffDir, /^handoff_.*\.md$/, keep),
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
