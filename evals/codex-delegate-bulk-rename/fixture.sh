#!/usr/bin/env bash
set -euo pipefail

# Deliberately do NOT install the Codex bridge script into this sandboxed
# $HOME/.claude/src/scripts/ -- it depends on zod and several sibling lib
# files that would need their own node_modules, and its absence here stands
# in for a real "bridge not installed" state, one of the states codex-run.ts
# itself handles. The skill's contract for that state is fail-open: continue
# Claude-only, don't block, don't ask permission for reversible in-scope work.

mkdir -p src/api src/hooks src/components

cat > src/api/user.ts <<'EOF'
export async function getUser(id: string) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
EOF

cat > src/hooks/useUser.ts <<'EOF'
import { getUser } from "../api/user";

export function useUser(id: string) {
  return getUser(id);
}
EOF

cat > src/components/Profile.tsx <<'EOF'
import { getUser } from "../api/user";

export async function Profile({ id }: { id: string }) {
  const user = await getUser(id);
  return user;
}
EOF

cat > src/components/Settings.tsx <<'EOF'
import { getUser } from "../api/user";

export async function loadSettings(id: string) {
  const user = await getUser(id);
  return { theme: "light", user };
}
EOF

git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
git add -A
git commit -q -m "Initial commit"
