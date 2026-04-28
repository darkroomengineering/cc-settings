#!/usr/bin/env bun
// Statusline hook — port of scripts/statusline.sh.
// Reads statusline payload JSON from stdin, writes a single status line to
// stdout. Budget p95 < 100ms (bash baseline ~104ms → TS target ~20ms).

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { readStdin } from "../lib/io.ts";

type Payload = {
  model?: { display_name?: string };
  workspace?: { current_dir?: string };
  context_window?: {
    used_percentage?: number;
    context_window_size?: number;
  };
  rate_limits?: {
    five_hour?: {
      used_percentage?: number;
      resets_at?: string;
    };
  };
  // 2.1.119 — effort level + thinking flag are now in statusline stdin.
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
};

function formatTokens(n: number): string {
  if (n > 500_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, "--no-optional-locks", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function buildGitStatus(cwd: string): Promise<string | null> {
  if (!existsSync(cwd)) return null;
  // Fast existence check — avoid spawning if not a repo.
  const probe = Bun.spawn(["git", "-C", cwd, "rev-parse", "--git-dir"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await probe.exited) !== 0) return null;

  const branch = await runGit(["branch", "--show-current"], cwd);
  if (!branch) return null;

  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";

  // Dirty check — two spawns can run in parallel.
  const [dirtyUnstaged, dirtyStaged] = await Promise.all([
    Bun.spawn(["git", "-C", cwd, "--no-optional-locks", "diff", "--quiet"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited,
    Bun.spawn(["git", "-C", cwd, "--no-optional-locks", "diff", "--cached", "--quiet"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited,
  ]);
  const dirty = dirtyUnstaged !== 0 || dirtyStaged !== 0 ? `${yellow}✱${reset}` : "";

  let upstream = "";
  const remoteBranch = await runGit(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd);
  if (remoteBranch) {
    const [ahead, behind] = await Promise.all([
      runGit(["rev-list", "--count", "@{upstream}..HEAD"], cwd),
      runGit(["rev-list", "--count", "HEAD..@{upstream}"], cwd),
    ]);
    if (Number(ahead) > 0) upstream += "↑";
    if (Number(behind) > 0) upstream += "↓";
  }

  return `${cyan}${branch}${reset}${dirty}${upstream}`;
}

const raw = await readStdin();
let input: Payload = {};
try {
  input = JSON.parse(raw) as Payload;
} catch {
  // Bad stdin — skip with minimal output.
}

const model = input.model?.display_name ?? "";
const currentDir = input.workspace?.current_dir ?? "";
const used = input.context_window?.used_percentage;
const tokensAvailable = input.context_window?.context_window_size ?? 0;
const tokensUsed = used !== undefined ? Math.round(tokensAvailable * (used / 100)) : 0;

const dirName = currentDir ? basename(currentDir) : "";
const gitStatus = currentDir ? await buildGitStatus(currentDir) : null;

const rateUsed = input.rate_limits?.five_hour?.used_percentage;

const effortLevel = input.effort?.level;
const thinkingEnabled = input.thinking?.enabled === true;

const parts: string[] = [];
if (model) {
  // Suffix model with effort marker — e.g. "Opus 4.7 ⚙xhigh" or "Opus 4.7 ⚙xhigh†".
  // † = thinking enabled. Dim the marker so the model name stays prominent.
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const marker = effortLevel ? `${dim} ⚙${effortLevel}${thinkingEnabled ? "†" : ""}${reset}` : "";
  parts.push(`${model}${marker}`);
}
if (dirName) parts.push(dirName);
if (gitStatus) parts.push(gitStatus);

if (used !== undefined) {
  const usedInt = Math.round(used);
  const filled = Math.floor(usedInt / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  parts.push(`${bar} ${usedInt}% (${formatTokens(tokensUsed)}/${formatTokens(tokensAvailable)})`);
}

if (rateUsed !== undefined) {
  const rInt = Math.round(rateUsed);
  const red = "\x1b[31m";
  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  const color = rInt >= 80 ? red : rInt >= 50 ? yellow : green;
  parts.push(`${color}⚡${rInt}%${reset}`);
}

const dimSep = "\x1b[2m | \x1b[0m";
process.stdout.write(`${parts.join(dimSep)}\n`);
