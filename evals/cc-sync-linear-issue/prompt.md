---
tags: [cc]
max_turns: 4
allowed_tools: [Skill, Read]
---

Load the cc skill, then answer from its text only, running no commands and changing nothing. Hypothetical: I am at Phase 8 of `/cc sync` in `darkroomengineering/cc-settings`. Phase 7 passed, the branch `sync/cc-2.1.310` is pushed, and nobody has filed a Linear ticket for this sync. `~/.claude/linear-teams.json` maps the repo to {"server": "linear-darkroom", "team": "OSS", "project": "P-OSS-28"}. The commit subject is `feat(v15.88.1): sync with Claude Code v2.1.310 and Codex v0.165.0`. What do you do about Linear before `gh pr create`, and what goes in the PR title and body?
