---
name: autoresearch
description: Autonomous skill prompt optimization — Karpathy-style mutate/score/keep loop on SKILL.md. Triggers "autoresearch", "optimize skill", "tune", "iterate on", "evolve" a skill, "prompt optimization".
context: fork
argument-hint: "<skill-name>"
---

# AutoResearch

Autonomous skill optimization. You modify a skill's prompt, test it, keep improvements, revert failures. Repeat forever.

Adapted from [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). Same method: single editable file, single metric, git-based keep/revert, autonomous loop. The only difference: `SKILL.md` replaces `train.py`, checklist pass rate replaces `val_bpb`.

**NEVER STOP.** Once the loop begins, do NOT pause to ask the human if you should continue. The human might be away and expects you to work indefinitely until manually interrupted. If you run out of ideas, think harder — re-read failing outputs, try combining near-misses, try more radical prompt rewrites. The loop runs until the human interrupts you, period.

---

## Setup

Work with the user to configure, then go autonomous.

1. **Parse target skill**: Get `<skill-name>` from `$ARGUMENTS`. Validate `skills/<skill-name>/SKILL.md` exists.

2. **Load or create RESEARCH.md**: Check for `skills/<skill-name>/RESEARCH.md`. If it exists, read it. If not, generate one:
   - Read the target SKILL.md
   - Derive 3 test inputs from its description and use cases
   - Derive 5-7 checklist items from its workflow steps and output format
   - Write the generated RESEARCH.md and show it to the user for confirmation

3. **Parse config from RESEARCH.md**:
   - `## Test Inputs` — each `### Test N:` heading is one test case (the text below is the prompt)
   - `## Checklist` — each `- [ ]` line is a binary criterion
   - `## Settings` — optional: `samples` (default 3), `min_improvement` (default 0.05), `max_rounds` (default 50)

4. **Create results directory**:
   ```bash
   mkdir -p ~/.claude/tmp/autoresearch/<skill-name>
   ```

5. **Initialize results.tsv**:
   ```bash
   echo -e "round\tcommit\tscore\tsamples\tstatus\tdescription" > ~/.claude/tmp/autoresearch/<skill-name>/results.tsv
   ```

6. **Create branch**: `git checkout -b autoresearch/<skill-name>` from current HEAD. If the branch already exists, check it out and resume (read existing results.tsv for history).

7. **Read the SKILL.md** as the baseline prompt. Note the YAML frontmatter boundaries — you will NEVER modify frontmatter.

8. **Confirm and go**: Show the user the config summary (target, test count, checklist count, samples per round). Get confirmation. Then go autonomous.

---

## Baseline

Before any mutations, measure the starting score.

1. Run N samples (N = `samples` from settings):
   - For each sample, pick a test input (cycle through test inputs round-robin)
   - Simulate the skill: spawn `Agent(implementer, "<SKILL.md body content>\n\nTask: <test input>")` — use `explore` agent instead if the skill is read-only (description says "explore", "find", "understand")
   - Capture the agent's output

2. Score each output using the **Scoring Protocol** (below).

3. Compute mean score across all samples.

4. Log to results.tsv:
   ```
   0	baseline	{score}	{N}	baseline	initial measurement
   ```

5. Print: `Baseline score: {score} ({X}/{Y} checklist items passing on average)`

6. Set `best_score = score`. Begin the loop.

---

## The Loop

```
LOOP FOREVER (round = 1, 2, 3, ...):

  1. ANALYZE
     - Read the current SKILL.md body
     - Review the per-item pass rates from the most recent scoring
     - Identify the lowest-scoring checklist items (these are the targets)
     - Review recent results.tsv entries for patterns (repeated failures on same items)

  2. HYPOTHESIZE
     - Propose ONE targeted change to improve the lowest-scoring item(s)
     - Write a one-line description of the hypothesis
     - Mutation types (pick one per round):
       a. ADD instruction — missing guidance for a failing criterion
       b. STRENGTHEN — weak "consider" → explicit "MUST" / "ALWAYS"
       c. ADD example — concrete example showing desired behavior
       d. ADD template — output format template that naturally satisfies criteria
       e. RESTRUCTURE — move critical instructions earlier / more prominent
       f. REMOVE noise — cut instructions that don't help any checklist item
       g. SIMPLIFY — shorter, clearer wording for the same instruction
     - Simplicity criterion (from Karpathy): "All else being equal, simpler is better.
       A small improvement that adds ugly complexity is not worth it."

  3. MUTATE
     - Edit the SKILL.md body with the proposed change
     - NEVER modify YAML frontmatter (the --- delimited block at top)
     - Verify the file still has valid frontmatter after the edit

  4. COMMIT
     git add skills/<name>/SKILL.md
     git commit -m "autoresearch: <one-line description>"

  5. EVALUATE
     - Run N samples (same process as baseline)
     - Score each output
     - Compute mean_score

  6. DECIDE
     - If mean_score >= best_score + min_improvement:
         KEEP — set best_score = mean_score
         Log: round, commit, score, N, "kept", description
     - Else:
         REVERT — git reset --hard HEAD~1
         Log: round, commit_before_reset, score, N, "reverted", description

  7. UPDATE DASHBOARD
     - Write dashboard.md (see Dashboard section)

  8. CONTINUE — increment round, go to step 1
```

### Crash Recovery

If a sample agent crashes or produces no output:
- Score that sample as 0.0
- If all N samples crash, the mutation broke something — REVERT immediately
- Log status as "crash" in the TSV

### Convergence

If the score reaches 0.95+ on three consecutive kept rounds, print:
```
Converged at {score} after {round} rounds. Still running — interrupt to stop.
```
Keep going (there may still be room for improvement or simplification).

---

## Scoring Protocol

For each sample output, score against the checklist using strict binary evaluation.

### Scoring prompt

```
You are a strict, consistent evaluator. Score this output against each criterion.

IMPORTANT: Each criterion is binary. YES means the output clearly satisfies it.
NO means it does not, or you're unsure. Do not give partial credit.

## Checklist
{paste each checklist item, numbered}

## Test Input Given
{the test prompt that was used}

## Skill Output to Evaluate
{the captured output from the sample agent}

## Evaluation
For each numbered criterion, respond with ONLY:
N. YES or NO

Then on the final line: SCORE: X/Y
```

### Scoring rules
- Binary only: YES (1) or NO (0), no partial credit
- Score = YES_count / total_checklist_items
- The scorer MUST see both the test input and the output
- Be strict: "unsure" counts as NO
- Parse the SCORE line to extract the numeric result

### Per-item tracking

Maintain a running tally of pass rates per checklist item across the last 3 rounds. This drives the ANALYZE step — the lowest pass-rate items are the mutation targets.

---

## Dashboard

After each round, write `~/.claude/tmp/autoresearch/<skill-name>/dashboard.md`:

```markdown
# AutoResearch: <skill-name>
Updated: <YYYY-MM-DD HH:MM>

## Status
- Current best: {best_score} (baseline was {baseline_score})
- Rounds completed: {round}
- Kept / Reverted / Crashed: {k} / {r} / {c}

## Per-Checklist-Item Pass Rates (last 3 rounds)
| # | Criterion | Pass Rate | Trend |
|---|-----------|-----------|-------|
| 1 | {item text} | {rate}% | {up/down/flat} |
| 2 | ... | ... | ... |

## Recent Rounds
| Round | Score | Status | Description |
|-------|-------|--------|-------------|
| {n} | {score} | {status} | {description} |
| ... | | | |

## Next Target
Lowest-scoring: #{item_number} "{item_text}" at {rate}%
```

---

## RESEARCH.md Format

Users create this file at `skills/<skill-name>/RESEARCH.md` to configure the optimization.

```markdown
# AutoResearch Config: <skill-name>

## Test Inputs
Prompts to test the skill against. Each ### heading is one test case.

### Test 1: <label>
<The full prompt/task that would be given to this skill>

### Test 2: <label>
<Another test prompt>

### Test 3: <label>
<Another test prompt>

## Checklist
Binary pass/fail criteria. Each item is scored YES (1) or NO (0).

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <criterion 3>
- [ ] <criterion 4>
- [ ] <criterion 5>

## Settings
- samples: 3
- min_improvement: 0.05
- max_rounds: 50
```

### Guidelines for good checklists

3-7 items is the sweet spot. More than 7 and the skill starts gaming the checklist.

Good criteria are:
- **Observable**: Can be verified from the output alone (not "did it think carefully")
- **Binary**: Unambiguous yes/no (not "is the code clean")
- **Independent**: Each tests a different aspect (not 3 variants of "is it concise")
- **Actionable**: A failing score points to a specific thing to fix in the prompt

Bad criteria: "Is the output high quality" (vague), "Would a senior engineer approve" (subjective), "Is it fast" (not measurable from text output).

---

## Resuming

If `autoresearch/<skill-name>` branch already exists:

1. Check it out
2. Read `~/.claude/tmp/autoresearch/<skill-name>/results.tsv`
3. Find the last "kept" row — that's the current best_score
4. Find the total round count
5. Print: `Resuming from round {N}, best score: {score}`
6. Continue the loop from round N+1

If the results.tsv doesn't exist (branch exists but no tracking), measure a new baseline from the current branch state and start fresh tracking.

---

## Applying Results

When the user is satisfied (or after convergence), they merge the optimized skill:

```bash
git checkout main
git merge autoresearch/<skill-name>
```

The original skill on `main` was never modified during optimization. The branch contains the full history of every mutation that was kept.
