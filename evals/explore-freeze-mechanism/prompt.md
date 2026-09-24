---
tags: [explore]
max_turns: 8
allowed_tools: [Skill, Read, Glob, Grep]
---

I'm staring at this file in our codebase and I need to zoom out — where does this fit in the bigger picture, and what calls it?

```ts
// hooks/freeze-guard.ts — PreToolUse hook registered against Edit and Write in hooks.json.
// Reads the session's freeze boundary from ~/.claude/tmp/freeze-<sha256(sessionId)>.json
// and blocks (exit code 2) any Edit/Write whose target path resolves outside
// that directory. NotebookEdit and Bash writes are intentionally not covered.

interface FreezeState {
  boundary: string
}

export function checkFreezeBoundary(targetPath: string, state: FreezeState): boolean {
  return targetPath.startsWith(state.boundary)
}
```
