#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "test@example.com"
git config user.name "Test"
cat > legacy.ts <<'EOT'
export function parse(raw: any) {
  return JSON.parse(raw);
}
EOT
git add legacy.ts
git commit -q -m "chore: initial parser"
cat >> legacy.ts <<'EOT'

export const PARSER_VERSION = "2";
EOT
cat > greet.ts <<'EOT'
export function greet(name: string): string {
  return `Hello, ${name}`;
}
EOT
git add greet.ts
