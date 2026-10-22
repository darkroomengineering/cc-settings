#!/usr/bin/env bash
set -euo pipefail

# Locate the real cc-settings checkout so the proof runner the skill actually
# shells out to ($HOME/.claude/src/scripts/proof.ts) exists in this sandboxed
# HOME too -- otherwise the case only tests an empty sandbox, not the skill.
CASE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$CASE_DIR/../.." && pwd)"

mkdir -p "$HOME/.claude/src/scripts" "$HOME/.claude/src/lib"
cp "$REPO_ROOT/src/scripts/proof.ts" "$HOME/.claude/src/scripts/proof.ts"
cp "$REPO_ROOT/src/lib/proof-of-work.ts" "$HOME/.claude/src/lib/proof-of-work.ts"
cp "$REPO_ROOT/src/lib/tsc.ts" "$HOME/.claude/src/lib/tsc.ts"
cp "$REPO_ROOT/src/lib/platform.ts" "$HOME/.claude/src/lib/platform.ts"

cat > package.json <<'EOF'
{
  "name": "fixture-app",
  "version": "0.0.1",
  "scripts": {
    "test": "bun test",
    "lint": "echo lint-ok"
  }
}
EOF

mkdir -p src
cat > src/math.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b;
}
EOF

git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
git add -A
git commit -q -m "Initial commit"

# A real uncommitted diff for the gate to run against.
cat > src/math.ts <<'EOF'
export function add(a: number, b: number, c = 0): number {
  return a + b + c;
}
EOF
