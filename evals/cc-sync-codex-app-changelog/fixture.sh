#!/usr/bin/env bash
set -euo pipefail

git init -q
mkdir -p upstream
cat > upstream/codex-manifest.json <<'JSON'
{
  "lastScan": "2026-10-12T00:00:00.000Z",
  "codexVersion": "0.162.1",
  "appChangelogLastScan": "2026-09-01",
  "knownConfigSurfaces": ["AGENTS.md managed block ($CODEX_HOME/AGENTS.md)"],
  "notes": []
}
JSON
cat > scan.sh <<'SH'
#!/usr/bin/env sh
cat <<'OUT'
cc-settings upstream scan
  claude-code
    manifest version: 2.1.296 (scanned 2026-10-12T00:00:00.000Z)
    live version:     2.1.296
  codex
    manifest version: 0.162.1 (scanned 2026-10-12T00:00:00.000Z)
    live version:     0.162.1
    app/IDE changelog: last triaged 2026-09-01 (41d ago; no version feed, /cc sync reads https://learn.chatgpt.com/docs/changelog)

no drift detected.
OUT
SH
cat > package.json <<'JSON'
{ "name": "cc-settings", "private": true, "scripts": { "upstream:scan": "sh scan.sh" } }
JSON
git add -A
git commit -q -m "init" --author="fixture <fixture@example.com>"
