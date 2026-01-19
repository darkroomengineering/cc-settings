---
name: qa
description: Visual QA validation with agent-browser - screenshot, a11y check, design review
arguments:
  - name: target
    description: URL, component name, or "current" for dev server
    required: false
---

# Visual QA Validation

**Usage:** `/qa [target]` or just `/qa` to validate current dev server

## Quick Start

```bash
# Validate current dev server (auto-detects port)
/qa

# Validate specific URL
/qa http://localhost:3000/about

# Validate specific component (opens Storybook if available)
/qa Button
```

## Workflow

1. **Navigate** to target URL (dev server, Storybook, or production)
2. **Screenshot** the current viewport
3. **Snapshot** the accessibility tree
4. **Validate** against design guidelines:
   - A11y: Missing labels, contrast, focus indicators
   - UI: Layout issues, spacing, typography
   - Responsive: Check mobile viewport if needed
5. **Report** issues with screenshots and fix suggestions

## Automated Checks

| Check | What It Validates |
|-------|-------------------|
| **Accessibility** | aria-labels, alt text, heading hierarchy, focus order |
| **Touch Targets** | Minimum 44x44px for interactive elements |
| **Contrast** | Text meets 4.5:1 ratio |
| **Layout** | No overflow, proper spacing, alignment |
| **Typography** | Correct font sizes, line heights |
| **States** | Hover, focus, disabled, loading, error states |

## Commands Used

```bash
# Navigate to dev server
agent-browser navigate http://localhost:3000

# Take screenshot
agent-browser screenshot

# Get accessibility tree
agent-browser snapshot

# Check specific element
agent-browser click @e5
agent-browser snapshot
```

## Integration with Post-Edit Hook

After editing `.tsx`/`.jsx` files, you'll see a reminder:
```
🔍 AUTO-REVIEW + VISUAL QA
Run /qa to validate visually
```

## Multi-Viewport Testing

```bash
# Desktop (default)
/qa http://localhost:3000

# Then request mobile
"Now check mobile viewport (375px)"
```

## Example Session

```
User: /qa

Claude: Let me validate the current dev server visually.

[Navigates to http://localhost:3000]
[Takes screenshot]
[Gets accessibility snapshot]

Visual QA Report:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Layout: No overflow issues
✓ Typography: Headings use correct scale
⚠ A11y: Button @e12 missing aria-label (icon-only)
⚠ Contrast: Text in footer (#6b7280 on #f9fafb) is 3.8:1, needs 4.5:1
✗ Touch: Menu button is 32x32px, needs 44x44px minimum

Fixes:
1. Add aria-label="Menu" to header button
2. Change footer text to text-gray-600 (#4b5563)
3. Increase menu button padding to p-3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Delegates to

`tester` agent with agent-browser tools

## Requirements

- `agent-browser` installed globally (`npm i -g agent-browser`)
- Dev server running (Next.js, Vite, etc.)
- Chrome/Chromium available
