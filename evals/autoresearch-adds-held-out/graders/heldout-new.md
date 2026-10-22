---
type: regex
target: { source: file, path: skills/demo-skill/RESEARCH.md }
pattern: '## Held-out Inputs(?:(?!\n## )[\s\S])*([Cc]oupon|[Aa]postrophe)'
match: not_contains
---
