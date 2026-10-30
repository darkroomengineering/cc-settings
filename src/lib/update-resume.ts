// `/cc update` leaves this marker when an update changed files that a running
// session reads only at launch, then asks the user to run `/restart`. The
// SessionStart hook of the resumed session consumes it and tells Claude to
// carry on from the handoff, so the user only has to say "continue".
//
// A marker is honored once, only in the project directory that wrote it, and
// only for MAX_AGE_MS: a forgotten marker must not hijack a later, unrelated
// resume.

import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const UPDATE_RESUME_FILE = "update-resume.json";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

const Marker = z.object({
  cwd: z.string(),
  version: z.string(),
  handoff: z.string().optional(),
  restartFor: z.array(z.string()).default([]),
  at: z.number(),
});

/** Lines for the resumed session, or [] when no marker applies. Deletes a
 *  marker it has read, whether or not it applied, unless it belongs to another
 *  project and is still fresh. */
export async function consumeUpdateResume(
  tmpDir: string,
  projectDir: string,
  now: number = Date.now(),
): Promise<string[]> {
  const path = join(tmpDir, UPDATE_RESUME_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const parsed = Marker.safeParse(safeJson(raw));
  const fresh = parsed.success && now - parsed.data.at >= 0 && now - parsed.data.at < MAX_AGE_MS;
  if (fresh && parsed.data.cwd !== projectDir) return [];
  await unlink(path).catch(() => {});
  if (!fresh) return [];

  const m = parsed.data;
  const out = [
    "",
    `[update] cc-settings v${m.version} was installed and this session restarted to load it.`,
  ];
  if (m.restartFor.length > 0) out.push(`[update] Reloaded: ${m.restartFor.join(", ")}`);
  if (m.handoff) out.push(`[update] Handoff written before the restart: ${m.handoff}`);
  out.push(
    "[update] Read the handoff, then continue the task you were on when the user ran /cc update. On the user's next message, say in one line what you are resuming.",
  );
  return out;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
