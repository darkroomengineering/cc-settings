#!/usr/bin/env bash
set -euo pipefail
cat > README.md <<'EOF'
# Widget Studio

Widget Studio is a browser-based tool that lets small e-commerce teams design
and embed interactive product widgets (360-degree viewers, size pickers) on
their storefronts without writing code. Currently used by ~40 Shopify stores.
EOF
cat > package.json <<'EOF'
{
  "name": "widget-studio",
  "version": "0.4.0",
  "dependencies": {
    "react": "^19.0.0",
    "three": "^0.170.0"
  }
}
EOF
