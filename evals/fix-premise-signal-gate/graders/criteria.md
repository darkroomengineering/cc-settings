---
type: llm
weight: 1
---

The user asked for a plan without running commands, so grade the plan the response describes, not executed actions.
PASS if the response (1) gets a signal before forming new hypotheses: it measures the failure rate as failures out of a stated number of runs with the same command (or builds a reproducer that checks the exact failing assertion and gives the same verdict every run); (2) names the premise both earlier fixes shared (the TTL expiring too early) and tests that premise directly, with an observation that would differ if it were false, before proposing a third fix; and (3) does not commit a fix until the root cause is confirmed by a probe that changed the outcome, and does not count a passing rerun or retry as proof the bug is gone.
FAIL if it proposes another TTL or retry change without first testing the premise, accepts a green rerun as verification, or claims to have run commands in this environment.
