---
name: figma
description: |
  Figma desktop integration via pinchtab + Figma MCP. Use when:
  - User says "compare to design", "design fidelity", "match the figma"
  - User asks to "extract tokens from figma", "inspect in figma"
  - User wants to screenshot a Figma frame for comparison
  - User mentions "figma" in the context of visual QA or token extraction
  - User wants to navigate Figma files and inspect components
context: fork
allowed-tools: [Bash, mcp__figma__*]
---

# Figma Desktop Integration

Combines Figma MCP (structured data) with pinchtab browser control (visual interaction) for design-to-code workflows.

**MCP** = tokens, styles, component props, file structure.
**PinchTab** = screenshots, navigation, layer inspection, interactive exploration.

## Prerequisites

Requires `pinchtab` (installed by `setup.sh`). Figma desktop app must be installed. The Figma Dev Mode MCP must be configured in settings.

---

## Connecting to Figma Desktop

### Launch with Remote Debugging

```bash
# macOS — launch Figma with debugging port
open -a "Figma" --args --remote-debugging-port=9222
```

If Figma is already running, quit it first, then relaunch with the flag.

### Connect PinchTab via CDP

```bash
# Launch a persistent Figma profile instance connected via CDP
CDP_URL=ws://localhost:9222 pinchtab instance launch --profile=figma --mode headed

# List available tabs/windows
pinchtab tabs

# Switch to the correct tab (Figma file)
pinchtab tab info <tab-id>
```

### Verify Connection

```bash
pinchtab screenshot
# Should show the Figma canvas
```

---

## Workflows

### 1. Design-to-Code QA

Compare a Figma frame directly against the running implementation.

```bash
# Step 1: Connect and screenshot the Figma frame
open -a "Figma" --args --remote-debugging-port=9222
CDP_URL=ws://localhost:9222 pinchtab instance launch --profile=figma --mode headed
# Navigate to the target frame in Figma
pinchtab screenshot  # Capture the design

# Step 2: Screenshot the implementation
pinchtab nav http://localhost:3000/target-page
pinchtab screenshot  # Capture the implementation

# Step 3: Compare
# Use the /qa comparison review output format
```

**Output format:** Use the "Comparison Review (Implementation vs Mockup)" format from `/qa`:

```
## Design vs Implementation Review

**Fidelity score:** [1-10] / 10

### Deviations Found
1. **[Element]:** Mockup shows [X], implementation has [Y]
   Impact: [High/Medium/Low]
   -> **Fix:** [How to match the mockup]

### Matching Well
- [Elements that accurately match the design]
```

### 2. Token Extraction

Pull design tokens from Figma — use MCP for structured data, PinchTab for visual inspection fallback.

**MCP first (preferred):**
- Use `mcp__figma__*` tools to extract colors, typography, spacing, effects
- MCP gives exact values: hex codes, font stacks, rem/px values

**PinchTab fallback (when MCP doesn't expose it):**
```bash
# Assumes Figma is connected — see "Connecting to Figma Desktop" above
pinchtab screenshot  # Capture the inspect panel values
# Read values from the dev mode measurements
```

Use PinchTab when you need:
- Values from the inspect panel that MCP doesn't expose
- Dev mode measurements and red-line specs
- Layer-specific overrides or computed values

### 3. Component Inspection

Navigate Figma files interactively to inspect components, states, and variants.

```bash
# Assumes Figma is connected — see "Connecting to Figma Desktop" above
pinchtab screenshot  # See current state

# Use Figma's UI to switch variants, states
pinchtab snap -i -c  # Get accessibility tree for clickable elements
pinchtab click e5    # Click variant switcher, state toggle, etc.
pinchtab screenshot  # Capture the new state
```

Use this for:
- Reviewing all component variants (hover, active, disabled, error)
- Checking responsive breakpoint frames
- Inspecting layer structure and naming
- Verifying design system component usage

---

## Persistent Profiles

PinchTab supports persistent profiles so Figma auth persists across sessions:

```bash
# First time — launches browser, you log in to Figma
pinchtab instance launch --profile=figma --mode headed

# Future sessions — reuses saved profile (no re-auth needed)
pinchtab instance launch --profile=figma --mode headed
```

---

## Tips

- **Always screenshot after navigation** to confirm you're looking at the right frame
- **Use MCP for data, PinchTab for visuals** — don't screenshot when MCP can give you exact values
- **Match viewport sizes** when comparing design vs implementation screenshots
- **Quit and relaunch Figma** if you need the debugging port and Figma is already running
- **Tab management matters** — Figma may have multiple files open, use `pinchtab tabs` to find the right one
- **Use `pinchtab text`** for quick content extraction before taking full screenshots
