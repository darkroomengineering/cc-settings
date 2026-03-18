---
name: lighthouse
description: |
  Lighthouse performance optimization loop with visual regression protection.
  Runs audits, improves scores, and verifies UI isn't broken. Use when:
  - User says "lighthouse", "performance audit", "page speed"
  - User wants to "improve scores", "optimize performance", "fix web vitals"
  - User mentions "LCP", "CLS", "INP", "core web vitals"
  - User says "speed up", "slow page", "performance issues"
context: fork
argument-hint: "<url>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - MultiEdit
  - Grep
  - Glob
  - LS
---

# Lighthouse Optimization Loop

Run Lighthouse audits, improve scores, verify UI isn't broken. Repeat until targets are met.

**Method:** 3 mobile + 3 desktop runs per audit, averaged for reliability. After each code change, re-audit AND visually verify the page with pinchtab to catch regressions.

---

## Setup

1. **Parse URL** from `$ARGUMENTS`. If no URL, ask the user. Default: `http://localhost:3000`

2. **Verify prerequisites:**
   ```bash
   lighthouse --version    # Must be installed
   pinchtab health         # Must be available for visual QA
   ```
   If lighthouse is missing: `npm install -g lighthouse`
   If pinchtab is broken: `npm rebuild pinchtab` or `bun update -g pinchtab`

3. **Create results directory:**
   ```bash
   mkdir -p ~/.claude/tmp/lighthouse
   ```

4. **Take baseline screenshots** with pinchtab before any changes:
   ```bash
   pinchtab nav <url>
   pinchtab screenshot
   ```
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
    --output-path=~/.claude/tmp/lighthouse/mobile-$i.json \
    --chrome-flags="--headless --no-sandbox" \
    --only-categories=performance,accessibility,best-practices,seo \
    --quiet \
    2>/dev/null
done

# Desktop runs
for i in 1 2 3; do
  lighthouse <url> \
    --output=json \
    --output-path=~/.claude/tmp/lighthouse/desktop-$i.json \
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
cat ~/.claude/tmp/lighthouse/mobile-1.json | \
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
cat ~/.claude/tmp/lighthouse/mobile-1.json | \
  jq '.audits | to_entries[] | select(.value.score != null and .value.score < 0.9) | {id: .key, score: .value.score, title: .value.title, description: .value.displayValue}'
```

Sort by impact (lowest scores first). These drive the improvement loop.

---

## Improvement Loop

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
       • uses-responsive-images → srcSet, next/image, proper sizing
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
     - Navigate pinchtab to the same URL
     - Take a screenshot
     - Compare against the baseline screenshot:
       • Layout intact? (same general structure, no collapsed/missing sections)
       • Content visible? (text, images, interactive elements still present)
       • Styling correct? (colors, spacing, typography not broken)
       • Functionality preserved? (interactive elements still look clickable)
     - If regression detected: REVERT the change immediately and try a different approach
     - Also check critical user flows if the change affects interactive elements:
       ```bash
       pinchtab nav <url>
       pinchtab snap -i -c    # Check interactive elements are present
       pinchtab screenshot     # Visual verification
       ```

  6. RE-AUDIT
     - Run full audit protocol again (3 mobile + 3 desktop)
     - Compare against previous scores

  7. LOG RESULTS
     - Append to ~/.claude/tmp/lighthouse/results.tsv:
       round	mobile_perf	desktop_perf	mobile_a11y	desktop_a11y	status	description
     - Status: "kept" (scores improved), "reverted" (regression or no improvement)

  8. REPORT
     - Show score delta: "Performance: 72 → 85 (+13)"
     - Show what was changed and why
     - Show the current failing audits for the next round

  9. CONTINUE to next round
```

---

## Visual Regression Protocol

This is the critical safety net. Performance changes MUST NOT break the UI.

### After every code change:

1. **Navigate:** `pinchtab nav <url>`
2. **Screenshot:** `pinchtab screenshot`
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

After each round, write `~/.claude/tmp/lighthouse/dashboard.md`:

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
