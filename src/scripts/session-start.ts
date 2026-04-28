#!/usr/bin/env bun
// SessionStart hook — rotate logs, clean handoffs, auto-warm TLDR, recall learnings.
// Port of scripts/session-start.sh.
//
// Hook contract: no stdin shape required, no arguments. Output goes to stdout
// for Claude Code to show; side effects touch ~/.claude/{sessions.log,
// handoffs,tldr-cache,tmp}.
//
// Phase 3 will replace the inlined hooks-config.json read with src/lib/hook-config.ts.

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
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getClaudeMdMonitor } from "../lib/hook-config.ts";
import { hasCommand } from "../lib/platform.ts";
import { projectAwareness } from "../lib/project-awareness.ts";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECT_DIR = process.cwd();
const PROJECT_NAME = basename(PROJECT_DIR);

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

async function startTldrDaemon(): Promise<void> {
  // Daemon keeps indexes in memory: ~100ms queries instead of ~30s CLI spawns.
  // Auto-rebuilds embeddings once the dirty threshold (default 20 files) is hit;
  // post-edit.ts notifies it on writes.
  const proc = Bun.spawn(["tldr", "daemon", "start", "--project", "."], {
    cwd: PROJECT_DIR,
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  void proc.exited.catch(() => {});
}

async function autoWarmTldr(): Promise<void> {
  if (!hasCommand("tldr")) return;
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
    await startTldrDaemon();
    return;
  }

  const tldrCache = join(CLAUDE_DIR, "tldr-cache", `${PROJECT_NAME}.warmed`);
  try {
    const st = await stat(tldrCache);
    const ageSec = (Date.now() - st.mtimeMs) / 1000;
    if (ageSec < 3600) {
      await startTldrDaemon();
      return;
    }
  } catch {
    // no cache yet — proceed
  }

  await mkdir(join(CLAUDE_DIR, "tldr-cache"), { recursive: true }).catch(() => {});
  await writeFile(tldrCache, "").catch(() => {});

  // Fire and forget — equivalent of `( cd "$PROJECT_DIR" && tldr warm . ) & disown`.
  // Bun.spawn default is detached enough for our purposes; we do not await.
  const proc = Bun.spawn(["tldr", "warm", "."], {
    cwd: PROJECT_DIR,
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  // After warming completes, start the daemon and log; both non-blocking.
  void (async () => {
    try {
      await proc.exited;
      const ts = formatDate(new Date());
      await appendFile(
        join(CLAUDE_DIR, "sessions.log"),
        `${ts} - TLDR warmed: ${PROJECT_NAME}\n`,
      ).catch(() => {});
      await startTldrDaemon();
    } catch {
      // ignore
    }
  })();
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

const logRotations = [
  rotateLog(join(CLAUDE_DIR, "sessions.log")),
  rotateLog(join(CLAUDE_DIR, "hooks.log")),
  rotateLog(join(CLAUDE_DIR, "safety-net.log")),
  rotateLog(join(CLAUDE_DIR, "logs", "tool-failures.log")),
];
const handoffCleanup = cleanupHandoffs(join(CLAUDE_DIR, "handoffs"), 20);

// --- Phase 2: wait for sessions.log rotation, then log session start ------

await logRotations[0];
await appendFile(
  join(CLAUDE_DIR, "sessions.log"),
  `${formatDate(new Date())} - Session started in ${PROJECT_DIR}\n`,
).catch(() => {});

// --- Phase 3: fire-and-forget TLDR warming -------------------------------

await autoWarmTldr();

// --- Phase 4: wait for remaining background tasks ------------------------

await Promise.all([...logRotations.slice(1), handoffCleanup]);

// --- Phase 5: display output ----------------------------------------------

// Learnings
const learningsBase = join(CLAUDE_DIR, "learnings");
const learningsFile = join(learningsBase, PROJECT_NAME, "learnings.json");
if (existsSync(learningsFile)) {
  try {
    const parsed = JSON.parse(await readFile(learningsFile, "utf8")) as {
      learnings?: Array<{ timestamp?: string; category?: string; learning?: string }>;
    };
    const entries = parsed.learnings ?? [];
    let totalProjects = 0;
    try {
      const dirents = await readdir(learningsBase, { withFileTypes: true });
      totalProjects = dirents.filter((d) => d.isDirectory()).length;
    } catch {
      // leave 0
    }
    if (entries.length > 0) {
      console.log("");
      console.log("MEMORY SYSTEM ACTIVE");
      console.log("------------------------------------");
      console.log("");
      console.log(`Project: ${PROJECT_NAME}`);
      console.log(
        `Learnings: ${entries.length} for this project (${totalProjects} projects tracked)`,
      );
      console.log("");
      console.log("Recent learnings:");
      const recent = [...entries]
        .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
        .slice(0, 3);
      for (const e of recent) console.log(`  - [${e.category ?? "?"}] ${e.learning ?? ""}`);
      console.log("");
      console.log("Run: bun src/scripts/learning.ts recall");
      console.log("------------------------------------");
    }
  } catch {
    // malformed learnings file — same as bash jq fallback: skip
  }
}

// TLDR status
if (hasCommand("tldr")) {
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
  const monitor = getClaudeMdMonitor();
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
