# Usage Guide

Practical guide to maximize your Claude Code configuration.

---

## Core Insight: Just Talk Naturally

The skill activation system means you **don't need to memorize commands**. Describe what you want:

| Say This | System Does This |
|----------|------------------|
| "Fix the broken auth" | Suggests `fix` workflow → explore → implement → test |
| "Build a dashboard component" | Suggests `build` → planner → scaffolder → implementer |
| "Who calls this function?" | Suggests `tldr` → semantic analysis |
| "What could go wrong?" | Suggests `premortem` → oracle, reviewer |
| "Done for today" | **Critical**: Forces `create_handoff` |

---

## Daily Workflow

### Starting a Session

```
"Resume where we left off"
→ Activates resume_handoff, loads previous context
```

### During Development

**New features:**
```
"Build a user profile page with avatar upload"
→ Activates: planner → scaffolder → implementer → tester
```

**Bugs:**
```
"Fix the login redirect loop"
→ Activates: explore → implementer → tester
```

**Understanding code:**
```
"How does the payment flow work?"
→ Activates: explore + oracle

# With TLDR (more powerful):
"Who calls processPayment?"
→ tldr impact processPayment .
```

**Refactoring:**
```
"Clean up the auth module"
→ Activates: explore → implementer → reviewer
```

### Ending a Session

```
"Done for today" or "Wrapping up"
→ CRITICAL: Auto-creates handoff before context is lost
```

---

## Direct Agent Invocation

When you know exactly what you need:

```
@planner    Break down the checkout redesign into tasks
@reviewer   Check this PR for issues
@oracle     What's the best approach for rate limiting?
@explore    Map the data flow from API to UI
@tester     Write tests for the auth module
@scaffolder Generate a new API route structure
```

### All Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `@planner` | Task breakdown | Complex features, multi-step work |
| `@implementer` | Code execution | Writing/editing code |
| `@reviewer` | Code review | Before PRs, quality checks |
| `@tester` | Testing | Unit tests, E2E, coverage |
| `@scaffolder` | Boilerplate | New components, routes, modules |
| `@librarian` | Documentation | README, API docs, comments |
| `@explore` | Navigation | Understanding codebase structure |
| `@oracle` | Expert Q&A | Best practices, architecture decisions |
| `@maestro` | Multi-agent | Complex tasks needing coordination |

---

## Slash Commands

```
/component UserAvatar        # Scaffold component with Darkroom standards
/hook useWindowScroll        # Create custom hook
/review                      # Review current changes
/init                        # Initialize project with standards
/lenis                       # Setup smooth scroll
/explore components/         # Navigate codebase
/docs Next.js routing        # Fetch documentation
/context                     # Manage context window
/orchestrate "Add dark mode" # Multi-agent coordination
/ask "Best auth pattern?"    # Ask Oracle
/create-handoff              # Save session state
/resume-handoff              # Resume previous session
/tldr semantic "query"       # TLDR code analysis
/learn store bug "fix"       # Store a learning
/learn recall all            # Recall all learnings
```

---

## TLDR Code Analysis

After running `tldr warm .` once per project:

### Semantic Search
```bash
# "How does X work?"
tldr semantic "authentication flow" .
tldr semantic "error handling" .
tldr semantic "database queries" .
```

### Program Slicing
```bash
# "Why is user null on line 42?"
tldr slice src/auth.ts login 42
# Shows only the 6 lines that affect line 42
```

### Impact Analysis
```bash
# "What breaks if I change this?"
tldr impact validateSession .
tldr impact processPayment .
# Shows all callers (reverse call graph)
```

### Context Extraction
```bash
# "Explain this function" - 95% fewer tokens
tldr context processPayment --project .
# Returns structured summary instead of raw code
```

### Architecture Detection
```bash
tldr arch .
# Identifies layers: presentation, business, data
```

### When to Use TLDR vs Traditional

| Question Type | Traditional | TLDR |
|--------------|-------------|------|
| Exact text match | `grep -r "errorCode"` | — |
| File name pattern | `find . -name "*.tsx"` | — |
| How does X work? | Read 10+ files | `tldr semantic "X"` |
| Who calls this? | grep + manual trace | `tldr impact func` |
| Why is X null here? | Read entire function | `tldr slice file func line` |
| Explain this function | Paste 500 lines | `tldr context func` |

---

## Context Management

### Watch the Warnings

| Indicator | Context % | Action |
|-----------|-----------|--------|
| 🟡 Notice | 70-79% | Good stopping point? Consider handoff |
| 🟠 Warning | 80-89% | Start wrapping up, handoff soon |
| 🔴 Critical | 90%+ | **STOP** - Run `/create-handoff` NOW |

### Manual Handoff

```
/create-handoff
```

Creates:
- `~/.claude/handoffs/handoff_TIMESTAMP.json` (machine-readable)
- `~/.claude/handoffs/handoff_TIMESTAMP.md` (human-readable)

Contains: tasks, context, decisions, next steps, files touched.

### Resume

```
/resume-handoff
# or
"Resume where we left off"
```

---

## Learning Management

Store insights that persist across sessions:

### Store a Learning
```bash
/learn store bug "useAuth causes hydration - use dynamic import"
/learn store pattern "Wrap async server components in Suspense"
/learn store gotcha "Biome ignores .mdx files by default"
```

### Recall Learnings
```bash
/learn recall all                # All project learnings
/learn recall category bug       # Filter by category
/learn recall search hydration   # Search keyword
/learn recall recent 5           # Last 5 learnings
```

### Categories
`bug`, `pattern`, `gotcha`, `tool`, `perf`, `config`, `arch`, `test`

### Auto-Recall
On session start, the 3 most recent project learnings are automatically displayed.

---

## Example Session

```
# === START ===
"Resume where we left off"
→ Loads handoff: "Working on checkout flow, coupon validation pending"

# === UNDERSTAND ===
"How does the cart work?"
→ explore agent maps structure
→ "Who calls calculateTotal?"
→ tldr impact calculateTotal .

# === PLAN ===
"I need to add coupon codes to checkout"
→ planner breaks down:
   1. Coupon validation API
   2. Cart discount calculation
   3. UI for coupon input
   4. Tests

# === BUILD ===
"Let's start with the coupon validation API"
→ scaffolder creates route structure
→ implementer writes validation logic
→ tester adds unit tests

# === REVIEW ===
"/review"
→ reviewer checks code quality
→ Suggests edge case handling

# === END ===
"Good for today"
→ Handoff created automatically
→ "Completed coupon validation. Next: cart discount calculation"
```

---

## Workflows Reference

### Fix Workflow
```
Trigger: "fix the bug", "broken", "not working"
Flow: explore → implementer → tester
```

### Build Workflow
```
Trigger: "build a", "create a", "implement", "add feature"
Flow: planner → scaffolder → implementer → tester
```

### Refactor Workflow
```
Trigger: "refactor", "clean up", "reorganize"
Flow: explore → implementer → reviewer
```

### Review Workflow
```
Trigger: "/review", "review code", "check quality"
Flow: reviewer → tester
```

---

## OpenCode Compatibility

Same configuration works in OpenCode:

```bash
cp -r ~/.claude/* ~/.opencode/
```

Agents, commands, and skills are tool-agnostic markdown files.

---

## Debugging

### Check skill activation output
```bash
cat ~/.claude/skill-activation.out
```

### Check context usage
```bash
cat ~/.claude/context-usage.json
```

### List handoffs
```bash
ls ~/.claude/handoffs/*.md
```

### Check hook logs
```bash
cat ~/.claude/hooks.log
cat ~/.claude/sessions.log
```

### Verify TLDR index
```bash
ls -la .tldr/cache/
```

---

## Quick Reference

| Want To... | Do This |
|------------|---------|
| Start fresh | `/init` |
| Understand code | "How does X work?" or `@explore` |
| Build feature | "Build a..." or `@planner` then `@implementer` |
| Fix bug | "Fix the..." |
| Review code | `/review` or `@reviewer` |
| Find callers | `tldr impact functionName .` |
| Debug line | `tldr slice file func line` |
| Save a lesson | `/learn store bug "insight"` |
| Recall lessons | `/learn recall all` |
| End session | "Done for today" |
| Resume | "Resume where we left off" |
