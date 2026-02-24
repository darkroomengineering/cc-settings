# GitHub-Native Workflow

How Darkroom teams use GitHub Issues and Projects as the shared source of truth for AI-assisted development.

---

## The Pattern: Issues as PLAN.md

Instead of local plan files that only one agent can see, use GitHub Issues as living project plans:

```
GitHub Issue #123: "Add coupon validation to checkout"
├── ## Goal
│   What we're building and why
├── ## Tasks
│   - [x] Coupon validation API
│   - [x] Cart discount calculation
│   - [ ] UI for coupon input
│   - [ ] Tests
├── ## Decisions
│   - Server-side validation only (security)
│   - Percentage and fixed-amount coupons supported
├── ## Comments (progress log)
│   - Agent session 1: "Built validation API, 2/4 tasks done"
│   - Agent session 2: "Added cart integration, 3/4 done"
└── Linked: commits, PRs, branches
```

**Why this works:**
- Visible to every team member and their agents
- Version-controlled progress (GitHub tracks edits)
- Linked commits show exactly what code maps to what task
- Task checkboxes provide clear progress tracking
- Comments form a persistent log across sessions

---

## Agent Loop

### Session Start
```
Agent starts → detects branch feat/123-coupon-validation
            → reads issue #123 via gh issue view 123 --comments
            → presents: "Working on #123. 2/4 tasks done. Last: cart integration."
```

### During Work
```
Agent works → references issue task list for priorities
           → makes changes, runs tests
           → commits with "Refs #123" in message
```

### Session End
```
Agent finishes → comments on #123 with progress summary
              → checks off completed tasks in issue body
              → creates local handoff for session-specific context
```

---

## Setup

### 1. Authenticate gh CLI

```bash
gh auth login
```

### 2. Branch naming convention

Include the issue number in branch names:
```
feat/123-add-coupon-validation
fix/42-login-redirect-loop
chore/88-upgrade-dependencies
```

The `project` skill extracts the first number and looks up that issue.

### 3. Create issues with task structure

When planning work, create issues with checkboxes:

```bash
gh issue create --title "feat: add coupon validation" --body "## Goal
Add coupon code support to the checkout flow.

## Tasks
- [ ] Coupon validation API endpoint
- [ ] Cart discount calculation logic
- [ ] Coupon input UI component
- [ ] Unit and integration tests

## Decisions
- Server-side validation only (can't trust client)
- Support percentage and fixed-amount coupons

## Constraints
- Must work with existing cart state management
- Coupons expire, need date validation"
```

### 4. (Optional) GitHub Project board

For roadmap-level tracking across multiple issues:

```bash
# Create a project
gh project create --owner ORG --title "Theca v2"

# Add issues to the project
gh project item-add PROJECT_NUM --owner ORG --url https://github.com/ORG/REPO/issues/123
```

---

## GitHub Projects vs GitHub Issues

| Level | Tool | Contains |
|-------|------|----------|
| **Roadmap** | GitHub Project board | Milestones, phases, cross-cutting views |
| **Plan** | GitHub Issue | Task breakdown, decisions, progress log |
| **Work** | Branch + commits | Actual code, linked to issue via "Refs #N" |
| **Session** | Local handoff | Ephemeral agent state (open files, debug notes) |

Use Projects for the big picture. Use Issues for the actual plan. Don't conflate them.

---

## Integration with cc-settings

| Skill | GitHub Integration |
|-------|-------------------|
| `/project` | Reads linked issue on session start, updates on end |
| `/create-handoff` | Posts progress comment on linked issue |
| `/resume-handoff` | Reads linked issue as primary context source |
| `/learn --shared` | Stores team knowledge in GitHub Project board |
| `/build`, `/fix` | Can reference issue tasks for scope |

---

## FAQ

**Q: Do I need the GitHub MCP server?**
No. The `gh` CLI works for everything. The MCP server adds structured tool access but costs more context tokens. Start with `gh`, add the MCP server if you need richer integration.

**Q: What if my branch doesn't match an issue?**
The skills fall back to local handoffs and show your open assigned issues. You can also create an issue from your current work.

**Q: Should every task have an issue?**
No. Quick fixes and small tasks don't need issues. Use issues for anything that spans multiple sessions or involves other team members.

**Q: How do agents handle concurrent work on the same issue?**
Each agent comments independently. Comments are timestamped and attributed. If two agents work on the same issue, their progress comments interleave naturally — same as two humans would.
