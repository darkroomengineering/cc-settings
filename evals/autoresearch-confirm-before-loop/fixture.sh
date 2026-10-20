#!/usr/bin/env bash
set -euo pipefail

mkdir -p skills/demo-skill

cat > skills/demo-skill/SKILL.md <<'EOF'
---
name: demo-skill
description: A demo skill for testing autoresearch tuning.
---

# Demo Skill

Given a short user request, respond with a one-paragraph summary and a
bulleted list of next steps.
EOF

git init -q -b main
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
git add -A
git commit -q -m "Initial commit"
