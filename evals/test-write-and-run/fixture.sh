#!/usr/bin/env bash
set -euo pipefail
mkdir -p fixtures
cat > fixtures/math.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b;
}
EOF
