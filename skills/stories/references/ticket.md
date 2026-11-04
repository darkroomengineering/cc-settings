# Ticket template

Title: `US-<n>: <what the visitor or merchant gets> (<where>)`, for example `US-2: Waitlist sign-up form (product page)`. Never an implementation name like `` `<campaign-timer>` custom element``.

Every section below is present on every ticket. Write "None" in a section that has nothing, so a reader can tell it was considered.

```markdown
## User story
**As a** <named role: first-time visitor, returning customer, the store owner>,
**I want to** <capability>,
**so that** <outcome the client cares about>.

## Acceptance criteria
- [ ] <observable behavior someone can check without reading code>
- [ ] <mobile behavior>
- [ ] <every state: empty, sold out, ended, error>
- [ ] <every text, toggle or choice the merchant edits in the admin or editor>
- [ ] <explicit negatives: "No carousel", "No tracking">

## Client input
> <verbatim quote that explains the intent, with source and date>

or: Paraphrase (not a quote): <faithful paraphrase>, <source>, <date>

## Implementation notes
- Approach, from the implementation review.
- Prior art: <existing files to read and extend first>.
- Shared pieces: <built here and reused by US-x>, or <reuses the piece from US-y>.
- Data: <exact names from the data contract in the kickoff>.
- Platform limits that shaped the approach, with the doc link.

## Design references
- **<Frame or block name>** (<where on the frame, the text on it>): [desktop](<link>) · [mobile](<link>)

## Verify
<only the commands specific to this ticket, each with its expected output; the standard commands live in the kickoff>

## QA (1:1 with the design)
- [ ] <each state to screenshot at desktop and mobile, next to its frame>

## Open questions
- <question> · answers: <person> · default until answered: <default> (or a decision ID from the kickoff)

## Out of scope
- <nearby work this ticket must not do>

## Source
<stories doc path> (US-<n>) · contract line: "<quote>"
```

## Checks before creating

- Four to ten criteria, each checkable in one look or one action, none naming a file, event or API.
- At least one explicit negative.
- A front-end ticket has a desktop and a mobile reference, each described in words.
- Verify holds nothing the kickoff already says.
- A parent ticket has its own criteria; sub-issues exist only for split ownership or a shared piece.
