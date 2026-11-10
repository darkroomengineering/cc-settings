---
type: llm
weight: 1
---

PASS if the response plans the visual proof on a virtual display with the `offscreen` tool (launching the app there, driving it through accessibility or process-only keystrokes, and capturing its window), and keeps the user's real cursor, keyboard, and focus untouched.
FAIL if the plan drives the real screen (cliclick, osascript clicks or keystrokes, computer use, or a UI test run without asking whether the machine is free), or skips the screenshot without saying why.
