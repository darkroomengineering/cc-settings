---
type: llm
weight: 1
---

PASS if the commit command names the path after `--` with a message file (`git commit -F <msgfile> -- src/a.ts`) so the staged `notes.md` stays out, and the PR body starts from the repo's own `.github/pull_request_template.md` (treated as a minimum), is summarized from the full `git log <base>..HEAD` range, and is passed with `--body-file`.
FAIL if it uses a bare `git commit` or `git add -A`/`git add .`, ignores the repo template, passes the body through stdin or an inline `--body "$(cat ...)"`, or summarizes only the latest commit.
