# Closing comment

Post this on the ticket when its work is ready for review. `/build` drafts it from the ticket's acceptance criteria; the main session posts it (Linear through the `linear` agent's `review-ready` event, GitHub with `gh issue comment <n> --body-file <file>`).

```markdown
**US-<n>: preview ready for review**

**Preview:** <URL that opens the right page>

**What's implemented**
- <each acceptance criterion, in plain words, with where the merchant setting lives>

**How it was validated**
- <live render at desktop and mobile, devices, validators, query output>

**Notes**
- Open question resolved: <answer and source>
- Verified by logic, not live: <what still needs a live check before launch>
- Needs a human run: <for example, a real form submit that emails the store>
```

## Rules

- "Verified by logic, not live" is required whenever any criterion was checked by reading code or reasoning instead of seeing it work. A reviewer must be able to tell what was seen working from what was reasoned about. Omit the line only when every criterion was seen.
- Every acceptance criterion appears under What's implemented or under Verified by logic, not live. A criterion that is in neither was not done.
- No preview yet: say so on the Preview line and why. Do not drop the line.
- The ticket moves to done only from a seen check. A comment with open "verified by logic" items keeps the ticket in review.
