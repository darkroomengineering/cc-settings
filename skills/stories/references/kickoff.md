# Kickoff template

The kickoff is the first thing a developer or agent reads, and the one place shared rules live. Write it after the repo exists, because its most valuable section points at real files. Every ticket links it.

1. **What you're building.** Client, launch date, project or epic link, ticket range, whether scope is locked ("No new features without a change request").
2. **The repo's own rules.** `AGENTS.md` or `CLAUDE.md`, workflow docs, platform configuration docs, the PR review setup.
3. **Prior art per ticket.** Table: ticket, existing files to read first, implication ("A waitlist layout already exists: configure, don't rebuild"). Plus the discovery commands (`rg "<topic>" <source dirs>`).
4. **Conventions.** File prefix for custom files, branches and what auto-deploys, language and styling conventions, translation keys.
5. **Tools.** Design tool access for frames, platform docs and validators, the tracker CLI or MCP, a browser tool for visual QA.
6. **Standard Verify.** The commands every ticket runs, each with its expected output. Tickets list only their own extra commands.
7. **Screenshot QA protocol.** Breakpoints, devices, where screenshots are posted, and how they are compared 1:1 with the frames.
8. **Branch and push rules.** Branch naming with the ticket ID, where pushes go, and restrictions (for example, on a client-owned store, theme pushes are unpublished only).
9. **Data contract.** Every stored field, setting and content type by exact name, who writes it and who reads it. Agents never invent a name outside it.
10. **Decisions table.** ID, question, who decides, default until answered. Tickets reference decisions by ID.
11. **Standing rules.** Discovery before code. Extend before rebuilding, and explain in the PR when extending does not fit. Stay inside the ticket. Shared pieces are built once by the ticket that needs them first. Merchant controls are contractual. Performance budget with numbers. Client-directed platform choices.
12. **Build order** with the reason for each phase. The first ticket is the smallest one that proves the toolchain and conventions end to end. Milestones with dates and blocked-by relations.
13. **Definition of done** per ticket: every criterion ticked, merchant settings checked in the editor, validators clean, no debug code, no new dependencies, strings localized, manual QA on the named devices (including in-app browsers for social traffic), PR references the ticket with a screenshot per breakpoint and the ticked QA section, closing comment posted.
14. **When blocked.** Comment on the ticket with the exact question, then move to the next unblocked ticket. The PM relays to the client. Never guess design intent, copy or client preference.
15. **Out of scope.** Deferred features, other workstreams, production systems that must not be refactored.
16. **First actions.** The exact commands to run, ending with the first ticket.
