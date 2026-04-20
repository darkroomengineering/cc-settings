#!/usr/bin/env bun
// SubagentStart / SubagentStop / TaskCreated hook: append a line to
// ~/.claude/swarm.log. Extracted from inline `bash -c '…'` — Phase 6.2.
//
// Usage: bun swarm-log.ts <event>
//   event = start | stop | task
// Env:
//   AGENT_TYPE, AGENT_ID — populated by CC for subagent events
//   TASK_SUBJECT         — populated by CC for task events

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const event = process.argv[2] ?? "";
const logPath = join(homedir(), ".claude", "swarm.log");

const agentType = process.env.AGENT_TYPE ?? "?";
const agentId = process.env.AGENT_ID ?? "?";
const taskSubject = process.env.TASK_SUBJECT ?? "?";

let line: string;
switch (event) {
  case "start":
    line = `[Swarm] Agent started: ${agentType} (${agentId})`;
    break;
  case "stop":
    line = `[Swarm] Agent stopped: ${agentType} (${agentId})`;
    break;
  case "task":
    line = `[Swarm] Task created: ${taskSubject}`;
    break;
  default:
    // Unknown event — silent no-op rather than fail a hook.
    process.exit(0);
}

await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
await appendFile(logPath, `${line}\n`).catch(() => {});
