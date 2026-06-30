#!/usr/bin/env bun
// SessionStart hook — rotate logs, clean handoffs, auto-warm TLDR, pointer to auto-memory.
// Port of scripts/session-start.sh.
//
// Hook contract: no stdin shape required, no arguments. Output goes to stdout
// for Claude Code to show; side effects touch ~/.claude/{sessions.log,
// handoffs,tldr-cache,tmp}.

import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { type EngineDescriptor, resolveEngine } from "../lib/code-intel-engine.ts";
import { runGit } from "../lib/git.ts";
import { getClaudeMdMonitor } from "../lib/hook-config.ts";
import { readState, writeState } from "../lib/hook-runtime.ts";
import { CLAUDE_DIR, hasCommand, localDatetime } from "../lib/platform.ts";
import { projectAwareness } from "../lib/project-awareness.ts";
import { onHeadObserved, type ReviewQueueState } from "../lib/review-queue.ts";
import { teamKnowledgeAwareness } from "../lib/team-knowledge.ts";
import { computeDrift, readPackagedVersion, readSentinelInfo } from "../lib/version-delta.ts";

const PROJECT_DIR = process.cwd();
const PROJECT_NAME = basename(PROJECT_DIR);

// Resolve the active code-intel engine once (env > sentinel > default). Drives
// the daemon/warm helpers and the status line below. Default is "llm-tldr", so
// behavior is unchanged unless CC_CODE_INTEL_ENGINE / the sentinel says otherwise.
const engine = await resolveEngine(CLAUDE_DIR);

// --- Helpers --------------------------------------------------------------

async function rotateLog(logPath: string, maxSize = 1_048_576): Promise<void> {
  try {
    const st = await stat(logPath);
    if (st.size > maxSize) await rename(logPath, `${logPath}.old`);
  } catch {
    // missing or stat fails — no rotation.
  }
}

async function cleanupHandoffs(dir: string, keep = 20): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const prune = async (pattern: RegExp) => {
    const matches: Array<{ full: string; mtime: number }> = [];
    for (const name of entries) {
      if (!pattern.test(name)) continue;
      const full = join(dir, name);
      try {
        const st = await stat(full);
        matches.push({ full, mtime: st.mtimeMs });
      } catch {
        // ignore
      }
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    const toDrop = matches.slice(keep);
    await Promise.all(toDrop.map((m) => unlink(m.full).catch(() => {})));
  };
  await Promise.all([prune(/^handoff_.*\.json$/), prune(/^handoff_.*\.md$/)]);
}

// ~/.claude/session-titles/ gains one .flag file per titled session (written
// by session-title.ts) and otherwise grows unboundedly. Prune flags older
// than maxAgeDays — same mtime pattern as cleanupHandoffs, fail-soft.
async function pruneSessionTitles(dir: string, maxAgeDays = 30): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  await Promise.all(
    entries.map(async (name) => {
      if (!name.endsWith(".flag")) return;
      const full = join(dir, name);
      try {
        const st = await stat(full);
        if (st.mtimeMs < cutoffMs) await unlink(full);
      } catch {
        // ignore
      }
    }),
  );
}

async function startEngineDaemon(eng: EngineDescriptor): Promise<void> {
  // Daemon keeps indexes in memory: ~100ms queries instead of ~30s CLI spawns.
  // Auto-rebuilds embeddings once the dirty threshold (default 20 files) is hit;
  // post-edit.ts notifies it on writes. Only engines that declare a daemon verb
  // reach here (gated by the caller); guard the verb for the type checker.
  const daemonVerb = eng.cli.verbMap.daemon;
  if (!daemonVerb) return;
  const proc = Bun.spawn([eng.cli.command, daemonVerb, "start", "--project", "."], {
    cwd: PROJECT_DIR,
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  void proc.exited.catch(() => {});
}

async function autoWarmEngine(eng: EngineDescriptor): Promise<void> {
  // Native (and any non-daemon) engine has no index to warm or daemon to start.
  if (!eng.cli.supportsDaemon || !hasCommand(eng.cli.command)) return;
  const markers = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
    "Makefile",
    ".git",
  ];
  if (!markers.some((m) => existsSync(join(PROJECT_DIR, m)))) return;

  const tldrIndex = join(PROJECT_DIR, ".tldr");
  // Index already exists — skip warming, but still ensure the daemon is up.
  if (existsSync(tldrIndex)) {
    await startEngineDaemon(eng);
    return;
  }

  const tldrCache = join(CLAUDE_DIR, "tldr-cache", `${PROJECT_NAME}.warmed`);
  try {
    const st = await stat(tldrCache);
    const ageSec = (Date.now() - st.mtimeMs) / 1000;
    if (ageSec < 3600) {
      await startEngineDaemon(eng);
      return;
    }
  } catch {
    // no cache yet — proceed
  }

  await mkdir(join(CLAUDE_DIR, "tldr-cache"), { recursive: true }).catch(() => {});
  await writeFile(tldrCache, "").catch(() => {});

  // No warm verb declared — start the daemon directly without a warm pass.
  const warmVerb = eng.cli.verbMap.warm;
  if (!warmVerb) {
    await startEngineDaemon(eng);
    return;
  }

  // Fire and forget — equivalent of `( cd "$PROJECT_DIR" && tldr warm . ) & disown`.
  // Bun.spawn default is detached enough for our purposes; we do not await.
  const proc = Bun.spawn([eng.cli.command, warmVerb, "."], {
    cwd: PROJECT_DIR,
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  // After warming completes, start the daemon and log; both non-blocking.
  void (async () => {
    try {
      await proc.exited;
      const ts = localDatetime();
      await appendFile(
        join(CLAUDE_DIR, "sessions.log"),
        `${ts} - ${eng.id} warmed: ${PROJECT_NAME}\n`,
      ).catch(() => {});
      await startEngineDaemon(eng);
    } catch {
      // ignore
    }
  })();
}

// --- Phase 1: background tasks --------------------------------------------

// Clean per-session temp files from the previous session.
await Promise.all(
  [
    join(CLAUDE_DIR, "tmp", "tool-failure-counts"),
    join(CLAUDE_DIR, "tmp", "heavy-skill-active"),
  ].map((p) => unlink(p).catch(() => {})),
);

// Prune stale entries from the MCP needs-auth cache so OAuth servers whose
// tokens have since refreshed can reconnect. See prune-mcp-auth-cache.ts.
const mcpPrune = Bun.spawn(["bun", join(CLAUDE_DIR, "src", "scripts", "prune-mcp-auth-cache.ts")], {
  stdout: "ignore",
  stderr: "ignore",
});
mcpPrune.unref?.();

// Warm the team-knowledge TTL cache in the background. The TTL gate inside
// refreshKnowledgeIndex means this only calls `gh api` when the cache is stale
// (>6h), so spawning it every session is cheap.
const knowledgeRefresh = Bun.spawn(
  ["bun", join(CLAUDE_DIR, "src", "scripts", "refresh-knowledge-index.ts")],
  {
    stdout: "ignore",
    stderr: "ignore",
  },
);
knowledgeRefresh.unref?.();

const logRotations = [
  rotateLog(join(CLAUDE_DIR, "sessions.log")),
  rotateLog(join(CLAUDE_DIR, "hooks.log")),
  rotateLog(join(CLAUDE_DIR, "safety-net.log")),
  rotateLog(join(CLAUDE_DIR, "logs", "tool-failures.log")),
];
const handoffCleanup = cleanupHandoffs(join(CLAUDE_DIR, "handoffs"), 20);
const sessionTitlePrune = pruneSessionTitles(join(CLAUDE_DIR, "session-titles"), 30);

// --- Phase 2: wait for sessions.log rotation, then log session start ------

await logRotations[0];
await appendFile(
  join(CLAUDE_DIR, "sessions.log"),
  `${localDatetime()} - Session started in ${PROJECT_DIR}\n`,
).catch(() => {});

// --- Phase 3: fire-and-forget code-intel engine warming ------------------

await autoWarmEngine(engine);

// --- Phase 4: wait for remaining background tasks ------------------------

await Promise.all([...logRotations.slice(1), handoffCleanup, sessionTitlePrune]);

// --- Phase 5: display output ----------------------------------------------

// Auto-memory pointer (local tier retired in v11.1.0; auto-memory is the active store)
console.log("");
console.log("Auto-memory: say 'remember X' — saved to ~/.claude/projects/<hash>/memory/");

// Shared team-knowledge corpus awareness (read counterpart to /share-learning).
// Silent unless $KNOWLEDGE_REPO_PATH points at a non-empty local clone.
for (const l of await teamKnowledgeAwareness()) console.log(l);

// Code-intel engine status — engine-aware. The native engine has no index to
// warm; a daemon-backed engine reports index/warming state as before.
if (engine.id === "native-ts") {
  console.log("");
  console.log("Native TS codemap ready (TypeScript/JavaScript)");
} else if (engine.cli.supportsDaemon && hasCommand(engine.cli.command)) {
  console.log("");
  if (existsSync(join(PROJECT_DIR, ".tldr"))) {
    console.log("TLDR index available for semantic search");
  } else {
    console.log("TLDR warming in background (semantic search coming soon)");
  }
}

// Project context — git branch, local standards (AGENTS.md / CLAUDE.md / rules/ / .claude/),
// and recent commits. Surfaces local coding standards at session open.
for (const l of await projectAwareness(PROJECT_DIR)) console.log(l);

// CLAUDE.md size monitoring (thresholds read via hook-config lib).
const claudeMd = join(CLAUDE_DIR, "CLAUDE.md");
if (existsSync(claudeMd)) {
  const monitor = await getClaudeMdMonitor();
  if (monitor.enabled) {
    try {
      const text = await readFile(claudeMd, "utf8");
      const lineCount = text.split("\n").length - 1; // bash `wc -l` counts newlines
      if (lineCount > monitor.criticalLines) {
        console.log("");
        console.log(
          `WARNING: CLAUDE.md is ${lineCount} lines (critical threshold). Adherence may degrade. Run: wc -l ~/.claude/CLAUDE.md`,
        );
      } else if (lineCount > monitor.warnLines) {
        console.log("");
        console.log(
          `WARNING: CLAUDE.md is ${lineCount} lines (recommended: <${monitor.warnLines}). Consider moving sections to rules/ or profiles/.`,
        );
      }
    } catch {
      // unreadable CLAUDE.md — skip
    }
  }
}

// cc-settings install-staleness check, cached for the statusline (which can't
// compute it on the hot path from an arbitrary cwd). Compares the installed
// sentinel version against the repo's packaged VERSION and writes a flag the
// statusline reads. Fail-soft: any problem ⇒ not stale, so this never disrupts
// session start.
try {
  const { version: installed, repoPath } = await readSentinelInfo(CLAUDE_DIR);
  const packaged = await readPackagedVersion(repoPath);
  await writeState("version-drift.json", computeDrift(installed, packaged));
} catch {
  // never let the drift check disrupt session start
}

// Review-queue HEAD reconcile: if committed work advanced since the queue was
// last touched (a commit in another terminal, a fast-forward pull, a pulled-down
// PR merge), drain it — the commit-based drain in tool-cadence.ts can't
// see commits Claude didn't run. Only runs git when there's a non-empty queue to
// avoid a rev-parse on every session start. Fail-soft: any problem ⇒ untouched.
try {
  const rq = await readState<ReviewQueueState>("review-queue.json", { awaiting: 0 });
  if (rq.awaiting > 0) {
    const head = (await runGit(["rev-parse", "HEAD"], { cwd: PROJECT_DIR })).trim() || undefined;
    await writeState("review-queue.json", onHeadObserved(rq, head));
  }
} catch {
  // never let the reconcile disrupt session start
}
