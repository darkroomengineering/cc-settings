---
name: figma
description: Figma MCP for design-to-code, fidelity checks, token extraction; implementation screenshots via chrome-devtools MCP. Triggers "compare to design", "match the figma", "extract tokens from figma", "inspect in figma".
context: fork
allowed-tools: [mcp__figma__*, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__take_snapshot, mcp__chrome-devtools__resize_page]
requires:
  - mcp: figma
    install: "Configure Figma MCP — see mcp-configs/recommended.json"
  - mcp: chrome-devtools
    install: "Configure chrome-devtools MCP — used to screenshot the running implementation"
---

# Figma Integration

Uses the Figma Dev Mode MCP for structured design data and chrome-devtools MCP for capturing the running implementation. The two combine to drive fidelity checks and token extraction without manual screenshots of Figma itself.

**Figma MCP** = tokens, styles, component props, dimensions, file structure — exact values, no pixel-pushing.
**Chrome DevTools MCP** = screenshots and a11y trees of the running implementation in the user's local dev server.

## Prerequisites

- Figma Dev Mode MCP configured (see `mcp-configs/recommended.json`)
- Figma desktop app installed; the file you're inspecting must be open in Dev Mode
- `chrome-devtools` MCP available (shipped by default in cc-settings)

---

## Workflows

### 1. Design-to-Code QA

Compare design spec from Figma MCP against the running implementation captured via chrome-devtools.

1. **Pull design spec from Figma MCP** — use `mcp__figma__*` tools to fetch the target frame's tokens, dimensions, typography, colors, and component props. This is the source of truth; prefer structured data over screenshots whenever the MCP exposes it.
2. **Capture the implementation** with chrome-devtools:
   - `mcp__chrome-devtools__navigate_page` (type: "url", url: "http://localhost:3000/target-page")
   - `mcp__chrome-devtools__resize_page` to match the Figma frame width
   - `mcp__chrome-devtools__take_screenshot` — captures the rendered page
3. **Diff structured data vs rendered output** and report deviations.

**Output format** — use the "Comparison Review (Implementation vs Mockup)" format from `/qa`:

```
## Design vs Implementation Review

**Fidelity score:** [1-10] / 10

### Deviations Found
1. **[Element]:** Figma spec says [X], implementation has [Y]
   Impact: [High/Medium/Low]
   -> **Fix:** [How to match the design]

### Matching Well
- [Elements that accurately match the design]
```

### 2. Token Extraction

Pull design tokens from Figma — MCP gives exact values without screenshotting.

**MCP first (always preferred):**
- Use `mcp__figma__*` tools to extract colors, typography, spacing, effects
- MCP returns exact values: hex codes, font stacks, rem/px values, shadow specs, border radii

**Fallback when MCP can't reach a value:**
- Ask the user to paste the value from Figma's Dev Mode inspect panel, OR
- Ask the user to export the frame as PNG/SVG so you can read it

We deliberately do not screenshot Figma's UI — Figma's MCP is the canonical interface; chasing pixels through a browser-automated Figma desktop window is brittle and unnecessary.

### 3. Component Inspection

Use `mcp__figma__*` to inspect component variants, states, and properties.

- List variants and their property values via Figma MCP
- Read the component's `properties` and `boundingBox` from MCP responses
- Cross-reference with the implementation by navigating each variant's URL or storybook page with `chrome-devtools__navigate_page` and screenshotting

Use this for:
- Reviewing all component variants (hover, active, disabled, error)
- Checking responsive breakpoint frames
- Inspecting layer structure and naming
- Verifying design system component usage

---

## Tips

- **MCP is the canonical Figma interface.** Don't try to script the Figma desktop UI — use the MCP tools.
- **Match viewport sizes** when comparing design vs implementation screenshots — use `resize_page` with the Figma frame's width.
- **Pull tokens, don't eyeball them.** If you find yourself reading hex codes off a screenshot, you're holding it wrong — Figma MCP returns them as data.
- **Use `take_snapshot` before `take_screenshot`** when interacting with the implementation — the a11y tree gives you `uid`s for click/fill targets at ~1/10th the token cost.
