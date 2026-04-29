---
name: docs
description: Fetch latest library/framework docs via Context7. MANDATORY before writing code with any external lib (gsap, lenis, three, framer, radix, sanity, zustand). Triggers "how to use X", "X docs", "X API".
context: fork
allowed-tools: [mcp__context7__resolve-library-id, mcp__context7__get-library-docs, WebFetch, WebSearch]
---

# Documentation Fetcher

**CRITICAL**: Always fetch current documentation before implementing with ANY external library. APIs change. Your training data is outdated.

## Using Context7 MCP

```bash
# Step 1: Resolve library ID
mcp__context7__resolve-library-id { "libraryName": "gsap" }

# Step 2: Fetch docs for specific topic
mcp__context7__get-library-docs {
  "context7CompatibleLibraryID": "greensock/docs",
  "topic": "ScrollTrigger",
  "tokens": 10000
}
```

## Common Libraries

| Library | Context7 ID | Topics |
|---------|-------------|--------|
| GSAP | `greensock/docs` | ScrollTrigger, Timeline, Tweens |
| Lenis | `darkroom/lenis` | setup, scrollTo, events |
| Three.js | `mrdoob/three.js` | Scene, Camera, Renderer |
| Framer Motion | `framer/motion` | animate, variants, gestures |
| Radix | `radix-ui/primitives` | Dialog, Dropdown, Tabs |
| Next.js | `vercel/nextjs` | App Router, Server Components |
| React | `facebook/react` | hooks, components, patterns |
| Sanity | `sanity-io/sanity` | GROQ, schemas, studio |

## Pre-Implementation Checklist

Before writing code with a library:
1. **Fetch docs** - Get current API documentation
2. **Check version** - Run `bun info <package>`
3. **Find examples** - Look for usage patterns in docs
4. **Verify imports** - Confirm correct import paths

## Output

After fetching docs, summarize:
- **Key APIs** needed for the task
- **Import statements** to use
- **Example usage** from docs
- **Gotchas** or important notes

## Remember

- NEVER write library code from memory
- Always verify current API before implementing
- Store useful discoveries as learnings
