---
name: verify
description: |
  Use when:
  - User says "verify", "double check", "are you sure", "prove it"
  - User asks to "stress test", "find holes", "poke holes"
  - User mentions "adversarial review", "devil's advocate"
  - User says "audit", "validate thoroughly", "high confidence"
  - After a critical fix (auth, payments, data integrity)
  - Before deploying to production
  - User says "triple check", "verify this is correct"
  - Migrating data, schemas, or APIs
context: fork
---

# Adversarial Verification

Three agents with competing incentives: one finds issues, one disproves them, one judges.

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "verify" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

## When to Use

- Security-sensitive code (auth, crypto, permissions)
- Data integrity (migrations, schema changes, ETL)
- Financial logic (payments, billing, calculations)
- Breaking changes (API contracts, public interfaces)

## The Three-Agent Pattern

### Agent 1: Finder

```
Agent(reviewer, "You are a bug finder. Analyze the following code/changes thoroughly.
Score yourself: +1 for low-impact issues, +5 for medium-impact, +10 for critical.
Report every potential issue you find — edge cases, race conditions, missing validation,
security holes, logic errors, performance problems.
Report your total score at the end.

Target: [describe what to verify]
Files: [list files]")
```

Finder over-reports by design — this is the **superset** of all possible issues.

### Agent 2: Adversary

Takes the finder's output and tries to disprove each issue.

```
Agent(reviewer, "You are an adversarial reviewer. For each issue below, try to DISPROVE it.
Score yourself: +points of the bug for each you successfully disprove,
but -2x the points if you wrongly disprove a real issue.

Issues to challenge:
[paste finder output]

For each issue, state:
- DISPROVED: [reason it's not actually an issue]
- CONFIRMED: [reason it is a real issue]
- UNCERTAIN: [what would need to be checked]")
```

Adversary filters aggressively but cautiously — this is the **subset** of likely-real issues.

### Agent 3: Referee

Takes both inputs and produces the final verdict.

```
Agent(oracle, "You are a neutral referee scoring two reviewers.
You will get +1 for each correct judgment and -1 for each incorrect one.
The ground truth exists and will be checked against your answers.

For each issue, produce a final verdict:

REAL BUG — with severity (Critical/Warning/Minor)
FALSE POSITIVE — explain why
NEEDS HUMAN CHECK — genuinely ambiguous

Finder report:
[paste finder output]

Adversary report:
[paste adversary output]")
```

## Workflow

1. **Identify scope** — what code/changes need verification
2. **Run Finder** — collect all potential issues
3. **Run Adversary** — challenge finder's output
4. **Run Referee** — judge both outputs
5. **Report** — present final verdicts

Sequential — each agent depends on the previous output.

## Output Format

```markdown
## Adversarial Verification Report

### Scope
[What was verified]

### Verdict: [PASS / FAIL / NEEDS REVIEW]

### Confirmed Issues
| # | Severity | Issue | File:Line | Action Required |
|---|----------|-------|-----------|----------------|
| 1 | Critical | [description] | [location] | [what to fix] |

### Disproved (False Positives)
| # | Claimed Issue | Why Not Real |
|---|---------------|--------------|
| 1 | [description] | [reason] |

### Needs Human Check
| # | Issue | Why Ambiguous |
|---|-------|---------------|
| 1 | [description] | [what to check] |

### Confidence
Finder: N issues. Adversary disproved: M. Referee confirmed: K.
```

## Lightweight Mode

For smaller changes, skip the referee:

```
Agent(reviewer, "Find all issues in [target]. Be thorough.")
Agent(reviewer, "Challenge each issue: [paste output]. Disprove what you can.")
```

Review surviving issues yourself.

## Rationalization Counters

If you catch yourself thinking any of the following, STOP — you are rationalizing skipping verification:

| Rationalization | Why It's Wrong |
|---|---|
| "The change is too simple to need three agents" | Simple changes to auth/payments have caused the worst production incidents |
| "I already reviewed it myself" | Self-review has a known blind spot for logic errors you just wrote |
| "It's just a refactor, behavior doesn't change" | Refactors that "don't change behavior" are the #1 source of subtle regressions |
| "Tests are passing, that's enough" | Tests verify expected behavior; adversarial review finds unexpected behavior |
| "This would take too long" | A 5-minute verification is cheaper than a production incident |
| "The reviewer agent already checked it" | The reviewer checks quality; verification checks correctness under adversarial pressure |

## Red-Flag Phrases

If any agent (including yourself) uses these phrases, verification is NOT complete — restart the verification step:

- "should work" / "should be fine"
- "probably" / "likely" / "most likely"
- "I believe" / "I think" (without evidence)
- "Done!" / "All good!" / "Looks great!"
- "I don't see any issues"
- "This is straightforward"

Each of these must be replaced with evidence: a specific test, a concrete trace through the code, or a cited invariant.

## Remember

- For critical code, inspect referee output yourself
- Store verified patterns as learnings
