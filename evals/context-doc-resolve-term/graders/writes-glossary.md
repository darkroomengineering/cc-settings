---
type: regex
target: { source: file, path: CONTEXT.md }
pattern: '\*\*Order\*\*[\s\S]*\*\*Shipment\*\*|\*\*Shipment\*\*[\s\S]*\*\*Order\*\*'
match: contains
---
