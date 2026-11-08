---
type: llm
weight: 1
---

The working-tree diff spreads one upload lifecycle across four pieces of state (`isUploading`, `isError`, `errorMessage`, `url`). The catch branch sets `isError` but never resets `isUploading`, so after a failed upload the component shows "Uploading…" and the error together and the input stays disabled for good. After a first success, picking a second file shows "Uploading…" next to the old "View avatar" link, because nothing clears `url`.
PASS if the review identifies that these flags describe one lifecycle (an implicit state machine) and recommends replacing them with a single status union or reducer (for example idle, uploading, done with url, failed with error), and it names at least one concrete impossible or stuck state the diff makes reachable: uploading and errored at once, the input disabled forever after an error, or the old link shown beside a new upload in progress. It must rate the stuck or contradictory state Critical (or blocking) and must not approve the diff as is.
FAIL if the review approves, rates the stuck state below Critical, misses the stuck or contradictory state, only suggests adding `setIsUploading(false)` in the catch without naming the multi-flag shape as the cause, or never suggests consolidating the state.
