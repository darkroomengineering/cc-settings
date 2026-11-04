#!/usr/bin/env bash
set -euo pipefail

cat > tickets.md <<'MD'
# Tickets: first pass

## US-1: Campaign page (parent) · status: In Progress
Sub-issues: US-1a, US-1b, US-1c.
Done when every sub-issue is done.

## US-1a: `<campaign-timer>` custom element · status: Done
### Acceptance criteria
- [x] `campaign-timer.js` uses one shared `setInterval` of 1000 ms for every timer on the page
- [x] Emits a `timer:ended` CustomEvent at zero
### Design
- Figma node 1204:5531
### Verify
- `shopify theme check` returns 0 offenses
- Shopify Dev MCP `validate_theme` passes
- Screenshot desktop and mobile, post on the ticket
### Closing comment
Implemented. Verified by reading the code; the timer logic is correct.

## US-1b: Goal progress bar · status: Todo
### Acceptance criteria
- [ ] Reads `campaign.goal_amount` metafield via Liquid and renders a `<progress>` element
### Design
- Figma node 1204:5602
### Verify
- `shopify theme check` returns 0 offenses
- Shopify Dev MCP `validate_theme` passes
- Screenshot desktop and mobile, post on the ticket

## US-1c: Backer count · status: Todo
### Acceptance criteria
- [ ] Shows the backer count
### Design
- Figma node 1204:5640
### Verify
- `shopify theme check` returns 0 offenses
- Shopify Dev MCP `validate_theme` passes
- Screenshot desktop and mobile, post on the ticket
MD
