---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.css"
  - "**/*.scss"
  - "app/**/*"
  - "components/**/*"
---

# UI Bug-Fix Workflow

> Screenshot-first. Name the cause before you touch the CSS.

---

## DO

### Confirm the symptom visually before editing
Request a screenshot, video, or `mcp__chrome-devtools__take_snapshot` of the broken element's computed styles. Identify the **exact offending property** on the **exact offending node** before proposing a fix.

### Name the cause in one sentence
A real cause sounds like:
> "The Lenis scroller has `height: 100vh` which excludes iOS browser chrome; needs `100svh`."

A guess sounds like:
> "I think it might be `safe-area-inset`."

If you can only produce the second sentence, you don't have the cause — you have a guess. Stop and gather more signal.

---

## DON'T

### Don't sprinkle `env(safe-area-inset-*)` defensively
```css
/* WRONG: padding added across 4 files before confirming which element clips */
.header  { padding-top: env(safe-area-inset-top); }
.main    { padding-top: env(safe-area-inset-top); }
.modal   { padding-top: env(safe-area-inset-top); }
```
Identify the one element causing the cutoff first. One precise rule beats four hopeful ones.

### Don't ship `h-screen` / `100vh` on iOS-facing scrollers
```tsx
// WRONG: Lenis or fullscreen scrollers — iOS browser chrome cuts the bottom
<div className="h-screen overflow-y-auto">
// CORRECT
<div className="h-svh overflow-y-auto">
```
`100svh` / `h-svh` matches the smallest viewport (chrome visible). Use `100dvh` only when the layout is meant to grow with chrome retraction.

### Don't rebuild a native input to fix a styling diff
Safari and Chrome render `<input type="date">` pickers differently. Before building a custom date component:
- Try `appearance: none` + minimal reset
- Consider `type="text"` with a parser if the picker UI is the only problem

A custom date picker is a week of work and a permanent maintenance tax. Exhaust the reset path first.

---

## Workflow

1. Screenshot or snapshot the broken state
2. Inspect computed styles on the offending node
3. State the cause in one sentence
4. Make the smallest fix that addresses that cause
5. Re-screenshot to confirm
