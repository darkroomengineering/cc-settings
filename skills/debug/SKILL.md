---
name: debug
description: |
  Browser debugging with pinchtab CLI. Use when:
  - User mentions "screenshot", "visual bug", "inspect element"
  - User asks "what does it look like", "see the page"
  - Need to debug browser rendering, layout, or visual issues
  - User wants to test UI in browser
  - E2E debugging or visual verification
context: fork
allowed-tools: [Bash]
---

# Browser Debugging with PinchTab

AI-optimized browser automation for visual debugging. Token-efficient text extraction, persistent profiles, and stealth mode.

## Commands

```bash
# Navigate to a URL
pinchtab nav http://localhost:3000

# Token-efficient page text (~800 tokens — preferred first step)
pinchtab text

# Take screenshot
pinchtab screenshot

# Get interactive compact accessibility snapshot
pinchtab snap -i -c

# Click element by ref
pinchtab click e5

# Fill input (clear + set)
pinchtab fill e3 "search query"

# Type keystrokes
pinchtab type e3 "search query"

# Press keyboard keys
pinchtab press Enter
pinchtab press Tab
pinchtab press Escape

# Hover over element
pinchtab hover e5

# Scroll page
pinchtab scroll down
pinchtab scroll up

# Select dropdown option
pinchtab select e7 "Option text"

# Semantic element discovery
pinchtab find "search button"

# Execute JavaScript
pinchtab eval "document.title"

# Health check
pinchtab health
```

## Workflow

1. **Navigate** to the target URL
2. **Text** to get token-efficient page content (~800 tokens)
3. **Screenshot** if visual inspection needed
4. **Snap** to get accessibility tree with element refs
5. **Interact** using element refs (e5, e12, etc.)
6. **Screenshot** again to verify changes

## Element References

The accessibility snapshot gives each element a unique ref:

```
e1: button "Submit"
e2: textbox "Email"
e3: link "Home"
```

Use these refs for reliable element targeting. No `@` prefix needed.

## Common Debugging Tasks

### Visual Bug
```bash
pinchtab nav http://localhost:3000/broken-page
pinchtab text        # Quick content check first
pinchtab screenshot  # Visual inspection
```

### Interactive Testing
```bash
pinchtab nav http://localhost:3000/form
pinchtab snap -i -c
pinchtab fill e2 "test@example.com"
pinchtab press Tab
pinchtab fill e3 "password123"
pinchtab click e5
pinchtab screenshot
```

### Layout Inspection
```bash
pinchtab nav http://localhost:3000
pinchtab snap -i -c
# Analyze accessibility tree for structure
```

## Prerequisites

Requires `pinchtab` (installed by `setup.sh`).

## Output

Return findings:
- **Visual state**: What the page looks like
- **Issues found**: Layout problems, missing elements
- **Accessibility tree**: Key element structure
- **Recommendations**: How to fix issues
