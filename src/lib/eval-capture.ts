// Multi-turn eval cases. `claude plugin eval` sends one user prompt per case;
// `context.history_file` resumes a session transcript first. A case that names
// a source case in capture.json resumes a transcript of that source case, made
// fresh against the plugin under test, because a resumed run follows the skill
// text frozen in the transcript, not the current SKILL.md. The transcript is
// written to <case>/history.jsonl; it and the session files resumed runs leave
// beside it are gitignored.

import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CAPTURE_FILE = "capture.json";
export const HISTORY_FILE = "history.jsonl";

const CaptureSchema = z.object({ from: z.string().min(1) }).strict();

export interface CaptureCase {
  name: string;
  from: string;
}

/** Cases in `evalsDir` with a capture.json, sorted by name. Throws on a malformed file. */
export function captureCases(evalsDir: string): CaptureCase[] {
  if (!existsSync(evalsDir)) return [];
  return readdirSync(evalsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(evalsDir, d.name, CAPTURE_FILE)))
    .map((d) => {
      const path = join(evalsDir, d.name, CAPTURE_FILE);
      const parsed = CaptureSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
      if (!existsSync(join(evalsDir, parsed.data.from))) {
        throw new Error(`${path}: source case "${parsed.data.from}" does not exist`);
      }
      return { name: d.name, from: parsed.data.from };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The kept sandbox directory `claude plugin eval --keep-temp` names on stderr. */
export function keptDir(stderr: string): string | null {
  return stderr.match(/kept (\/\S+?):/)?.[1] ?? null;
}

function sessionTranscript(kept: string): string | null {
  const projects = join(kept, "config", "projects");
  if (!existsSync(projects)) return null;
  for (const project of readdirSync(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const file = readdirSync(join(projects, project.name)).find((f) => f.endsWith(".jsonl"));
    if (file) return join(projects, project.name, file);
  }
  return null;
}

// --keep-temp leaves the directory read-only, with home/ and tmp/ sealed at mode 000.
function removeKept(kept: string): void {
  Bun.spawnSync({ cmd: ["chmod", "-R", "u+rwx", kept], stdout: "ignore", stderr: "ignore" });
  rmSync(kept, { recursive: true, force: true });
}

export interface CaptureResult {
  ok: boolean;
  costUsd: number;
  detail: string;
}

/**
 * Runs `c.from` once in `plugin` and writes its session transcript to
 * `<plugin>/evals/<c.name>/history.jsonl`. `evalFlags` are the runner flags the
 * caller uses for the real run (model, grants), so capture and resume match.
 */
export function capture(plugin: string, c: CaptureCase, evalFlags: string[]): CaptureResult {
  const caseDir = join(plugin, "evals", c.name);
  const target = join(caseDir, HISTORY_FILE);
  // A resumed run writes its session as <sessionId>.jsonl beside the history file.
  for (const f of readdirSync(caseDir)) {
    if (f.endsWith(".jsonl")) rmSync(join(caseDir, f), { force: true });
  }
  const out = join(tmpdir(), `cc-settings-capture-${c.name}-${process.pid}.json`);
  const proc = Bun.spawnSync({
    cmd: [
      "claude",
      "plugin",
      "eval",
      plugin,
      "--case",
      c.from,
      "--runs",
      "1",
      "--keep-temp",
      ...evalFlags,
      "--json",
      out,
    ],
    cwd: plugin,
    stdout: "pipe",
    stderr: "pipe",
  });
  let costUsd = 0;
  try {
    costUsd = (JSON.parse(readFileSync(out, "utf8")) as { costUsd?: number }).costUsd ?? 0;
  } catch {
    // No report: the CLI failed before writing one; the missing transcript says so below.
  }
  rmSync(out, { force: true });
  const kept = keptDir(new TextDecoder().decode(proc.stderr));
  if (kept === null) {
    return { ok: false, costUsd, detail: `no kept sandbox (exit ${proc.exitCode})` };
  }
  try {
    chmodSync(kept, 0o700);
    const transcript = sessionTranscript(kept);
    if (transcript === null) return { ok: false, costUsd, detail: "no session transcript" };
    copyFileSync(transcript, target);
    return { ok: true, costUsd, detail: `from ${c.from}` };
  } finally {
    removeKept(kept);
  }
}
