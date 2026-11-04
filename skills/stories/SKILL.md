---
name: stories
description: Turn a client build's scope into approved user stories, then tickets, kickoff, QA checklist and closing comments in one shared format. Triggers "user stories", "write the tickets", "break this scope into tickets".
context: main
---

# Stories: from scope to tickets for client builds

One pipeline so every person and agent writes, works and closes client tickets the same way. It works for Linear and GitHub Issues; the content is identical, only the call that creates the ticket differs.

## Where the files live

Each step writes one file in the project's planning folder. Use the folder the team already keeps for this client (ask once if none is obvious); otherwise `.context/stories/<client>/` in the build repo. Name it once in the stories doc and reuse it.

## The pipeline

Run the steps in order. Skipping a step is what makes tickets thin, not the template.

| # | File | Audience | Holds |
|---|---|---|---|
| 1 | `scope-tickets.md` | Internal, then client | One entry per contract line: status (confirmed, open, deferred), the client's answers with who and when, open questions, estimate |
| 2 | `user-stories.md` | Client | One story per user-visible module or merchant capability, in the client's language, with acceptance criteria |
| 3 | `implementation-review.md` | Internal | Per story: risk (low, medium, high), platform limits, performance, edge cases, approach, open questions, what to tell the client |
| 4 | Tickets | Developers and agents | The approved story and criteria verbatim, plus the review's notes: `references/ticket.md` |
| 5 | `kickoff.md` | Developers and agents | How to work the tickets in this repo: `references/kickoff.md` |
| 6 | `qa-checklist.md` | Whoever runs launch QA | `references/qa-checklist.md` |
| 7 | Closing comment on each ticket | Reviewer, PM | `references/closing-comment.md` |

### Stop for client approval

After writing `user-stories.md`, stop. Report the file path, the story count, and the open questions, and say that the client approves the doc before any ticket exists. End the turn there. Do not write the implementation review or create a ticket in the same run, even when the user says the client will approve. Steps 3 onward start in a new invocation that names the approval: who approved, when, and any changes.

When the design or the scope changes after approval, revalidate the affected stories and flag each change inline with its date ("Updated 18 May per the revised design: ..."). Never silently rewrite an approved story.

## Writing stories and criteria

- **Granularity.** One story per user-visible module (a section, a page, a component the visitor sees) or per merchant capability ("the store owner edits the goal without code").
- **Criteria are for whoever signs off**, client or QA, not the implementer. Each one is checkable in one look or one action: say the number, the copy, the breakpoint.
- **Cover** mobile, every state (empty, sold out, ended, error), every setting the merchant edits, and explicit negatives ("No carousel", "No tracking").
- **Implementation detail stays out.** File names, events, intervals and APIs go in Implementation notes, where the developer can challenge them.
- **Four to ten criteria.** More means the story is two stories.

## Creating tickets (step 4)

1. Read `references/ticket.md` and fill one ticket per approved story: the story and criteria verbatim, the review's notes in Implementation notes.
2. **The ticket closes on its own criteria.** A parent that only says "done when the sub-issues are done" is not allowed.
3. **Sub-issues** only when different people build the pieces or a piece is shared by two or more tickets. A shared piece is built once, in the ticket that needs it first; that ticket says it is shared, and each consumer names it and reuses it.
4. **Design references** on every front-end ticket: the desktop and the mobile frame, each described in words (frame name, where the block sits, the text on it). Never a bare node ID.
5. **Shared rules live once in the kickoff**: the standard Verify commands, the screenshot QA protocol, branch and push rules, the data contract, the decisions table. A ticket carries only what is specific to it.
6. Write every ticket to `tickets.md` first and show the count. Then create them in the project's tracker:
   - **Linear:** spawn the `linear` agent with event `tickets`, the path to `tickets.md`, and the repo. It creates the stories, their sub-issues and blocked-by relations in the mapped team and project.
   - **GitHub Issues:** `gh issue create --title <title> --body-file <file>` per ticket, one body file each; link sub-issues from the parent body.
7. **The tracker is now the source of truth.** The local docs become dated snapshots. Never re-run a generator over the tracker; change tickets in the tracker.

## Kickoff, QA and closing (steps 5 to 7)

- Write the kickoff after the repo exists, from `references/kickoff.md`; its most valuable section points at real files. Post it where the team keeps project docs and link it from every ticket.
- Write `qa-checklist.md` from `references/qa-checklist.md`.
- The closing comment is posted per ticket when its work is ready for review, from `references/closing-comment.md`. `/build` drafts it at the end of a ticket's build.

## Anti-patterns

`/dr-review` flags these on tickets. Do not write them:

- A story as a container: the parent has no criteria of its own.
- Tickets split by technical layer before the story is agreed with the client.
- Tickets written in one pass from the contract and the design, with no implementation review and no client approval in between.
- Implementation detail written as acceptance criteria.
- The same Verify or QA boilerplate pasted into every ticket.
- Bare design node IDs with no description.
- Status set to done from a reasoned check instead of a seen one.

## Evidence

Mirae (`darkroomengineering/shopify_horizon` #33 to #44) shipped cleanly because of the steps before the tickets: scope answers, a client-approved story doc, an implementation review. The Sweet Death first pass (Nov 2026), 14 stories and 55 sub-issues written in one day from a proposal and wireframes, came out thin in exactly the ways listed above.
