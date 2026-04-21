# Usage Guide

Progressive onboarding for Darkroom's Claude Code configuration.

**Start simple. Scale up when you feel friction.**

---

## Level 0: Just Installed

After running setup, restart Claude Code. That's it.

Talk naturally. The system recognizes intent and invokes the right tools:

```
"Fix the broken auth"        → explores, fixes, tests
"Build a dashboard"          → plans, scaffolds, implements
"How does the cart work?"    → explores codebase, returns summary
"Review my changes"          → runs code review
"Done for today"             → saves session state for next time
```

No commands to memorize. No configuration to tweak.

---

## Level 1: Guardrails

Read `AGENTS.md` in your project root. It contains the coding standards and guardrails that protect you:

### The Big Ones

- **2-iteration limit**: If something fails twice, Claude stops and presents alternatives instead of burning context on the same broken approach
- **Bug fix scope**: When fixing a bug, Claude stays in the relevant files — no drive-by refactoring
- **Verify after fix**: Build runs after every fix, before moving on
- **Never fake measurements**: No fabricated Lighthouse scores or test results
- **Pre-commit checks**: Type checking + build + tests must pass before any commit

### Autonomous Execution

Claude proceeds without asking for non-destructive operations:
- Reading files, searching code, exploring architecture
- Running git status, git log, git diff
- Fetching documentation

Claude asks before destructive or irreversible actions.

---

## Level 2: Skills

Skills auto-invoke based on your words. You can also call them directly with `/skill`:

### Workflows (Multi-Agent)

| Trigger | Skill | What Happens |
|---------|-------|--------------|
| "fix", "broken", "bug" | `fix` | explore → implement → test |
| "build", "create", "add feature" | `build` | plan → scaffold → implement |
| "refactor", "clean up" | `refactor` | explore → implement → review |
| "review", "check", "PR" | `review` | reviewer agent |
| "test", "coverage" | `test` | tester agent |
| "ship it", "create PR" | `ship` | test → review → PR |
| "coordinate", "complex task" | `orchestrate` | maestro multi-agent delegation |
| "new project", "initialize" | `init` | scaffolds from Satus starter template |
| "compare approaches", "which is better" | `f-thread` | parallel evaluation → scoring matrix |
| "overnight", "long running" | `l-thread` | phased execution with checkpoints |

### Research

| Trigger | Skill |
|---------|-------|
| "how does X work?", "find X" | `explore` |
| "docs for X", "API reference" | `docs` |
| "who calls X?", "dependencies" | `tldr` |
| "what could go wrong?" | `premortem` |
| "advice on X" | `ask` |
| "project status", "update the issue" | `project` — syncs with GitHub Issues and Projects |
| "help me figure out", "define requirements" | `discovery` — structured requirements interview |
| "PRD", "product spec", "feature spec" | `prd` — generates product requirements document |

### Session Management

| Trigger | Skill |
|---------|-------|
| "done for today" | `create-handoff` — saves state |
| "resume", "continue" | `resume-handoff` — loads previous state |
| Non-obvious bug fix discovered | `learn` — **auto-stores** the insight |
| "save progress", "checkpoint" | `checkpoint` — saves/restores task state |
| "context window", "running out of context" | `context` — context window management |

### Tools

| Trigger | Skill |
|---------|-------|
| "compare to design", "inspect in figma" | `figma` — Figma desktop + MCP integration |
| screenshot, visual bug | `debug` — browser debugging with pinchtab |
| "QA check", accessibility | `qa` — visual QA validation |
| "design tokens", "type scale", "color palette" | `design-tokens` — generates token systems with math |
| "smooth scroll", "lenis" | `lenis` — Lenis smooth scroll setup |
| "create hook", "custom hook" | `hook` — scaffolds React hook with standards |
| "lighthouse", "page speed", "core web vitals" | `lighthouse` — performance audit + optimization loop |

### Utility

| Trigger | Skill |
|---------|-------|
| "create component X" | `component` — scaffolds with standards |
| "parallel agents", "split work", "fan out" | `teams` — multi-instance parallel work |
| "verify", "double check", "are you sure" | `verify` — adversarial multi-agent verification |
| "consolidate", "clean up rules", "maintenance" | `consolidate` — prunes rules, skills, learnings |
| "audit commands", "what did it run" | `audit` — analyzes logged Bash commands |
| "optimize skill", "autoresearch" | `autoresearch` — iterative skill prompt optimization |

---

## Level 3: Agents

For complex tasks, delegate to specialized agents:

```
Agent(explore, "how does the auth module work?")
Agent(planner, "break down the checkout redesign")
Agent(implementer, "implement coupon validation based on the plan")
Agent(reviewer, "review these changes for quality and edge cases")
Agent(tester, "write tests for the payment module")
Agent(security-reviewer, "audit the auth flow for vulnerabilities")
```

### When to Delegate

| Situation | Approach |
|-----------|----------|
| Know the file, small change | Edit directly |
| Need to understand a large area | `Agent(explore, "...")` |
| Multi-file implementation | `Agent(planner, "...")` then `Agent(implementer, "...")` |
| Need a second opinion | `Agent(reviewer, "...")` |
| 3+ independent workstreams | Use Agent Teams |

### Parallelization

When spawning multiple agents for independent work, send all Agent calls in one message:

```
EFFICIENT:  Agent(explore, "auth") + Agent(explore, "routing")  ← one message
WASTEFUL:   Agent(explore, "auth") → wait → Agent(explore, "routing")  ← two messages
```

---

## Level 4: Full Orchestration

For power users who want maximum delegation. Activate the maestro profile:

```
/profile maestro
```

In maestro mode:
- Every request gets delegated to agents
- Parallel pipelines for independent work
- TLDR-first exploration (95% token savings on large codebases)
- Agent Teams for 3+ independent workstreams

See `profiles/maestro.md` for the full workflow.

---

## TLDR Exploration

When working with large codebases, TLDR provides token-efficient exploration:

```bash
tldr context functionName --project .   # Understand a function (vs reading the whole file)
tldr semantic "authentication flow" .   # Search by meaning (vs grep)
tldr impact functionName .              # Who calls this? (vs manual tracing)
tldr arch .                             # Architecture overview
tldr slice file.ts func 42             # What affects this line?
```

Use TLDR when files are large or you need meaning-based search. Use Read/Grep for exact content or small files.

---

## Knowledge System

### Local (Default)

```bash
# Store a learning (auto-invoked when Claude discovers something)
/learn store bug "useAuth causes hydration — use dynamic import"
/learn store pattern "Wrap async server components in Suspense"

# Recall
/learn recall all
/learn recall category bug
/learn recall search hydration
```

### Shared (Team Knowledge Base)

```bash
# Store to the project's GitHub Project board
/learn store --shared gotcha "Biome ignores .mdx files by default"
/learn store --shared decision "Chose Lenis over native smooth-scroll"

# Recall shared knowledge
/learn recall shared
```

See `docs/knowledge-system.md` for GitHub Projects setup.

---

## Context Management

Watch the statusline for context usage:

```
Opus 4.7 | my-project | main✱↑ | █░░░░░░░░░ 8% (84k/1.0M)
```

| Usage | Action |
|-------|--------|
| 70-79% | Consider wrapping up or handing off |
| 80-89% | Start wrapping up |
| 90%+ | Run `/create-handoff` now |

---

## Ecosystem Contexts

Switch contexts for different platforms:

```bash
/context web      # Next.js, React, Tailwind (default)
/context webgl    # R3F, Three.js, GSAP, shaders
/context desktop  # Tauri (Rust + Web)
/context mobile   # Expo (React Native)
```

---

## Example Session

```
# Start
"Resume where we left off"
→ Loads: "Working on checkout, coupon validation pending"

# Understand
"How does the cart work?"
→ explore agent: returns summary with file:line citations

# Plan
"Add coupon codes to checkout"
→ planner: breaks into 4 tasks

# Build
"Start with the coupon API"
→ scaffolder + implementer + tester

# Review
"Review my changes"
→ reviewer: checks quality, suggests edge cases

# Ship
"Ship it"
→ runs tests, creates PR

# End
"Done for today"
→ Handoff: "Completed coupon validation. Next: cart integration"
```
