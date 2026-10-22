#!/usr/bin/env bash
set -euo pipefail

git init -q
mkdir -p upstream src/upstream
cat > upstream/codex-manifest.json <<'JSON'
{
  "lastScan": "2026-10-12T00:00:00.000Z",
  "codexVersion": "0.162.1",
  "appChangelogLastScan": "2026-10-12",
  "knownConfigSurfaces": ["$CODEX_HOME/hooks.json (user-level hooks written by the installer)"],
  "notes": []
}
JSON
# Canned scanner: no Claude Code or Codex CLI drift, two new Codex app entries.
cat > src/upstream/scan.ts <<'TS'
if (process.argv.includes("--codex-app-entries")) {
  console.log(`=== 2026-10-14 codex-2026-10-14-app
# Codex app 26.1014

- Hooks from a plugin now need a fresh trust review after the plugin's hooks.json changes.

=== 2026-10-15 codex-2026-10-15-chatgpt-voice
# Voice mode in ChatGPT

- Voice mode answers faster in ChatGPT conversations.
`);
} else {
  console.log(`cc-settings upstream scan
  claude-code
    manifest version: 2.1.296 (scanned 2026-10-12T00:00:00.000Z)
    live version:     2.1.296
  codex
    manifest version: 0.162.1 (scanned 2026-10-12T00:00:00.000Z)
    live version:     0.162.1
    app/IDE changelog: triaged through 2026-10-12, 2 newer entries

drift detected:
  codex app changelog: 2 entries after 2026-10-12 (read them with \`bun src/upstream/scan.ts --codex-app-entries\`)
    2026-10-14 Codex app 26.1014
    2026-10-15 Voice mode in ChatGPT

run \`/cc sync\` to triage the changelogs and land the bumps.`);
}
TS
cat > package.json <<'JSON'
{ "name": "cc-settings", "private": true, "scripts": { "upstream:scan": "bun src/upstream/scan.ts" } }
JSON
git add -A
git commit -q -m "init" --author="fixture <fixture@example.com>"
