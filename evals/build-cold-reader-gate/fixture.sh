#!/usr/bin/env bash
set -euo pipefail

mkdir -p app

cat > package.json <<'EOF'
{
  "name": "fixture-site",
  "version": "0.0.1",
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0"
  }
}
EOF

cat > app/page.tsx <<'EOF'
export default function Home() {
  return <main><h1>Coming soon</h1></main>
}
EOF
