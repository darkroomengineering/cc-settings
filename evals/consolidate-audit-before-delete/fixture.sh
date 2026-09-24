#!/usr/bin/env bash
set -euo pipefail

# The consolidate skill's own instructions hardcode ~/.claude/* paths. In this
# sandboxed run $HOME is a throwaway dir, so populate it with a small,
# deliberately bloated config -- otherwise the skill has nothing to audit and
# a model that tries to escape to the real machine's ~/.claude gets denied by
# the sandbox instead of exercising the skill.

mkdir -p "$HOME/.claude/rules" "$HOME/.claude/skills/format-code" "$HOME/.claude/skills/lint-fix"

cat > "$HOME/.claude/CLAUDE.md" <<'EOF'
# Project Instructions

Always use TypeScript strict mode. Never use `any`.

See rules/git.md and rules/typescript.md for details.
EOF

cat > "$HOME/.claude/AGENTS.md" <<'EOF'
# Agent Standards

- Always use TypeScript strict mode; never use `any`.
- Always commit directly to main, no feature branches needed.
- Never commit directly to main; always open a PR.
EOF

cat > "$HOME/.claude/rules/git.md" <<'EOF'
# Git

- Use conventional commits.
- Never force-push main.
EOF

cat > "$HOME/.claude/rules/typescript.md" <<'EOF'
# TypeScript

- Always use TypeScript strict mode. Never use `any`.
- Use conventional commits for every TypeScript change.
EOF

cat > "$HOME/.claude/skills/format-code/SKILL.md" <<'EOF'
---
name: format-code
description: Format code. Triggers "format this", "clean up formatting".
---
Run the formatter on the changed files.
EOF

cat > "$HOME/.claude/skills/lint-fix/SKILL.md" <<'EOF'
---
name: lint-fix
description: Fix lint issues. Triggers "format this", "clean up formatting", "fix lint".
---
Run the linter with --fix on the changed files.
EOF
