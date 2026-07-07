# Harvest Contract

The record every `/harvest` run fills before an artifact is promoted. It turns a
one-off observation into a *measured* claim: what was witnessed, how often, what
is proven, and whether the evidence clears the bar. Copy the template into your
harvest report and fill every field.

A field you cannot fill with something concrete is **not blank** — it is `null` /
INCONCLUSIVE, and that verdict propagates. Never round a gap up to a plausible
number or a hopeful PASS.

## Template

```
### Harvest contract: {behavior name}

- Trigger / context: {the request or situation that summons this behavior}
- Witness count: {N sessions / transcripts / runs} — {multi-witness | single-witness}
- Observed evidence:
  - Repeated across witnesses: {what was identical every time}
  - Varied across witnesses: {what differed — is it noise or part of the signal?}
  - Evidence inspected: {transcripts / PRs / diffs / outputs you actually read}
  - Not proven: {what you are inferring rather than observing — the honest gaps}
- Procedure: {ordered steps, with concrete commands where they exist}
- Known failure modes: {the specific bad default path this replaces}
- Quality bar: {observable checks that the output is right — not "high quality"}
- Trap prompts: {2–3 realistic requests where a no-artifact agent takes the bad path}
- Required tools / capabilities: {tools, files, and model tier the procedure needs}
- Verification result: {PASS | FAIL | INCONCLUSIVE}
- Promotion decision: {which artifact, at what scope — or "hold / do not promote"}
```

The quality-bar checks double as the artifact's self-tests: they are what a future
user runs to confirm compliance, and what the trap-prompt judge scores against.

## Verdict rubric

| Verdict | When | Consequence |
|---|---|---|
| **PASS** | Multi-witness, OR single-witness with every trap prompt passing; contract fully filled; quality bar observable | Eligible for promotion — including shared standards, after the approval gate |
| **INCONCLUSIVE** | Evidence missing or unread, single-witness with no passing trap, or any required field is `null` | May land only as a personal-scope provisional draft — never a shared standard. State what would resolve it |
| **FAIL** | A trap prompt reproduces the bad path *with* the artifact loaded | Do not promote. Revise the artifact and re-run, or stop and report the miss |

## Promotion scope gate

| Target | Minimum evidence |
|---|---|
| Personal draft skill (unregistered file) | Single-witness + filled contract |
| Registered skill / `MANUAL.md` row | PASS (traps pass) |
| Shared standard — `AGENTS.md`, `rules/`, `profiles/`, team-knowledge | Multi-witness **and** PASS |

Single-witness never reaches a shared standard on its own. One observation is not
proof of determinism — it is a hypothesis awaiting a second witness or a passing
trap.

## Deopt / fallback

- **No evidence** → INCONCLUSIVE. Never synthesize a PASS from a plausible story.
- **A trap fails** → FAIL. Fix the artifact and re-run, or stop.
- **An unknown number** → `null`, never an aspirational guess ("~5 times", "usually").
- **Unknown territory** — a behavior you cannot reconstruct, a judgment you cannot
  verify from evidence on disk — → fall back to `/verify`, `/oracle`, human approval,
  or plain reasoning. The ratchet only tightens on what you can measure; it does not
  manufacture certainty.
