---
tags: [harvest]
max_turns: 12
allowed_tools: [Skill, Read, Glob, Grep]
---

I've now corrected agents three times in this repo for calling `fetch` directly in components instead of going through our `apiClient` wrapper in `lib/api.ts`. Harvest this into something durable so it stops happening.
