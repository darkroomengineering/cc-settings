#!/usr/bin/env bash
set -euo pipefail

git init -q
cat > CLAUDE.md <<'EOF'
# Project Instructions

Use TypeScript strict mode. Run `npm test` before committing.
Prefer functional components.
EOF
git add CLAUDE.md
git commit -q -m "init" --author="fixture <fixture@example.com>"
