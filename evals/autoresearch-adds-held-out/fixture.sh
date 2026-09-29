#!/usr/bin/env bash
set -euo pipefail

mkdir -p skills/demo-skill

cat > skills/demo-skill/SKILL.md <<'SKILL'
---
name: demo-skill
description: Summarize a bug report into a one-line title, a severity label, and numbered repro steps.
---

# Demo Skill

Given a raw bug report, write a one-line title, a severity label (low, medium,
high), and numbered reproduction steps with one action per step.
SKILL

cat > skills/demo-skill/RESEARCH.md <<'SEED'
# AutoResearch Config: demo-skill

## Test Inputs

### Test 1: checkout crash
Checkout page goes blank on Safari after I apply a coupon. Happens every time.

### Test 2: slow search
Search takes 10 seconds when the query has an apostrophe in it.

## Checklist

- [ ] title is one line
- [ ] severity is one of low, medium, high
- [ ] each repro step is one action

## Settings
- samples: 3
- min_improvement: 0.05
- max_rounds: 50
SEED
