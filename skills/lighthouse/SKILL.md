---
name: lighthouse
description: Lighthouse audit + improvement loop until targets met. Triggers "lighthouse", "page speed", "improve scores", "LCP", "CLS", "INP", "core web vitals". Repo-wide perf audits ("perf audit") go to /audit performance mode instead.
context: fork
argument-hint: "[url]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - LS
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__lighthouse_audit
requires:
  - command: lighthouse
    install: "npm i -g lighthouse (CLI, used for batched 3x3 averaged audits)"
  - mcp: chrome-devtools
    install: "chrome-devtools MCP — provides on-demand audits + visual regression screenshots"
---

# Lighthouse Optimization Loop

Set a product-neutral scratch root once:

```bash
LIGHTHOUSE_DIR="${TMPDIR:-/tmp}/cc-settings-lighthouse"
mkdir -p "$LIGHTHOUSE_DIR"
```

Use the Chrome DevTools MCP only when the user configured it. Standalone Codex
otherwise uses the Lighthouse CLI plus native/manual screenshots; if no visual
capture path exists, stop before changing UI and report that visual regression
verification is unavailable. This package does not auto-run unpinned registry
MCP packages.

**Method:** 3 mobile + 3 desktop runs per audit, averaged for reliability. After each code change, re-audit and visually verify the page with the configured MCP or the stated manual fallback.

---

## Setup

1. **Parse URL** from `$ARGUMENTS`. If no URL, ask the user. Default: `http://localhost:3000`

2. **Verify prerequisites:**
   ```bash
   lighthouse --version    # CLI must be installed for the batched 3x3 protocol
   ```
   If lighthouse is missing: `npm install -g lighthouse`
   If runs fail with a chrome-launcher error or every metric comes back
   `NO_LCP`/null, no system Chrome exists — find a real Chrome/Chromium binary
   (Chrome for Testing, Playwright's `chromium-*` — NOT `chrome-headless-shell`,
   which produces NO_LCP) and export `CHROME_PATH=<binary>` before the loop.
   Record which binary was used; a before/after comparison is only clean when
   both sides ran the same binary.
   Check whether the user configured the chrome-devtools MCP. Do not install or
   auto-run an unpinned registry MCP on their behalf.

3. **Create results directory:**
   ```bash
   mkdir -p "$LIGHTHOUSE_DIR"
   ```

4. **Take baseline screenshots** before any changes:
   - `mcp__chrome-devtools__navigate_page` (type: "url", url: `<url>`)
   - `mcp__chrome-devtools__take_screenshot`

   Describe the current layout, key elements, and visual state. This is your **visual baseline** — you will compare against it after every change to catch regressions.

5. **Confirm with user:** Show the URL, confirm the dev server is running, ask if there are specific pages or routes to audit beyond the main URL.

---

## Audit Protocol

Each audit consists of **3 mobile + 3 desktop runs**, averaged per category.

### Run the audits

```bash
# Mobile runs (Lighthouse default is mobile)
for i in 1 2 3; do
  lighthouse <url> \
    --output=json \
    --output-path="$LIGHTHOUSE_DIR/mobile-$i.json" \
    --chrome-flags="--headless --no-sandbox" \
    --only-categories=performance,accessibility,best-practices,seo \
    --quiet \
    2>/dev/null
done

# Desktop runs
for i in 1 2 3; do
  lighthouse <url> \
    --output=json \
    --output-path="$LIGHTHOUSE_DIR/desktop-$i.json" \
    --chrome-flags="--headless --no-sandbox" \
    --preset=desktop \
    --only-categories=performance,accessibility,best-practices,seo \
    --quiet \
    2>/dev/null
done
```

### Extract scores

For each JSON result file:
```bash
cat "$LIGHTHOUSE_DIR/mobile-1.json" | \
  jq '{
    performance: (.categories.performance.score * 100),
    accessibility: (.categories.accessibility.score * 100),
    bestPractices: (.categories["best-practices"].score * 100),
    seo: (.categories.seo.score * 100)
  }'
```

### Compute averages

Average the 3 runs per category for both mobile and desktop. Report as:

```
## Audit Results

| Category | Mobile (avg) | Desktop (avg) |
|----------|-------------|---------------|
| Performance | XX | XX |
| Accessibility | XX | XX |
| Best Practices | XX | XX |
| SEO | XX | XX |
```

### Extract failing audits

From the JSON, find specific audits that failed or scored poorly:
```bash
cat "$LIGHTHOUSE_DIR/mobile-1.json" | \
  jq '.audits | to_entries[] | select(.value.score != null and .value.score < 0.9) | {id: .key, score: .value.score, title: .value.title, description: .value.displayValue}'
```

Sort by impact (lowest scores first). These drive the improvement loop.

---

## Diagnose From the JSON, Not From a Narrative

Before planning any fix, re-derive the bottleneck from the report you just ran.
Prior session notes, state files, and issue write-ups go stale and get root
causes wrong — treat them as hypotheses to check against the JSON, never as the
diagnosis.

**Classify the perf gap first:**

- **TBT high (hundreds of ms)** → main-thread problem. Long tasks, hydration,
  script execution. `mainthread-work-breakdown` and `long-tasks` tell you where.
- **TBT low (~tens of ms) but LCP high under `throttlingMethod=simulate`** →
  bytes-on-critical-path problem, NOT execution. Lantern replays observed
  traffic over simulated slow 4G, so eager bytes inflate LCP even when the page
  is actually fast. Fixes that defer *execution* will not move this; only
  removing or lazy-loading *bytes* will.

Do not read `mainthread-work-breakdown`'s total as "blocking work before
paint" — it is the whole page load. TBT is the blocking measure.

**For bytes-on-critical-path gaps, attribute before fixing:**

```bash
jq '.audits["resource-summary"].details.items[] | {resourceType, requestCount, transferSize}' "$LIGHTHOUSE_DIR/mobile-1.json"
jq '.audits["bootup-time"].details.items[:5]' "$LIGHTHOUSE_DIR/mobile-1.json"
jq '.audits["network-requests"].details.items | sort_by(-.transferSize)[:10] | .[] | {transferSize, resourceType, url}' "$LIGHTHOUSE_DIR/mobile-1.json"
```

Hunt for bytes that ship but do nothing: preloaded fonts no style consumes
(a grep hit on the font file may be its own declaration — check for a real
consumer), and libraries a `next/dynamic` wrapper claims to defer while a
second static import path pulls them in anyway. Verify eager-path claims
against the build manifest (`.next/build-manifest.json` on Next.js), not
against the wrapper's existence. A `next/dynamic({ssr:false})` component that
renders unconditionally still fetches its chunk at hydration — deferral only
pays when the render is conditional.

---

## Improvement Loop

> **Autonomous mode:** to drive this loop turn-by-turn without re-prompting, set
> `/goal mobile and desktop scores in all four categories meet their targets, or stop after 20 rounds`.
> A goal evaluator (Haiku by default) reads the audit table after each turn and decides whether to continue.
> See [/goal docs](https://code.claude.com/docs/en/goal).

```
LOOP until all scores >= 90 or user interrupts:

  1. IDENTIFY the lowest-scoring category and its top failing audits
     - Read the Lighthouse audit details for specific recommendations
     - Cross-reference with the project's performance rules

  2. PLAN one targeted fix
     - Focus on the highest-impact failing audit
     - One fix at a time — never batch multiple unrelated changes
     - Common fixes by audit:
       • render-blocking-resources → async/defer scripts, inline critical CSS
       • largest-contentful-paint → priority attribute, preload, optimize image
       • cumulative-layout-shift → explicit dimensions, font-display
       • unused-javascript → dynamic imports, code splitting
       • uses-responsive-images → srcSet + sizes, `next/image` (satus) or `<picture>`/`vite-imagetools` (novus), proper dimensions
       • uses-text-compression → verify gzip/brotli enabled
       • image-size-responsive → width/height attributes
       • unminified-javascript → check build config
       • dom-size → reduce DOM nodes, virtualize lists
       • third-party-summary → defer/lazy-load third-party scripts
       • font-display → font-display: swap or optional
       • offscreen-images → loading="lazy" (NOT on above-fold/LCP images)

  3. IMPLEMENT the fix
     - Edit the relevant source files
     - Keep changes minimal and focused

  4. VERIFY BUILD
     - Run the project build to ensure no compilation errors
     - If TypeScript project: `tsc --noEmit` first

  5. VISUAL REGRESSION CHECK
     - `mcp__chrome-devtools__navigate_page` to the same URL
     - `mcp__chrome-devtools__take_screenshot`
     - Compare against the baseline screenshot:
       • Layout intact? (same general structure, no collapsed/missing sections)
       • Content visible? (text, images, interactive elements still present)
       • Styling correct? (colors, spacing, typography not broken)
       • Functionality preserved? (interactive elements still look clickable)
     - If regression detected: REVERT the change immediately and try a different approach
     - Also check critical user flows if the change affects interactive elements:
       - `mcp__chrome-devtools__take_snapshot` (a11y tree — confirms interactive elements are present, returns `uid`s)
       - `mcp__chrome-devtools__take_screenshot` (visual verification)

  6. RE-AUDIT
     - Run full audit protocol again (3 mobile + 3 desktop)
     - Compare against previous scores

  7. LOG RESULTS
     - Append to `$LIGHTHOUSE_DIR/results.tsv`:
       round	mobile_perf	desktop_perf	mobile_a11y	desktop_a11y	status	description
     - Status: "kept" (scores improved), "reverted" (regression or no improvement)

  8. REPORT
     - Show score delta: "Performance: 72 → 85 (+13)"
     - Show what was changed and why
     - Show the current failing audits for the next round
     - Every claimed delta needs BOTH sides measured on the SAME basis:
       • Bundle/byte savings: never quote a number from one build. Wipe the
         build output dir on both sides first — chunk dirs accumulate stale
         hashed files across builds, and a dirty-dir comparison can invert
         the sign of the result.
       • Never compare transfer bytes (from the Lighthouse JSON) against
         on-disk bytes — same basis or no claim.
       • A change measured worse gets reported worse, then reverted.

  9. CONTINUE to next round
```

---

## Visual Regression Protocol

This is the critical safety net. Performance changes MUST NOT break the UI.

### After every code change:

1. **Navigate:** `mcp__chrome-devtools__navigate_page` (type: "url", url: `<url>`)
2. **Screenshot:** `mcp__chrome-devtools__take_screenshot`
3. **Compare** against baseline:
   - Is the page layout the same structure?
   - Are all visible elements still present?
   - Is text readable and properly styled?
   - Are images displaying correctly?
   - Are interactive elements (buttons, forms, nav) visually intact?

### Regression = immediate revert

If any visual regression is detected:
1. `git checkout -- <changed-files>` to revert
2. Log status as "reverted (visual regression)" in results.tsv
3. Try an alternative approach to the same audit issue
4. NEVER accept a performance improvement that breaks the UI

### Multi-page checks

If the user specified multiple URLs/routes, check ALL of them after each change. A fix that improves the homepage but breaks a subpage is still a regression.

---

## Targets

Default targets (override by telling the agent different ones):

| Category | Mobile | Desktop |
|----------|--------|---------|
| Performance | >= 90 | >= 95 |
| Accessibility | >= 95 | >= 95 |
| Best Practices | >= 95 | >= 95 |
| SEO | >= 95 | >= 95 |

The loop continues until ALL categories on BOTH mobile and desktop meet their targets, or the user interrupts.

---

## Core Web Vitals Focus

When Performance score is low, prioritize these metrics:

| Metric | Target | What to Fix |
|--------|--------|-------------|
| LCP < 2.5s | Optimize largest content element (usually hero image or heading). Use `priority`, `fetchpriority="high"`, preload, optimize image format/size. |
| INP < 200ms | Reduce JavaScript execution time. Debounce handlers, use `startTransition`, yield to main thread with `scheduler.yield()`. |
| CLS < 0.1 | Set explicit dimensions on images/video/ads/embeds. Use `font-display: optional`. Reserve space for dynamic content. |
| TTFB < 800ms | Server-side: check caching, CDN, database queries. Use streaming SSR with `Suspense`. |

---

## Dashboard

After each round, write `$LIGHTHOUSE_DIR/dashboard.md`:

```markdown
# Lighthouse Optimization: <url>
Updated: <timestamp>

## Current Scores
| Category | Mobile | Desktop | Target | Status |
|----------|--------|---------|--------|--------|
| Performance | XX | XX | 90/95 | pass/fail |
| Accessibility | XX | XX | 95/95 | pass/fail |
| Best Practices | XX | XX | 95/95 | pass/fail |
| SEO | XX | XX | 95/95 | pass/fail |

## Progress (baseline → current)
| Category | Mobile | Desktop |
|----------|--------|---------|
| Performance | 62 → 91 (+29) | 78 → 96 (+18) |
| ... |

## Changes Applied
| Round | Fix | Mobile Perf Delta | Visual QA |
|-------|-----|-------------------|-----------|
| 1 | Added priority to hero image | +12 | pass |
| 2 | Deferred analytics script | +8 | pass |
| 3 | Added font-display: swap | +3 | pass |

## Remaining Issues
Top failing audits still to address...
```

---

## Completion

When all targets are met:
1. Print final score summary with deltas from baseline
2. List all changes made (files modified and why)
3. Suggest running a final full visual QA: `/qa <url>`
4. Do NOT auto-commit — let the user review the changes first
