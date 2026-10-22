#!/usr/bin/env bash
set -euo pipefail

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
