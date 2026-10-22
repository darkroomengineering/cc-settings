---
type: llm
weight: 1
---

PASS if the final response identifies this as a Next.js/satus project (referencing the `next` dependency or satus conventions), and then either (a) builds the feature following satus conventions — `components/` for the form, `@/` alias or CSS module where relevant, `app/<path>/page.tsx`-style routing rather than novus's `app/routes/` — or (b) stops and asks a clarifying question before building, such as flagging that no site scaffolding exists yet and asking how to proceed, rather than silently building nothing and also not asking.

FAIL if the response never identifies the stack as Next.js/satus, or it neither builds a satus-conventional feature nor asks a clarifying question (e.g. it silently does nothing, or builds with the wrong stack's conventions).
