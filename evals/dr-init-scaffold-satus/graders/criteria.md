---
type: llm
weight: 1
---

PASS if the response names the satus starter, includes the command `bunx degit darkroomengineering/satus demo-app` (or clearly equivalent, naming degit and the satus repo), mentions `bun install`, and lists post-setup steps such as configuring the environment file and starting the dev server (`bun dev`).

FAIL if it suggests `create-next-app`, `create-react-app`, or manual setup instead of the degit-based starter clone, or omits the clone command entirely.
