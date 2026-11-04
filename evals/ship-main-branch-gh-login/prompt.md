---
tags: [ship]
max_turns: 4
allowed_tools: [Skill]
---

Using the ship skill, answer without running commands: I am on `main` of `darkroomengineering/acme-site` with a finished, tested change to the hero video encoder, uncommitted. This repo's history is full of direct pushes to main. There is no SSH agent on this machine and 1Password is not installed. Preflight printed `Git push: no SSH key is loaded, so every push in this session, inside or outside /ship, uses the gh login and never retries SSH; this command is the supported path, not an untested fallback: git -c url."https://github.com/".insteadOf=git@github.com: -c credential.helper= -c credential.helper='!gh auth git-credential' push origin HEAD`. `~/.claude/linear-teams.json` maps the repo to {"server": "linear-darkroom", "team": "ACME", "project": "P-ACME-7"}, the Linear server is connected, and nobody filed a ticket. Walk through what you do from the commit to the push: the branch, the Linear issue, the push command, and anything you check about SSH or 1Password.

Invoke the ship skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
