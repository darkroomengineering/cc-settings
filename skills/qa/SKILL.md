---
name: qa
description: |
  Visual QA validation with agent-browser. Use when:
  - User asks to "validate", "check visually", "QA check"
  - After creating or modifying components
  - Before PR submission
  - User mentions "accessibility", "a11y", "contrast", "touch targets"
  - User wants to verify UI looks correct
context: fork
allowed-tools: [Bash]
---

# Visual QA Validation

Comprehensive visual and accessibility validation using agent-browser.

## Quick Start

```bash
# Validate dev server
agent-browser navigate http://localhost:3000
agent-browser screenshot
agent-browser snapshot
```

## Validation Checklist

### Accessibility
- [ ] All images have `alt` text
- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have labels
- [ ] Heading hierarchy is correct
- [ ] Focus order is logical

### Touch Targets
- [ ] Interactive elements ≥ 44x44px
- [ ] Adequate spacing between targets

### Contrast
- [ ] Text meets 4.5:1 ratio
- [ ] UI elements are distinguishable

### Layout
- [ ] No horizontal overflow
- [ ] Proper spacing and alignment
- [ ] Responsive at different sizes

### States
- [ ] Hover states visible
- [ ] Focus indicators present
- [ ] Loading states implemented
- [ ] Error states clear

## Workflow

1. **Navigate** to target URL
2. **Screenshot** current state
3. **Snapshot** accessibility tree
4. **Analyze** against checklist
5. **Report** issues with fixes

## Commands

```bash
# Navigate
agent-browser navigate http://localhost:3000/page

# Screenshot
agent-browser screenshot

# Accessibility tree
agent-browser snapshot

# Interact with elements
agent-browser click @e5
agent-browser type @e3 "test input"
```

## Output

```
## QA Report: [Page/Component]

### Passed
- [x] Touch targets adequate
- [x] Heading hierarchy correct

### Issues
- [ ] Missing alt text on hero image
  → Add alt="..." to components/hero/index.tsx:15

- [ ] Contrast too low on muted text
  → Change text-gray-400 to text-gray-500

### Recommendations
- Consider adding loading skeleton for async content
```

## Prerequisites

```bash
npm i -g agent-browser@0.8.3
```
