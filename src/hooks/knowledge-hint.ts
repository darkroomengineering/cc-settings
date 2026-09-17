#!/usr/bin/env bun
// PreToolUse hook (matcher: Bash|Edit|Write) — surfaces up to 3 team-knowledge
// notes whose slug/tags match the tool's command or edited file, once per
// note per session. Reads the TTL-cached index written by
// refresh-knowledge-index.ts; never does network I/O itself.
//
// Fail-open contract: any error (missing cache, unparseable payload, state
// write failure) → exit silently, never block the tool call. Ranking is pure
// and lives in ../lib/knowledge-hint.ts so it's testable without spawning.
//
// Delivery: plain stdout on PreToolUse never reaches the model — the hint is
// emitted via hookSpecificOutput.additionalContext (see hook-runtime.ts).

import { z } from "zod";
import {
  emitAdditionalContext,
  readHookInput,
  readState,
  runHook,
  writeState,
} from "../lib/hook-runtime.ts";
import { rankNotes } from "../lib/knowledge-hint.ts";
import { type KnowledgeNote, readKnowledgeIndex } from "../lib/knowledge-index.ts";
import { isSafeSessionId } from "../lib/session-ledger.ts";

const KNOWLEDGE_REPO = process.env.KNOWLEDGE_REPO ?? "darkroomengineering/team-knowledge";
const HINT_STATE_FILE = "knowledge-hints.json";
const MAX_TRACKED_SESSIONS = 30;

const HintStateSchema = z.object({
  sessions: z.record(z.string(), z.array(z.string())),
});
type HintState = z.infer<typeof HintStateSchema>;

type ToolInput = {
  command?: string;
  file_path?: string;
  new_string?: string;
  content?: string;
};

type Payload = {
  session_id: string;
  tool_name: string;
  tool_input: ToolInput;
};

/** Build the lowercase haystack for a tool call — the fields the hint should
 *  search, concatenated. Unknown tool names produce an empty haystack. */
function buildHaystack(toolName: string, input: ToolInput): string {
  let parts: string[];
  switch (toolName) {
    case "Bash":
      parts = [input.command ?? ""];
      break;
    case "Edit":
      parts = [input.file_path ?? "", input.new_string ?? ""];
      break;
    case "Write":
      parts = [input.file_path ?? "", input.content ?? ""];
      break;
    default:
      parts = [];
  }
  return parts.join(" ").toLowerCase();
}

/** Append `notes` to the session's shown-list and prune the map to the
 *  MAX_TRACKED_SESSIONS most recently written sessions (insertion order —
 *  delete then reinsert the current key so it's always last/newest). */
function updateHintState(state: HintState, sessionId: string, notes: KnowledgeNote[]): HintState {
  const sessions = { ...state.sessions };
  const prior = sessions[sessionId] ?? [];
  delete sessions[sessionId];
  const keys = Object.keys(sessions);
  while (keys.length >= MAX_TRACKED_SESSIONS) {
    const oldest = keys.shift();
    if (oldest === undefined) break;
    delete sessions[oldest];
  }
  sessions[sessionId] = [...prior, ...notes.map((n) => n.name)];
  return { sessions };
}

function formatMessage(notes: KnowledgeNote[]): string {
  const lines = [
    "[team-knowledge] Notes that may apply to this step:",
    ...notes.map((n) => `  - ${n.kind}: ${n.name} — ${n.hook}`),
    `Read one: gh api repos/${KNOWLEDGE_REPO}/contents/<name>.md --jq .content | base64 -d`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const input = await readHookInput<Payload>({
    session_id: "CLAUDE_SESSION_ID",
    tool_name: "TOOL_NAME",
  });

  const toolName = input.tool_name ?? "";
  if (toolName !== "Bash" && toolName !== "Edit" && toolName !== "Write") return;

  const index = await readKnowledgeIndex();
  if (!index || index.notes.length === 0) return;

  const haystack = buildHaystack(toolName, input.tool_input ?? {});
  if (!haystack.trim()) return;

  const sessionId = isSafeSessionId(input.session_id) ? input.session_id : "unknown";

  const state = await readState<HintState>(HINT_STATE_FILE, { sessions: {} });
  const validated = HintStateSchema.safeParse(state);
  const safeState: HintState = validated.success ? validated.data : { sessions: {} };
  const shown = new Set(safeState.sessions[sessionId] ?? []);

  const matched = rankNotes(index.notes, haystack, shown);
  if (matched.length === 0) return;

  emitAdditionalContext("PreToolUse", formatMessage(matched));

  // Read-modify-write without a lock: two hooks racing on the same session can
  // both miss the other's write, and a note then surfaces twice. Accepted: the
  // cost is one duplicate advisory line, and a lock would add a blocking wait
  // to every Bash/Edit call.
  const next = updateHintState(safeState, sessionId, matched);
  await writeState(HINT_STATE_FILE, next).catch(() => {});
}

await runHook(main);
