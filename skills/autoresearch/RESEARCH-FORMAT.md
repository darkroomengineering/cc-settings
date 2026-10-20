# RESEARCH.md Format

Users create this file at `skills/<skill-name>/RESEARCH.md` to configure the optimization — or `/harvest` seeds it automatically when it lands a new skill (its Phase 6). A harvest seed already respects the **blind-run rule**: it carries only the raw trap prompts and the binary criteria, never the expected answers or scoring rationale. Keep it that way when you edit — leaking either turns the eval into teaching-to-the-test. Validate any change with `bun run lint:research skills/<skill-name>/RESEARCH.md`.

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

## Held-out Inputs
Scored every round, never read by the loop. Cover use cases the test inputs do not.

### Held-out 1: <label>
<A prompt the loop will never see>

### Held-out 2: <label>
<Another>

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
- stall_rounds: 3
- model: claude-sonnet-5-5
```

## Guidelines for good checklists

3-7 items is the sweet spot. More than 7 and the skill starts gaming the checklist.

Good criteria are:
- **Observable**: Can be verified from the output alone (not "did it think carefully")
- **Binary**: Unambiguous yes/no (not "is the code clean")
- **Independent**: Each tests a different aspect (not 3 variants of "is it concise")
- **Actionable**: A failing score points to a specific thing to fix in the prompt

Bad criteria: "Is the output high quality" (vague), "Would a senior engineer approve" (subjective), "Is it fast" (not measurable from text output).

