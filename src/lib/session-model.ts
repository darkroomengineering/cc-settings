// Session model map — session_id → the model display_name the statusline last
// saw for that session, so other hooks (escalate-model.ts) can tell whether
// the session is already running Fable 5 before recommending it as the
// escalation target.
//
// Mirrors version-delta.ts's SessionInstallMapSchema/refreshSessionInstallMap
// pattern exactly: zod schema + pure refresh function here, IO at the call
// site (statusline.ts writes, escalate-model.ts reads via readSessionModel).
// The statusline write site is a hot path rendered on every turn, so the
// write only happens when the entry is new or the model actually changed —
// never on every render.

import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readValidatedState } from "./hook-runtime.ts";

const SubagentMetaSchema = z.object({
  finished: z.boolean().nullable().optional(),
  model: z.string().nullable().optional(),
  // The session model the subagent inherits when `model` is unset.
  pickedEffortModel: z.string().nullable().optional(),
});
const AssistantModelSchema = z.object({
  type: z.string(),
  message: z.object({ model: z.string().nullable().optional() }).optional(),
});

export async function runningSubagentModels(
  transcriptPath?: string,
  now = Date.now(),
): Promise<string> {
  if (!transcriptPath) return "";
  try {
    const dir = `${transcriptPath.replace(/\.jsonl$/, "")}/subagents`;
    const names = await readdir(dir);
    const models = await Promise.all(
      names
        .filter((name) => /^agent-.+\.meta\.json$/.test(name))
        .map(async (name) => {
          try {
            const meta = SubagentMetaSchema.parse(
              JSON.parse(await readFile(join(dir, name), "utf8")),
            );
            if (meta.finished === true) return null;
            const file = await open(join(dir, name.replace(/\.meta\.json$/, ".jsonl")), "r");
            try {
              const info = await file.stat();
              // SHORTCUT: infer liveness from mtime. ceiling: a subagent blocked on one tool call for longer than 30 minutes drops out of the count. upgrade: a completion field Claude Code writes on kill.
              if (now - info.mtimeMs >= 30 * 60 * 1000) return null;
              const start = Math.max(0, info.size - 64 * 1024);
              const buffer = Buffer.alloc(Math.min(info.size, 64 * 1024));
              const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
              const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
              if (start > 0) lines.shift();
              const fallback = meta.model || meta.pickedEffortModel;
              let model = fallback;
              for (const line of lines.reverse()) {
                if (!line.trim()) continue;
                // The last line can be half-written while the subagent runs.
                let record: z.infer<typeof AssistantModelSchema>;
                try {
                  record = AssistantModelSchema.parse(JSON.parse(line));
                } catch {
                  continue;
                }
                if (record.type === "assistant") {
                  model = record.message?.model || fallback;
                  break;
                }
              }
              return model ? model.replace(/^claude-(.+?)-\d.*$/, "$1") : null;
            } finally {
              await file.close();
            }
          } catch {
            return null;
          }
        }),
    );
    const counts = new Map<string, number>();
    for (const model of models) if (model) counts.set(model, (counts.get(model) ?? 0) + 1);
    return [...counts]
      .sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))
      .map(([name, count]) => `${count} ${name}`)
      .join(" · ");
  } catch {
    return "";
  }
}

export const SESSION_MODEL_STATE = "session-models.json";

/** Cap on remembered sessions, mirroring escalate.ts's MAX_ANNOUNCED_SESSIONS
 *  and version-delta.ts's SESSION_MAP_CAP — a machine running many short
 *  sessions over time can't grow this file without bound. Oldest (by last
 *  update) drops first. */
export const SESSION_MODEL_MAP_CAP = 50;

/** Single shape definition for the state file — every reader/writer validates
 *  through this so a corrupted/partial write degrades to "absent" rather than
 *  feeding garbage into a downstream advisory. */
export const SessionModelMapSchema = z.record(
  z.string(),
  z.object({ m: z.string(), t: z.number() }),
);

export type SessionModelMap = z.infer<typeof SessionModelMapSchema>;

/**
 * Set (or refresh) a session's recorded model display_name and prune the map
 * to the SESSION_MODEL_MAP_CAP most recently updated entries. Pure — callers
 * own the state IO (same split as refreshSessionInstallMap).
 */
export function refreshSessionModelMap(
  map: SessionModelMap,
  sessionId: string,
  displayName: string,
  now: number,
): SessionModelMap {
  const next: SessionModelMap = { ...map, [sessionId]: { m: displayName, t: now } };
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, SESSION_MODEL_MAP_CAP),
  );
}

/** Read the model display_name last recorded for `sessionId`, or null when
 *  there's no entry, the state file is missing, or it's corrupt — fail-open,
 *  same convention as every other state reader in this codebase. Callers
 *  (escalate-model.ts) treat null as "unknown" and keep their existing
 *  fail-open default rather than branching on absence.
 *
 *  `tmpDir` defaults to the real ~/.claude/tmp (readValidatedState's default)
 *  — same optional-override convention readState/readValidatedState already
 *  expose, so tests can point at a fixture directory instead of mutating
 *  process.env.HOME after this module's already been imported (CLAUDE_DIR in
 *  platform.ts is resolved once at import time, not per-call). */
export async function readSessionModel(sessionId: string, tmpDir?: string): Promise<string | null> {
  const map = await readValidatedState(SESSION_MODEL_STATE, SessionModelMapSchema, {}, tmpDir);
  return map[sessionId]?.m ?? null;
}
