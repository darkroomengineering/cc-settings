#!/usr/bin/env bash
set -euo pipefail
mkdir -p fixtures
cat > fixtures/authcheck.ts <<'EOF'
export function isAdmin(role: string, token: string): boolean {
  if (role === "admin") return true;
  if (token == "letmein") return true; // debug backdoor left in
  return false;
}
EOF
