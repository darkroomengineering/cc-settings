---
name: debug
description: Browser debugging with agent-browser - screenshots, DOM inspection, visual testing
arguments:
  - name: action
    description: What to debug (screenshot, inspect, click, type, etc.)
    required: true
---

**Usage:** `/debug <action>` or describe what you want naturally

**Auto-Setup:** The setup script installs agent-browser globally.

**Manual Install:** `npm i -g agent-browser`

**Natural Language:**

```
"Take a screenshot of the homepage"
"What does the login page look like?"
"Debug the visual bug on mobile"
"Click the submit button"
"Inspect the navigation menu"
```

**How It Works:**

agent-browser uses an **accessibility tree with unique element refs** (`@e1`, `@e2`, etc.) instead of DOM selectors. This makes LLM interactions more reliable:

1. **Snapshot** - Get accessibility tree of current page
2. **Select** - Reference elements by `@e1`, `@e2`, etc.
3. **Act** - Click, type, scroll using element refs

**Commands:**

| Action | Description | Example |
|--------|-------------|---------|
| `navigate` | Go to URL | `agent-browser navigate https://example.com` |
| `screenshot` | Capture page | `agent-browser screenshot` |
| `snapshot` | Get accessibility tree | `agent-browser snapshot` |
| `click` | Click element | `agent-browser click @e5` |
| `type` | Type text | `agent-browser type @e3 "hello"` |
| `scroll` | Scroll page | `agent-browser scroll down` |

**vs Playwright:**

| Aspect | agent-browser | Playwright |
|--------|---------------|------------|
| **Purpose** | AI browser automation | E2E testing |
| **Selection** | Accessibility refs (`@e1`) | DOM selectors |
| **Reliability** | Deterministic for LLMs | Requires selector construction |
| **Use Case** | Visual debugging, screenshots | Test suites |

**Note:** Playwright is still used for E2E test suites (`bun test:e2e`). agent-browser is for AI-assisted browser debugging.

**Delegates to:** `tester` agent

**Docs:** https://agent-browser.dev
