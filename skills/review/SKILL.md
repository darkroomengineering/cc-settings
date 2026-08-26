---
name: review
description: Review the local unstaged/staged diff with Darkroom's checklist, or summarize active-PR feedback. Triggers "review my changes", "check this diff", "PR comments", "summarize PR feedback". Native /code-review handles a diff or PR.
context: fork
agent: reviewer
---

# Code Review

Reviews against the full Darkroom quality checklist defined in the reviewer agent.

Focus areas: TypeScript strictness, React patterns, accessibility, performance, security, file structure.

## Standalone Codex host setup

Claude frontmatter does not enforce a fork or reviewer identity in standalone
Codex. Keep the main pass read-only or create a fresh `reviewer` with
`spawn_agent`. Deliver context to a running reviewer with `send_message`, trigger
another turn for an idle existing reviewer with `followup_task`, wait with
`wait_agent`, and stop its current turn with `interrupt_agent` only when
necessary. Never spawn `codex-verifier` and never run `codex-run.ts` from inside Codex.

Writers share the working tree unless the live host explicitly offers
isolation. Reviewers may overlap because they are read-only; serialize any
later implementer and test-writer work with non-overlapping ownership. Gather
the current state by explicitly running `git branch --show-current`, `git diff
--staged --stat`, and `git diff --stat`. The `!command` lines below are Claude
interpolation only.

## Claude current state
- Branch: !`git branch --show-current 2>/dev/null || echo "unknown"`
- Staged files: !`git diff --staged --stat 2>/dev/null || echo "nothing staged"`
- Unstaged files: !`git diff --stat 2>/dev/null || echo "nothing unstaged"`

## Get Changes

```bash
# Unstaged changes
git diff

# Staged changes
git diff --staged

# Specific file
git diff path/to/file
```

## Large diffs: walk a reading diff, not a summary

Past ~200 changed lines, present the diff walkthrough as a **reading diff** — the real diff, abridged — never a prose-only summary (prose can lie by omission; a diff can't). Every line shown is verbatim from `git diff`; the only editing allowed is removal and compression: drop whole no-signal lines, fold 2+ contiguous same-polarity lines into a `...` row, or elide a noisy span inside a kept line. Never rewrite one. Drop import churn, lockfiles, generated files, and formatting-only hunks; show one instance of a mechanical rename and fold the rest with a count; keep every behavioral change. Close with an accounting line — `showing N of M changed lines — dropped: ...` — naming any new dependency, changed import target, or lockfile version/integrity bump even though import churn is dropped. The full diff remains the merge authority. Full protocol: the "Reading diffs" section of `/review-batch` (adapted from boldsoftware/meat, Apache-2.0).

## Standalone Codex review

Follow the native lifecycle above, then adjudicate the fresh reviewer's findings
against the diff. The fresh agent supplies the independent review; skip the
Claude bridge branch below.

## Cross-model review (when the Codex bridge is available)

This skill runs as the Claude `reviewer` agent — often Claude reviewing a diff Claude just wrote, the self-preferential-bias case. Run an independent review from a different model family in parallel and reconcile (the reviewer has `Bash`, so call the bridge directly):

```bash
bun "$HOME/.claude/src/scripts/codex-run.ts" review
```

Codex reads the same diff and returns HIGH / MEDIUM / LOW findings. **Adjudicate every finding before it drives a fix** — Codex produces false positives and stale findings, so its output is a set of claims, not a verdict. Tag each one:

- **confirmed** — you reproduced or traced it in the diff. Only confirmed findings drive a fix or land as Critical.
- **rejected** — a false positive or stale claim; note the one-line reason you rejected it.
- **unverified** — you couldn't check it cheaply; surface it as a Suggestion for a human, don't act on it.

Then fold the confirmed findings into the verdict below — map HIGH→Critical, MEDIUM→Warning, LOW→Suggestion. Agreement with your own review raises confidence. The bridge is gated and fails open: if Codex is unavailable, proceed with the Claude review alone.

## Output Format

```
## Summary
[1-2 plain-English sentences: what this change does, then your overall read]

## Critical Issues
- [Must fix before merge]

## Warnings
- [Should fix, but not blocking]

## Suggestions
- [Nice to have improvements]

## Verdict
[APPROVED / NEEDS CHANGES / BLOCKED]
```

## Remember

- Be constructive, not just critical
- Explain WHY something is an issue
- Comments in plain English — explain the issue and its impact like you're talking to a teammate, not citing a rulebook. No jargon dump.
- Suggest specific fixes
- If you find a pattern worth remembering, save it via auto-memory (personal) or `/share-learning` (team-wide).
- **Escalate to `/verify`** when the diff touches auth, payments, crypto, input validation, or a breaking public API — this skill is the fast checklist pass; `/verify` runs three adversarial agents (issue-finder, disprover, judge) and is the gate for security-sensitive or financial code.

---

## Animation & Motion Checklist

Fires whenever the diff touches CSS transitions/animations or any motion-library
code — new or edited GSAP/Motion/Framer Motion/Lenis calls, animation props,
spring configs, or WAAPI usage, not just added imports. Adapted from emilkowalski/skills
`review-animations` (MIT). Default to flagging — approval is earned, not assumed.

**Ten standards — each violation is a finding:**

1. **Justified motion** — every animation answers "why does this animate?" (spatial
   consistency / state indication / feedback / explanation / preventing a jarring
   change). "It looks cool" on a frequently-seen element is a block.
2. **Frequency-appropriate** — keyboard-initiated and 100+/day actions get zero
   animation; tens/day gets reduced motion; occasional gets standard; rare/first-time
   can have delight.
3. **Responsive easing** — `ease-out` or a strong custom curve on entering/exiting
   elements (see `rules/ui-skills.md`). `ease-in` on UI is a block.
4. **Sub-300ms UI** — press 100–160ms, tooltips/popovers 125–200ms, dropdowns/selects
   150–250ms, modals/drawers 200–500ms.
5. **Origin & physical correctness** — popovers/dropdowns/tooltips scale from
   `transform-origin` at the trigger, not center (modals exempt). Never `scale(0)` —
   start `scale(0.9–0.97)` + opacity.
6. **Interruptibility** — rapidly-triggered or gesture-driven motion uses CSS
   transitions or a retargeting spring, never keyframes that restart from zero.
7. **GPU-only properties** — `transform`/`opacity` (`clip-path` is the sanctioned
   third) only. Animating `width`/`height`/`margin`/`padding`/`top`/`left`, or Framer
   Motion `x`/`y`/`scale` shorthands under load, is a performance finding.
8. **Accessibility** — `prefers-reduced-motion` honored (gentler, not zero); hover
   motion gated behind `@media (hover: hover) and (pointer: fine)`.
9. **Asymmetric enter/exit** — deliberate actions (press, hold, destructive confirm)
   animate slower; system responses snap back fast.
10. **Cohesion** — motion matches the component's and product's personality.

**Escalation triggers (flag on sight):** `transition: all`; `scale(0)` or pure-fade
entrances (reduced-motion fallbacks exempt — a crossfade is the correct fallback
there); `ease-in` on any UI interaction; animation on a keyboard shortcut or
100+/day action; UI duration > 300ms with no stated reason (modals/drawers exempt
up to 500ms); `transform-origin: center`
on a trigger-anchored popover; keyframes on toasts/toggles/anything rapidly
triggered; animating layout properties; missing `prefers-reduced-motion`; ungated
`:hover` motion; symmetric enter/exit timing on a press-and-hold interaction.

**Remedial order** (prefer earlier moves over later ones): delete the animation →
reduce it → fix the easing → fix the origin/physicality → make it interruptible →
move it to the GPU → asymmetric timing → polish (stagger, blur-masked crossfades) →
accessibility & cohesion.

Fold findings into the Critical/Warnings/Suggestions verdict above — a block-tier
finding here is Critical.

---

## Variant: Summarize Inbound PR Comments

When the user asks "what did reviewers say" or wants a digest of feedback on the active PR (not a self-review of local diff):

1. Resolve the active PR for the current branch.
2. Fetch review comments (file/line-anchored) and discussion comments (issue-level).
3. Group by severity — blocking, suggestion, nit, open question.
4. Return an action list ordered by priority.

### Commands

```bash
# Resolve the active PR
gh pr view --json number,url,headRefName,reviews,comments

# Inline review comments (file/line anchored)
gh api repos/{owner}/{repo}/pulls/PR_NUMBER/comments \
  --jq '.[] | {user: .user.login, body, path, line}'

# Discussion comments (issue-level, not file-anchored)
gh api repos/{owner}/{repo}/issues/PR_NUMBER/comments \
  --jq '.[] | {user: .user.login, body, created_at}'

# Review states (APPROVED / CHANGES_REQUESTED / COMMENTED)
gh pr view --json reviews --jq '.reviews[] | {user: .author.login, state, body}'
```

### Output Format

```
## Summary
[1-2 sentence overview of feedback]

## Blocking (must address)
- [reviewer]: [path:line] — [issue + suggested fix]

## Suggestions (should address)
- [reviewer]: [path:line] — [issue]

## Nits (optional)
- [reviewer]: [path:line] — [issue]

## Open questions
- [unresolved threads needing a reply]
```

### Guardrails

- Quote actual reviewer text. Do not paraphrase in ways that change meaning.
- Group by severity, not by reviewer.
- If a reviewer didn't mark severity explicitly, infer from language ("must", "should", "consider", "nit:").

### Follow-through: fix what's Blocking

Summarizing isn't the whole job when the user wants the PR actually updated. After the digest above, close the loop on the Blocking items — scoped to this PR:

1. Triage each Blocking/Suggestion thread: does it need a code change, or just a reply?
2. **Stop. Present the plan** — thread → file → intended change — **and wait for approval** before editing or pushing anything. (CI fixes on an already-approved PR are pre-approved by the Autonomy Contract and skip this gate; everything else waits.)
3. Fix the approved threads in the working tree, scoped to the files each thread points at, then push.
4. Reply on each addressed review thread naming the fixing commit: `gh api repos/{owner}/{repo}/pulls/PR_NUMBER/comments/COMMENT_ID/replies -f body='...'` — a thread reply. `gh pr comment` posts an issue-level comment that never attaches to the thread. Thread *resolution* is the reviewer's click (or a GraphQL `resolveReviewThread` mutation) — report threads as addressed, don't claim them resolved.
5. Re-run the digest with each Blocking item annotated `addressed in <sha>`. Review comments don't disappear when fixed, so the digest tracks addressed-vs-open — never promise a count dropping to zero.

Stop and report instead of pushing when a comment is ambiguous, requests a design change rather than a fix, or falls outside the diff already under review — those go back to the user, not into an autonomous fix.
