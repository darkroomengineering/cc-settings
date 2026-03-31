---
name: debug
description: "Browser debugging with pinchtab CLI. Use when user mentions 'screenshot', 'visual bug', 'inspect element', 'what does it look like', or 'see the page'. Also use for debugging browser rendering, layout issues, UI testing, E2E debugging, or visual verification."
context: fork
allowed-tools: "Bash"
---

# Browser Debugging with PinchTab

AI-optimized browser automation for visual debugging. Requires `pinchtab` (installed by `setup.sh`).

## Workflow

1. **Navigate** to the target URL: `pinchtab nav http://localhost:3000`
2. **Text** for token-efficient page content (~800 tokens): `pinchtab text`
3. **Screenshot** if visual inspection needed: `pinchtab screenshot`
4. **Snap** for accessibility tree with element refs: `pinchtab snap -i -c`
5. **Interact** using element refs (e5, e12, etc.): `pinchtab click e5`
6. **Screenshot** again to verify changes

## Commands

| Command | Purpose |
|---------|---------|
| `pinchtab nav <url>` | Navigate to URL |
| `pinchtab text` | Token-efficient page text (~800 tokens) |
| `pinchtab screenshot` | Take screenshot |
| `pinchtab snap -i -c` | Interactive compact accessibility snapshot |
| `pinchtab click <ref>` | Click element by ref |
| `pinchtab fill <ref> "text"` | Clear + set input value |
| `pinchtab type <ref> "text"` | Type keystrokes |
| `pinchtab press <key>` | Press keyboard key (Enter, Tab, Escape) |
| `pinchtab hover <ref>` | Hover over element |
| `pinchtab scroll <dir>` | Scroll page (up/down) |
| `pinchtab select <ref> "text"` | Select dropdown option |
| `pinchtab find "label"` | Semantic element discovery |
| `pinchtab eval "js"` | Execute JavaScript |
| `pinchtab health` | Health check |

## Element References

The accessibility snapshot assigns each element a unique ref (e.g., `e1`, `e2`). Use these refs for reliable targeting — no `@` prefix needed.

## Example: Interactive Form Testing

```bash
pinchtab nav http://localhost:3000/form
pinchtab snap -i -c
pinchtab fill e2 "test@example.com"
pinchtab press Tab
pinchtab fill e3 "password123"
pinchtab click e5
pinchtab screenshot
```

## Output

Return findings including visual state, issues found, accessibility tree structure, and fix recommendations.
