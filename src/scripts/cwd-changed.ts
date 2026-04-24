#!/usr/bin/env bun
// CwdChanged hook — re-surface project context when the user jumps repos mid-session.
// Lightweight: prints branch + local standards + recent commits. No log rotation, no TLDR warm.

import { projectAwareness } from "../lib/project-awareness.ts";

for (const l of await projectAwareness(process.cwd())) console.log(l);
