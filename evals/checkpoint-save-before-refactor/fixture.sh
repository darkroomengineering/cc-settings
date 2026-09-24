#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
mkdir -p middleware
cat > middleware/auth.ts <<'EOF'
export function authMiddleware(req: Request, res: Response, next: () => void) {
  const token = req.headers.get("authorization");
  if (!token) {
    res.status = 401;
    return;
  }
  next();
}
EOF
git add -A
git commit -q -m "Add legacy auth middleware"
