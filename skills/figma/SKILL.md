---
name: figma
description: |
  Figma desktop integration via agent-browser Electron + Figma MCP. Use when:
  - User says "compare to design", "design fidelity", "match the figma"
  - User asks to "extract tokens from figma", "inspect in figma"
  - User wants to screenshot a Figma frame for comparison
  - User mentions "figma" in the context of visual QA or token extraction
  - User wants to navigate Figma files and inspect components
context: fork
allowed-tools: [Bash, mcp__figma__*]
---

# Figma Desktop Integration

Combines Figma MCP (structured data) with agent-browser Electron control (visual interaction) for design-to-code workflows.

**MCP** = tokens, styles, component props, file structure.
**Electron** = screenshots, navigation, layer inspection, interactive exploration.

## Prerequisites

Requires `agent-browser` (installed by `setup.sh`). Figma desktop app must be installed. The Figma Dev Mode MCP must be configured in settings.

---

## Connecting to Figma Desktop

### Launch with Remote Debugging

```bash
# macOS — launch Figma with debugging port
open -a "Figma" --args --remote-debugging-port=9222
```

If Figma is already running, quit it first, then relaunch with the flag.

### Connect agent-browser

```bash
# Connect to Figma's Electron process
agent-browser connect --electron --port 9222

# List available tabs/windows
agent-browser tabs

# Switch to the correct tab (Figma file)
agent-browser tab <tab-id>
```

### Verify Connection

```bash
agent-browser screenshot
# Should show the Figma canvas
```

---

## Workflows

### 1. Design-to-Code QA

Compare a Figma frame directly against the running implementation.

```bash
# Step 1: Connect and screenshot the Figma frame
open -a "Figma" --args --remote-debugging-port=9222
agent-browser connect --electron --port 9222
# Navigate to the target frame in Figma
agent-browser screenshot  # Capture the design

# Step 2: Screenshot the implementation
agent-browser navigate http://localhost:3000/target-page
agent-browser screenshot  # Capture the implementation

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

Pull design tokens from Figma — use MCP for structured data, Electron for visual inspection fallback.

**MCP first (preferred):**
- Use `mcp__figma__*` tools to extract colors, typography, spacing, effects
- MCP gives exact values: hex codes, font stacks, rem/px values

**Electron fallback (when MCP doesn't expose it):**
```bash
# Assumes Figma is connected — see "Connecting to Figma Desktop" above
agent-browser screenshot  # Capture the inspect panel values
# Read values from the dev mode measurements
```

Use Electron when you need:
- Values from the inspect panel that MCP doesn't expose
- Dev mode measurements and red-line specs
- Layer-specific overrides or computed values

### 3. Component Inspection

Navigate Figma files interactively to inspect components, states, and variants.

```bash
# Assumes Figma is connected — see "Connecting to Figma Desktop" above
agent-browser screenshot  # See current state

# Use Figma's UI to switch variants, states
agent-browser snapshot  # Get accessibility tree for clickable elements
agent-browser click @e5  # Click variant switcher, state toggle, etc.
agent-browser screenshot  # Capture the new state
```

Use this for:
- Reviewing all component variants (hover, active, disabled, error)
- Checking responsive breakpoint frames
- Inspecting layer structure and naming
- Verifying design system component usage

---

## Tips

- **Always screenshot after navigation** to confirm you're looking at the right frame
- **Use MCP for data, Electron for visuals** — don't screenshot when MCP can give you exact values
- **Match viewport sizes** when comparing design vs implementation screenshots
- **Quit and relaunch Figma** if you need the debugging port and Figma is already running
- **Tab management matters** — Figma may have multiple files open, use `agent-browser tabs` to find the right one
