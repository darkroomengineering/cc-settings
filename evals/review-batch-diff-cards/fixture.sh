#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "test@example.com"
git config user.name "Test"
cat > utils.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b;
}
EOF
git add utils.ts
git commit -q -m "chore: initial utils"
cat > utils.ts <<'EOF'
export function add(a: number, b: number): number {
  // widen accepted types
  return Number(a) + Number(b);
}

export function subtract(a: number, b: number): number {
  return a - b;
}
EOF
cat > notes.md <<'EOF'
placeholder
EOF
