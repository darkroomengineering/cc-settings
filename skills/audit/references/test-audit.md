# Test audit checklist

Reference for `/audit tests` and for the `tester` agent's authoring gate. The
ideas come from openclaw's `test-audit` skill, rewritten for Darkroom repos.

## Junk patterns (T1–T15)

Each pattern marks a test that costs maintenance without guarding behavior.
Cite the ID in findings. A match is a candidate, not a verdict: the retention
bar below can still keep the test.

| ID | Pattern | The tell |
|---|---|---|
| T1 | No assertion | The test runs code and checks nothing, or only that it did not throw when throwing was never plausible. Weak-only checks count: `toBeDefined`, `toBeTruthy`, `toBeInstanceOf`, `toBeGreaterThan(0)`, or a bare `toHaveBeenCalled` with no assertion on the payload or the resulting state. |
| T2 | Self-comparison | The expected value is the input, a copy of it, or the same object passed through an identity function. |
| T3 | Copied inventory | The test hard-codes a list (exports, files, manifest keys, rule names) that must be edited in lockstep with the source it mirrors. A single restated value counts too: `expect(LIMITS.maxTools).toBe(8)` or `expect(PROMPT).toContain("You are")` blocks the edit and tests nothing; test the code that reads the value instead. |
| T4 | Source grep | The test reads source text and asserts a string, import, or identifier is present, so a rename breaks it while a behavior regression passes. |
| T5 | Private call shape | The test asserts which internal helper was called with which arguments, when a public-boundary test already covers the outcome. |
| T6 | Duplicate contract | Two or more tests exercise the same input class through the same path and fail for the same regression. |
| T7 | Replayed shared helper | Each consumer re-tests a shared helper's behavior instead of the one test the helper owns. |
| T8 | Seam keeper | The test exists only to exercise an export, flag, global, or wrapper that no production caller uses. |
| T9 | Test-only production code | Production code whose only callers are tests. Delete both. |
| T10 | Self-computed expectation | The expected value is produced by the function under test or by the same renderer, so the assertion cannot disagree with the code. |
| T11 | Mock implements the answer | The mock returns the asserted result, or one generic mock stands in for several different APIs. |
| T12 | Fixture does the owner's job | The fixture supplies the ordering, receipt, or persisted record that the code under test is supposed to produce, or the assertion reads only data the test or `beforeEach` built and the subject never runs in the test body. |
| T13 | Restated flag | The test checks that a capability flag is set instead of exercising the behavior the flag promises. |
| T14 | Wrong-reason negative | A "rejects X" test passes because a different guard rejects the input first, or through a path production never reaches. |
| T15 | Overclaiming name | The name or fixture promises more than the input exercises, such as a "handles concurrent writes" test with one writer. |

A test that breaks under a behavior-preserving refactor is suspect under T4,
T5, or T11. It is not automatically deletable; check the retention bar.

## Authoring gate (four questions)

Before adding or changing a test, answer all four. A missing answer means the
test is not ready.

1. What observable behavior or contract does it protect?
2. Which credible regression makes it fail?
3. Why does existing coverage not already fail for that regression? Each
   contract has one owning test at the strongest boundary. Extend a
   table-driven case or shared fixture before adding a near-duplicate.
4. Does it need a production seam (an export, flag, or hook) that no production
   caller needs? If so, test at the real boundary instead.

Then check it against T1–T15. The quick screen for T1, T2, T3, T10, T11, and
T12: would the test still pass if every function it imports returned
`undefined`? If yes, it observes no behavior. Call the subject in the test body
with one concrete input and assert the literal output or the observable effect;
for an absence, assert the presence on another input in the same test. A bug regression test must fail on the pre-fix
code for the intended reason; one that never failed proves the mock, not the
fix. Write it once, at the owning boundary, not at every layer the bug crosses.

## Retention bar

Keep a test that independently guards any of these, even when it looks like a
junk pattern:

- a public API, protocol, config or settings shape, migration, storage format,
  security boundary, platform behavior, default value, or release artifact;
- call order, when the order is observable behavior;
- a regression with a credible failure mode;
- an invariant where source inspection is the cheapest independent guard: it
  fails when the user-facing key, byte, or path changes, and survives an
  identifier-only rename.

Static or slow is never a reason to delete. A retained test that fails on the
current baseline is a possible product bug: reproduce it and fix the code.

## Evidence record

Record every field before recommending a deletion. A missing field keeps the
finding at PLAUSIBLE and blocks deletion.

- test name and `file:line`;
- the failure it can actually detect (or "none");
- non-test callers of the code or seam it covers;
- the stronger test that still covers the behavior, with its assertion quoted (a line number alone is not evidence), or why none is needed;
- why the test exists (`git log -L` or `git blame` on the test);
- production or test-support code the deletion frees;
- risk, plus the focused command that proves nothing regressed.
