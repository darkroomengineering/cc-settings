#!/usr/bin/env bun

// PostCompact hook — persist Claude Code's native compaction summary into the
// handoff that the preceding PreCompact just wrote.
//
// This hook does NOT inject context. Verified against the 2.1.220 binary, the
// runtime builds the payload as
//     {...common, hook_event_name:"PostCompact", trigger, compact_summary}
// and folds each hook's stdout into a `userDisplayMessage` — shown to the user,
// never added to the model's context. The previous version of this script
// printed a numbered "recovery steps" list addressed to the model; that text
// could never reach it. Post-compaction re-injection is SessionStart with
// source:"compact" (see session-start.ts), which is the supported seam.
//
// What this script is for instead: compact_summary is the one place the model's
// own account of the session — intent, decisions, rationale, next steps —
// exists in structured form. Without persisting it, an automatic handoff keeps
// a placeholder comment where its summary should be. The ledger supplies the
// artifacts; this supplies the reasoning. They are stored separately and never
// merged, so nothing inferred is ever presented as observed.

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { listArtifacts } from "../lib/artifact-store.ts";
import { runGit } from "../lib/git.ts";
import { readHookInput, runHook } from "../lib/hook-runtime.ts";
import { atomicWriteJson, atomicWriteString, readJsonOrNull } from "../lib/json-io.ts";
import { claudePath, isoNow } from "../lib/platform.ts";

type PostCompactInput = {
  session_id: string;
  cwd: string;
  trigger: string;
  compact_summary: string;
};

/** Replace the body of a `## <heading>` section, leaving every other section
 *  byte-identical. Returns null when the heading is absent, so a handoff
 *  written by an older version (or hand-edited beyond recognition) is left
 *  untouched rather than rewritten into a shape its reader won't expect. */
export function replaceMarkdownSection(md: string, heading: string, body: string): string | null {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("## ")) {
      end = i;
      break;
    }
  }
  // Keep the blank line that separated this section from the next one.
  const trailing = end < lines.length ? [""] : [];
  return [...lines.slice(0, start + 1), body, ...trailing, ...lines.slice(end)].join("\n");
}

await runHook(async () => {
  const input = await readHookInput<PostCompactInput>({ session_id: "CLAUDE_SESSION_ID" });
  const summary = typeof input.compact_summary === "string" ? input.compact_summary.trim() : "";
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  // Nothing to persist, or nothing to match on. Both are ordinary states (a
  // compaction with an empty summary, an older CLI that omits the field), not
  // errors — exit quietly rather than guessing at a target handoff.
  if (!summary || !sessionId) return;

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const toplevel = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  const project = toplevel ? basename(toplevel) : basename(cwd);
  const dir = claudePath("handoffs", project);

  // listArtifacts sorts ascending, and handoff_<YYYYMMDD_HHMMSS> sorts
  // lexicographically the same way it sorts chronologically — so reversing
  // gives newest-first. Take the first handoff belonging to THIS session:
  // matching on session id is what stops a compaction in one session from
  // overwriting a handoff that belongs to another.
  const candidates = (await listArtifacts(dir, /^handoff_.*\.json$/)).reverse();
  for (const name of candidates) {
    const jsonPath = join(dir, name);
    let record: Record<string, unknown>;
    try {
      const parsed = await readJsonOrNull(jsonPath);
      if (typeof parsed !== "object" || parsed === null) continue;
      record = parsed as Record<string, unknown>;
    } catch {
      continue; // Corrupt or unreadable — try the next one.
    }
    if (record.sessionId !== sessionId) continue;

    const context =
      typeof record.context === "object" && record.context !== null
        ? (record.context as Record<string, unknown>)
        : {};
    record.context = { ...context, summary };
    record.trigger = typeof input.trigger === "string" ? input.trigger : record.trigger;
    record.compactedAt = isoNow();
    await atomicWriteJson(jsonPath, record);

    // Mirror into the Markdown twin so the two never disagree. Failing to
    // update the Markdown must not roll back the JSON — the JSON is the
    // machine-read copy and is already correct.
    const mdPath = jsonPath.replace(/\.json$/, ".md");
    try {
      const md = await readFile(mdPath, "utf8");
      const next = replaceMarkdownSection(md, "Session Summary", summary);
      if (next) await atomicWriteString(mdPath, next);
    } catch {
      // Markdown twin missing or unreadable — JSON already holds the summary.
    }

    // stdout here surfaces to the user, not the model (see header).
    console.log(`[PostCompact] Compaction summary saved to ${basename(jsonPath)}`);
    return;
  }
});
