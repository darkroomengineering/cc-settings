# verify-app template

The template for a project's own app verification skill. It lives in the
project at `.claude/skills/verify-app/SKILL.md`, not in the cc-settings skill
library. Proof of work uses it for the UI and feature step, and `/dr-init`
writes one after scaffolding.

## How to fill it in

Read the project, not the user, and ask only for what the repo cannot show:

- **Launch:** the `dev`, `start`, or `preview` script in `package.json`, the
  framework's default port, and any port or env var the README or `.env.example`
  names.
- **Routes:** the route files. Next.js App Router: every `page.tsx` under
  `app/`, where `(group)` folders add no URL segment and `[slug]` needs a real
  value. React Router: `app/routes.ts` or the files in `app/routes/`.
- **Key flows:** what a visitor does on each important route: navigate, open
  a menu, submit a form, play media. Start with three to five flows; the map
  grows with the app.
- **Selectors:** accessible names and roles from the components (`aria-label`,
  button text, headings, `data-testid`), never coordinates or DOM position.

Replace every `{{...}}` placeholder with what the repo shows. A section the
project does not need reads "None" and the reason. Before handing the skill
over, run it once: launch, doctor, drive one flow, save evidence, clean up,
then confirm the evidence is still there. A skill that never ran is a draft.

## What a generated skill can and cannot prove

It proves that the flows in its map work in a local build on this machine, in
the browser it drove, with the data it had. It does not prove that unmapped
routes work, that production data, auth, or third-party services behave the
same, that the page looks right at every breakpoint, or that a flow the map
describes wrongly is correct. Its steps come from reading the code, so a step
can be wrong until a run confirms it. Report what the run covered and what it
did not.

## Template

````markdown
---
name: verify-app
description: Launch {{app name}} locally, drive its key flows in a real browser, and save evidence. Use to prove a UI or feature change works before review.
---

# Verify {{app name}}

Drives the running app the way a visitor does and saves evidence of each step.
Run the sections in order. Cleanup runs even when a step fails.

## Launch

- Command: `{{bun dev}}` from the repo root, started in the background in its
  own process group, since a dev script usually forks the real server:
  `set -m; {{bun dev}} > .verify-app/run/app.log 2>&1 & echo $! > .verify-app/run/app.pgid`.
  With job control on, the background job's pid is also its process group id.
- URL: `{{http://localhost:3000}}`. Port: `{{3000}}`, or `PORT={{port}}` when
  that port is taken.
- Ready when: `{{the "Ready in" line in the log}}`, and
  `curl -fsS {{http://localhost:3000}}` returns 200. A process that answers is
  not ready until the first route renders.
- Env: `{{.env.local copied from .env.example}}`. Never print secret values.

## Doctor

Run before the first drive, and again after any failed step:

- Prerequisites: `{{bun --version}}`, dependencies installed
  (`{{bun install --frozen-lockfile}}`), env file present.
- Port owner: the listener from `lsof -nP -t -iTCP:{{3000}} -sTCP:LISTEN`
  belongs to this run's process group (`ps -o pgid= -p <listener pid>` equals
  `.verify-app/run/app.pgid`), not to another app. Never drive an instance
  this run did not start.
- Failed launch: read the last 50 lines of `.verify-app/run/app.log`. Usual
  causes: {{port in use, missing env var, failed build}}.

## Drive

Use the Playwright MCP, or the chrome-devtools MCP through the `tester` agent.
Prefer roles and accessible names (`getByRole("link", { name: "About" })`) over
CSS selectors. Wait for an element or a network response, never a fixed sleep.

### Feature map

One entry per key flow. Each entry gives the route, the steps, and the result
that proves it works.

| Flow | Route | Steps | Expected result |
|---|---|---|---|
| {{flow}} | {{route}} | {{steps}} | {{observable end state}} |

Example for a Next.js App Router site:

| Flow | Route | Steps | Expected result |
|---|---|---|---|
| Home renders | `/` | Open the page | The `h1` is visible, no console errors, no failed requests |
| Primary navigation | `/` | Click the `About` link in the header | URL is `/about` and its `h1` is visible |
| Mobile menu | `/` at 390x844 | Click the button named `Open menu` | The navigation dialog opens and focus moves into it |
| Contact form | `/contact` | Fill `Name` and `Email`, click `Send` | A status reads `Message sent`; the request returned 2xx |
| Dynamic page | `/work/{{real slug}}` | Open a slug from the `/work` list | The page `h1` matches the list item's title |
| Not found | `/does-not-exist` | Open the page | The 404 page renders with a link back home |

## Evidence

- Save to `.verify-app/evidence/<run-id>/`, which is gitignored and which
  Cleanup never deletes.
- Per flow: a screenshot after the final step, plus the console errors and
  failed network requests seen during it.
- Name each file `<flow>-<step>.png` so the report can point at it.
- Report each flow as passed, failed (with the step and the evidence), or not
  run (with the reason). A flow is never reported passed through a different
  route than the map lists.

## Cleanup

- `kill -- -"$(cat .verify-app/run/app.pgid)"` stops the launcher and every
  process it forked. Kill only the process group this run started, never by
  name.
- Confirm `lsof -nP -iTCP:{{3000}} -sTCP:LISTEN` prints nothing.
- Delete `.verify-app/run/`. Keep `.verify-app/evidence/`.

## Upkeep

When a diff adds or changes a route or a key flow, update the feature map in
the same PR, then drive the changed flow once to confirm the entry.
````
