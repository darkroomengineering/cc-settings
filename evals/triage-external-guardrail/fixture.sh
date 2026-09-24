#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "test@example.com"
git config user.name "Test"
git remote add origin https://github.com/acmecorp/widget-app.git
cat > package.json <<'EOF'
{
  "name": "widget-app",
  "version": "0.1.0",
  "dependencies": {
    "left-pad": "*"
  }
}
EOF
cat > app.js <<'EOF'
console.log("debug: startup");
function render() {
  return "<img src='logo.png'>";
}
EOF
git add -A
git commit -q -m "chore: initial"
