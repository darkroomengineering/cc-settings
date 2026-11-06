---
type: llm
weight: 1
---

The working-tree diff spreads one upload lifecycle across four pieces of state (`isUploading`, `isError`, `errorMessage`, `url`). The catch branch sets `isError` but never resets `isUploading`, so after a failed upload the component shows "Uploading…" and the error together and the input stays disabled for good. A retry that succeeds also leaves the old error on screen next to the new link, because nothing clears `isError`.
PASS if the review identifies that these flags describe one lifecycle (an implicit state machine) and recommends replacing them with a single status union or reducer (for example idle, uploading, done with url, failed with error), and it names at least one concrete impossible or stuck state the diff makes reachable: uploading and errored at once, the input disabled forever after an error, or a stale error shown beside a success.
FAIL if the review approves without flagging the stuck or contradictory state, only suggests adding `setIsUploading(false)` in the catch without naming the multi-flag shape as the cause, or never suggests consolidating the state.
