# Usage Guide

Practical guide for Darkroom's Claude Code configuration (v6.1).

**Batteries included.** Run the setup script and everything works automatically.

---

## Quick Setup

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/setup.sh)
```

Restart Claude Code. That's it.

---

## Core Concept: Just Talk Naturally

**You don't need to memorize commands.** The system recognizes intent and auto-invokes skills.

| Say This | System Does |
|----------|-------------|
| "Fix the broken auth" | `fix` skill → explore → implement → test |
| "Build a dashboard" | `build` skill → plan → scaffold → implement |
| "Who calls this function?" | `tldr` skill → impact analysis |
| "What could go wrong?" | `premortem` skill → risk analysis |
| "Done for today" | `create-handoff` → saves session state |

---

## Daily Workflow

### Starting a Session

```
"Resume where we left off"
→ Loads previous handoff, recalls learnings
```

On session start, the system automatically:
1. Recalls project learnings
2. Warms TLDR index (background)
3. Shows recent handoff if available

### During Development

**Building features:**
```
"Build a user profile page with avatar upload"
→ planner breaks down tasks
→ scaffolder creates structure
→ implementer writes code
→ tester verifies
```

**Fixing bugs:**
```
"Fix the login redirect loop"
→ Claude IMMEDIATELY fixes it (no hand-holding)
→ Points at logs, errors, tests
→ Resolves without asking for permission
```

**Important:** When you give Claude a bug report, it fixes it autonomously. No "should I?" questions.

**Understanding code:**
```
"How does the payment flow work?"
→ explore agent with TLDR semantic search
→ Returns summary with file:line citations
```

**Refactoring:**
```
"Clean up the auth module"
→ explore maps current state
→ implementer refactors
→ reviewer checks quality
```

### Ending a Session

```
"Done for today" or "Wrapping up"
→ Auto-creates handoff with:
   - Tasks completed
   - Decisions made
   - Files modified
   - Next steps
```

---

## TLDR-First Exploration

**All agents enforce TLDR usage.** This saves 95% of tokens compared to reading raw files.

### Quick Reference

| Question | TLDR Command |
|----------|--------------|
| "How does X work?" | `tldr semantic "X" .` |
| "Who calls this?" | `tldr impact functionName .` |
| "Why is X null on line 42?" | `tldr slice file.ts func 42` |
| "Explain this function" | `tldr context func --project .` |
| "Project architecture?" | `tldr arch .` |
| "What tests are affected?" | `tldr change-impact .` |

### When TLDR is Used

Agents have **Forbidden** lists that prohibit:
- Reading large files when `tldr context` would suffice
- Using grep for "how does X work" (use `tldr semantic`)
- Manually tracing callers (use `tldr impact`)
- Exploring architecture without `tldr arch`

### Full Command Reference

```bash
# Semantic search (find by meaning)
tldr semantic "authentication flow" .
tldr semantic "error handling" .

# Function context (95% fewer tokens)
tldr context handleLogin --project .

# Impact analysis (who calls this?)
tldr impact validateSession .

# Program slice (what affects line X?)
tldr slice src/auth.ts login 42 --direction backward

# Architecture detection
tldr arch .

# Call graph
tldr calls . --language typescript

# Data flow graph
tldr dfg src/auth.ts validateToken

# Control flow graph
tldr cfg src/auth.ts handleRequest

# Affected tests
tldr change-impact .

# Dead code detection
tldr dead .

# Type diagnostics
tldr diagnostics src/ --language typescript
```

---

## Auto-Learning

The `learn` skill **automatically invokes** when Claude discovers something worth remembering:

- Non-obvious bug fix
- Useful pattern
- Gotcha or edge case
- Performance optimization
- Configuration that solved a problem
- Architecture decision

### Correction Detection

When you correct Claude ("no, actually...", "that's wrong", "fix that"), a hook automatically reminds Claude to capture the learning. This ensures mistakes become permanent knowledge.

### Manual Learning

```bash
/learn store bug "useAuth causes hydration - use dynamic import"
/learn store pattern "Wrap async server components in Suspense"
/learn store gotcha "Biome ignores .mdx files by default"
```

### Recalling Learnings

```bash
/learn recall all                # All project learnings
/learn recall category bug       # Filter by category
/learn recall search hydration   # Search keyword
/learn recall recent 5           # Last 5 learnings
```

### Categories
`bug`, `pattern`, `gotcha`, `tool`, `perf`, `config`, `arch`, `test`

---

## Task Tracking

For complex tasks, Claude uses file-based tracking in `tasks/todo.md`:

1. **Plan First** - Write plan with checkable items
2. **Verify Plan** - Check in before starting
3. **Track Progress** - Mark items complete as you go
4. **Explain Changes** - High-level summary at each step
5. **Document Results** - Add review section when done
6. **Capture Lessons** - Update learnings after corrections

### Verification Before Done

Claude won't mark a task complete without proving it works:
- Tests pass (run them, don't assume)
- Logs checked for errors/warnings
- Behavior diffed from main when relevant
- "Would a staff engineer approve this?"

### Elegance Check

For non-trivial changes, Claude pauses to ask:
- "Is there a more elegant way?"
- If a fix feels hacky, implements the elegant version instead

---

## Orchestration Mode

Claude defaults to **Maestro mode**—coordinating agents rather than executing directly.

### Agent Delegation

| Task Type | Agent Chain |
|-----------|-------------|
| Understanding code | `explore` or `oracle` |
| Multi-file changes | `planner` → `implementer` |
| Code review | `reviewer` |
| New components | `scaffolder` |
| Writing tests | `tester` |
| Security audit | `security-reviewer` |
| Complex tasks | `maestro` (coordinates all) |

### Direct Agent Invocation

When you know exactly what you need:

```
@planner    Break down the checkout redesign
@reviewer   Check this PR for issues
@oracle     What's the best approach for rate limiting?
@explore    Map the data flow from API to UI
@tester     Write tests for the auth module
@scaffolder Generate a new API route structure
@security-reviewer  Audit for vulnerabilities
```

---

## Skills Reference

### Workflows (Fork Context, Multi-Agent)

| Skill | Triggers | Flow |
|-------|----------|------|
| `fix` | bug, broken, error | explore → tester → implementer |
| `build` | build, create, add feature | planner → scaffolder → implementer |
| `refactor` | refactor, clean up | explore → implementer → reviewer |
| `review` | review, check, PR | reviewer |
| `test` | test, coverage | tester |
| `orchestrate` | complex, coordinate | maestro |

### Research (Fork Context)

| Skill | Triggers |
|-------|----------|
| `explore` | how does, where is, find |
| `docs` | documentation, API reference |
| `ask` | advice, what should I |
| `tldr` | who calls, dependencies |
| `premortem` | risks, what could go wrong |
| `discovery` | requirements, scope |

### Creation (Main Context)

| Skill | Triggers |
|-------|----------|
| `component` | create component |
| `hook` | create hook |
| `init` | new project |

### Session

| Skill | Triggers |
|-------|----------|
| `learn` | **AUTO** after discoveries |
| `context` | context window |
| `create-handoff` | done for today |
| `resume-handoff` | resume, continue |

---

## Context Management

### Watch the Statusline

```
Claude 4.5 Opus | my-project | main✱↑ | ████░░░░░░ 42% (84k/200k)
```

### Context Warnings

| Level | Usage | Action |
|-------|-------|--------|
| Notice | 70-79% | Consider handoff |
| Warning | 80-89% | Start wrapping up |
| **Critical** | 90%+ | Run handoff NOW |

### Manual Handoff

```
/create-handoff
```

Creates:
- `~/.claude/handoffs/handoff_TIMESTAMP.json`
- `~/.claude/handoffs/handoff_TIMESTAMP.md`

---

## Ecosystem Contexts

Switch contexts for different platforms:

```bash
/context web      # Next.js, React, Tailwind (default)
/context webgl    # R3F, Three.js, GSAP, shaders
/context desktop  # Tauri (Rust + Web)
/context mobile   # Expo (React Native)
```

Each context loads:
- Platform-specific patterns
- Relevant tools and commands
- Documentation sources
- Gotchas and best practices

---

## Visual Debugging

Use agent-browser for AI-optimized browser automation:

```
"Take a screenshot of the login page"
"What does the dashboard look like?"
"Debug the visual bug on mobile"
```

### QA Validation

```
/qa
/qa http://localhost:3000/about
```

Checks:
- Accessibility (aria-labels, alt text, heading hierarchy)
- Touch targets (44x44px minimum)
- Contrast (4.5:1 ratio)
- Layout (overflow, spacing)

---

## Example Session

```
# === START ===
"Resume where we left off"
→ Loads: "Working on checkout, coupon validation pending"

# === UNDERSTAND ===
"How does the cart work?"
→ explore: tldr semantic "cart" + tldr context calculateTotal

# === PLAN ===
"Add coupon codes to checkout"
→ planner:
   1. Coupon validation API
   2. Cart discount calculation
   3. UI for coupon input
   4. Tests

# === BUILD ===
"Start with the coupon API"
→ scaffolder: creates route structure
→ implementer: writes validation logic
→ tester: adds unit tests

# === REVIEW ===
"Review my changes"
→ reviewer: checks quality, suggests edge cases

# === END ===
"Done for today"
→ Handoff: "Completed coupon validation. Next: cart integration"
```

---

## Quick Reference

| Want To... | Just Say... |
|------------|-------------|
| Understand code | "How does X work?" |
| Build feature | "Build a..." |
| Fix bug | "Fix the..." |
| Review code | "Review my changes" |
| Find callers | "Who calls X?" |
| Debug line | "Why is X null on line 42?" |
| Security audit | "Check for security issues" |
| Save insight | `/learn store bug "..."` |
| End session | "Done for today" |
| Resume | "Resume where we left off" |
| Debug visually | "Take a screenshot" |
| Switch platform | `/context mobile` |

---

## Optional: claude-mem

For automatic cross-session memory beyond the built-in learning system:

```
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

This adds automatic capture, AI-compressed summaries, and semantic search over all past sessions. The base setup works fully without it.
