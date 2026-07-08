---
name: ci-lint-smoke-test
kind: convention
added-by: cc-settings-ci
---

## What

A minimal, schema-valid knowledge note checked into the repo so CI's
`lint:knowledge` step has real content to lint instead of running with no
directory specified.

## Why

Without a fixture, the CI step only proved the script runs cleanly (it
printed "no directory specified" and exited 0) — a regression in the actual
linting logic (schema checks, name/filename mismatch, supersedes-unknown
warning) would never be caught in CI.

## How to apply

Keep this note's frontmatter and filename stem in sync (`name` must equal
`ci-lint-smoke-test`) so it keeps passing `lintKnowledgeDir` cleanly. Don't
add real team knowledge here — this file exists only to give CI something
to lint; real notes live in the team-knowledge repo.
