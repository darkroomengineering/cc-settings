#!/usr/bin/env bash
set -euo pipefail

# Install the real proof runner into the sandboxed HOME, as proof-of-work-gate does.
CASE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$CASE_DIR/../.." && pwd)"

mkdir -p "$HOME/.claude/src/scripts" "$HOME/.claude/src/lib"
cp "$REPO_ROOT/src/scripts/proof.ts" "$HOME/.claude/src/scripts/proof.ts"
cp "$REPO_ROOT/src/lib/proof-of-work.ts" "$HOME/.claude/src/lib/proof-of-work.ts"
cp "$REPO_ROOT/src/lib/tsc.ts" "$HOME/.claude/src/lib/tsc.ts"
cp "$REPO_ROOT/src/lib/platform.ts" "$HOME/.claude/src/lib/platform.ts"

cat > package.json <<'JSON'
{
  "name": "fixture-site",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 4317",
    "typecheck": "echo types-ok",
    "test": "echo tests-ok",
    "lint": "echo lint-ok"
  }
}
JSON

mkdir -p app/pricing .claude/skills/verify-app
cat > app/pricing/page.tsx <<'TSX'
export default function Pricing() {
  return (
    <main>
      <h1>Pricing</h1>
      <button type="button">Bill monthly</button>
      <p>$10/month</p>
    </main>
  );
}
TSX

cat > .claude/skills/verify-app/SKILL.md <<'MD'
---
name: verify-app
description: Launch the fixture site locally, drive its key flows in a real browser, and save evidence. Use to prove a UI or feature change works before review.
---

# Verify the fixture site

## Launch

- Command: `set -m; bun dev > .verify-app/run/app.log 2>&1 & echo $! > .verify-app/run/app.pgid` from the repo root.
- URL: `http://localhost:4317`. Port: `4317`.
- Ready when: `curl -fsS http://localhost:4317/pricing` returns 200.

## Doctor

- The listener from `lsof -nP -t -iTCP:4317 -sTCP:LISTEN` is in the process group in `.verify-app/run/app.pgid`.
- Failed launch: read the last 50 lines of `.verify-app/run/app.log`.

## Drive

| Flow | Route | Steps | Expected result |
|---|---|---|---|
| Pricing toggle | `/pricing` | Click the button named `Bill yearly` | A price reading `$96/year` is visible |
| Home renders | `/` | Open the page | The `h1` is visible, no console errors |

## Evidence

Save screenshots to `.verify-app/evidence/<run-id>/<flow>.png`. Cleanup never deletes this folder.

## Cleanup

`kill -- -"$(cat .verify-app/run/app.pgid)"`, confirm port 4317 is free, delete `.verify-app/run/`.
MD

git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
git add -A
git commit -q -m "Initial commit"

# The uncommitted UI change the proof is for.
cat > app/pricing/page.tsx <<'TSX'
"use client";
import { useState } from "react";

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <main>
      <h1>Pricing</h1>
      <button type="button" onClick={() => setYearly(!yearly)}>
        {yearly ? "Bill monthly" : "Bill yearly"}
      </button>
      <p>{yearly ? "$96/year" : "$10/month"}</p>
    </main>
  );
}
TSX
