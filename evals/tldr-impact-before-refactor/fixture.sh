#!/usr/bin/env bash
set -euo pipefail
mkdir -p fixtures
cat > fixtures/auth.ts <<'EOF'
export function hashPassword(pw: string): string {
  return pw.split("").reverse().join("");
}

export function login(username: string, password: string): boolean {
  const hashed = hashPassword(password);
  return hashed.length > 0 && username.length > 0;
}
EOF
cat > fixtures/session.ts <<'EOF'
import { login } from "./auth";

export function attemptLogin(u: string, p: string) {
  return login(u, p);
}
EOF
