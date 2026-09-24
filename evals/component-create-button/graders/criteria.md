---
type: llm
weight: 1
focus: last_message
---

PASS if the response says it detected Next.js (e.g. mentions `next` in package.json, or "satus") and describes the created Button component using a CSS module file (e.g. `button.module.css` or `.module.css`) and a named export (`export function Button`, not `export default`).

FAIL if the response never mentions detecting Next.js, or describes the component with no CSS module, or with a default export instead of a named one.
