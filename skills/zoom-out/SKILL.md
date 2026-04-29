---
name: zoom-out
description: Upward architectural map — modules, callers, where this fits in the larger system. Uses CONTEXT.md vocab. Triggers "zoom out", "bigger picture", "where does this fit", onboarding unfamiliar code.
---

# zoom-out

Counter to `/explore` (broad navigation) and `/tldr` (token-efficient analysis): this is a **focused upward zoom** when you're staring at a function or module and need to know how it fits.

## Workflow

1. Follow [../context-doc/DOMAIN-AWARENESS.md](../context-doc/DOMAIN-AWARENESS.md) — read `CONTEXT.md` and any relevant ADRs first if they exist.
2. Identify the symbol or file the user is asking about.
3. Use TLDR for the structural answer when available:

   ```bash
   tldr context <symbol> --depth 3 --project .
   tldr impact <symbol> --project .
   ```

4. Synthesize a map: list the immediate callers, the modules they live in, and where this area sits in the system. Use `CONTEXT.md` vocabulary when naming concepts.
5. Stop at one layer up. The user can ask for another zoom-out if they need it.

## Output shape

```
{Symbol/file in question}
  ↑ called by: {module A}, {module B}
  ↓ depends on: {module C}, {module D}

Where this fits:
{1–2 sentence narrative using CONTEXT.md terms}

Related ADRs:
- ADR-NNNN ({title}) — relevant because…
```

Keep it short. The point is orientation, not exhaustive coverage.
