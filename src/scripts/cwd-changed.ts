#!/usr/bin/env bun
// CwdChanged hook — re-surface project context when the user jumps repos mid-session.
// Lightweight: prints branch + local standards + recent commits. No log rotation, no TLDR warm.
//
// Fail-open: any error in projectAwareness (git read failure, missing files,
// permission issues) must not break the hook.

import { projectAwareness } from "../lib/project-awareness.ts";

try {
  for (const l of await projectAwareness(process.cwd())) console.log(l);
} catch {
  // silent — context surfacing is best-effort
}
