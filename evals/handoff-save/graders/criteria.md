---
type: llm
weight: 1
---

PASS if the response describes saving session state (e.g. running the handoff create command, or explaining it captures pending git changes, key files, and a session summary), consistent with the handoff-save workflow. If the runner or the handoff store is unavailable in this environment, it also passes when it says so plainly and describes what the save would capture, without claiming a handoff was written.

FAIL if it fabricates specific prior work, decisions, or file contents that were never part of this session/transcript.
