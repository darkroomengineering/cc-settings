---
title: "Privacy policy · cc-settings"
description: "cc-settings has no analytics and no server of its own. It installs configuration on your machine; the services it connects to are the ones you choose."
url: "https://cc-settings.darkroom.engineering/privacy"
---

[cc-settings](https://cc-settings.darkroom.engineering/)

# cc-settings privacy policy

cc-settings is configuration that runs on your machine. It has no analytics, and Darkroom Engineering runs no server for it and receives nothing from it.

**Installing and updating.** The installer downloads cc-settings from its GitHub repository, and `npx` first downloads the small installer package from the npm registry. If you turn on auto-update on macOS, a daily job does the same check against GitHub.

**On your machine.** Hooks keep logs, backups and install state under your home folder, such as `~/.claude`. They stay there.

**Claude Code and Codex.** Your prompts and code go to Anthropic or OpenAI through those products, under their own terms. cc-settings does not change where they send data.

**Connected tools.** cc-settings configures MCP servers that you sign in to: Context7 receives the library documentation questions an agent asks, and Figma receives requests for the files you point it at. Team notes you share with `/share-learning` go to a GitHub repository through your own GitHub CLI sign-in.

**Optional services.** If you add a TypeSafe key, verbatim compaction and the drift check send session content to TypeSafe's API to score it; without a key nothing goes there. The Codex bridge hands work to your own Codex CLI only when you have installed and signed in to it.

Questions: [open an issue on GitHub](https://github.com/darkroomengineering/cc-settings/issues).

Last updated: November 12, 2026.
