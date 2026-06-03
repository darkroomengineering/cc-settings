# Skills

**You don't need to memorize slash commands.** Just describe what you want naturally.

## How It Works

Skills use the native Claude Code `SKILL.md` format. Claude sees skill descriptions in its context and **automatically invokes them** based on your conversation.

```
You: "Fix the auth bug"

Claude automatically:
1. Recognizes this matches the "fix" skill
2. Forks context (keeps main conversation clean)
3. Spawns explore agent → investigate
4. Spawns tester agent → reproduce
5. Spawns implementer agent → fix
6. Returns clean summary
```

## Natural Language Examples

| What You Say | Skill Auto-Invoked | What Happens |
|--------------|-------------------|--------------|
| "Fix the broken login" | `fix` | explore → tester → implementer → review |
| "Build a user dashboard" | `build` | planner → scaffolder → implementer → test |
| "How does auth work?" | `explore` | Codebase investigation, returns summary |
| "Review my changes" | `review` | Code review against Darkroom standards |
| "Create a Button component" | `component` | Scaffolds component with CSS module |
| "What could go wrong?" | `oracle` | Risk analysis before implementing |
| "Double check this is correct" | `verify` | finder → adversary → referee |
| "Clean up our rules" | `consolidate` | Audit and merge rules/skills/learnings |
| "Done for today" | `handoff` | Saves session state |

## Skill Categories

### Workflows (Multi-Agent Delegation)
These fork context and delegate to specialized agents:

| Skill | Triggers On | Agents Used |
|-------|-------------|-------------|
| `fix` | bug, broken, error, not working | explore → tester → implementer |
| `build` | build, create, implement, add feature | planner → scaffolder → implementer |
| `refactor` | refactor, clean up, reorganize | explore → implementer → reviewer |
| `review` | review, check, PR, changes | reviewer |
| `test` | test, write tests, coverage | tester |
| `orchestrate` | complex task, coordinate | maestro |
| `ship` | ship it, create PR, /pr, /ship | tester → reviewer → implementer |
| `verify` | verify, double check, prove it, adversarial, audit | finder → adversary → referee |

### Creation (Direct Output)
These create files directly in main context:

| Skill | Triggers On |
|-------|-------------|
| `component` | create component, new component |
| `design-tokens` | design tokens, type scale, color palette, spacing system, theme setup |
| `hook` | create hook, custom hook |
| `dr-init` | new project, initialize, setup |

### Research (Forked Context)
These fork context for clean exploration:

| Skill | Triggers On |
|-------|-------------|
| `explore` | how does, where is, find, understand, zoom out, bigger picture, where does this fit |
| `oracle` | advice, guidance, what should I, risks, what could go wrong, compare approaches |
| `tldr` | who calls, dependencies, semantic search |
| `plan-feature` | requirements, scope, figure out, PRD, requirements document, product spec |
| `project` | project status, update the issue, sync with github, show my tasks |

### Tools
| Skill | Triggers On |
|-------|-------------|
| `qa` | visual QA, accessibility, contrast, touch target |

### Utility
| Skill | Triggers On |
|-------|-------------|
| `consolidate` | clean up rules, simplify config, contradictions, spa day, prune |

### Session Management
| Skill | Triggers On |
|-------|-------------|
| `share-learning` | explicit invocation for team-wide learnings (personal/local notes go to auto-memory) |
| `checkpoint` | snapshot, before risky op, rollback to |
| `handoff` | done for today, ending session, context window, running out of context, resume, continue, last session |

### The `share-learning` Skill (Manual, Team-Only)

This skill posts architectural decisions, cross-cutting gotchas, and conventions to the shared team-knowledge repo so other team members' AI agents can find them via `rg`/`cat` on a local clone. Invoke it manually or follow the `promote-memory` hook nudge that fires when a `project` or `feedback` auto-memory is written.

For personal notes, the cc-settings auto-memory system (stored under `~/.claude/projects/<hash>/memory/`) captures them automatically. See the "auto memory" section of `~/.claude/CLAUDE.md` for how that works. The rule of thumb: if another team member's AI agent would benefit from knowing it, use `/share-learning`; otherwise let auto-memory handle it.

## Skill Structure

Each skill is a directory with `SKILL.md`:

```
skills/
├── fix/
│   └── SKILL.md
├── explore/
│   └── SKILL.md
├── share-learning/
│   └── SKILL.md
└── ...
```

### SKILL.md Format

```yaml
---
name: skill-name
description: |
  What this skill does. Use when:
  - User says "X", "Y", "Z"
  - Specific situations that trigger this skill
context: fork          # Run in isolated context
agent: agentName       # Which agent runs it
allowed-tools: [...]   # Restrict available tools
---

# Skill Instructions

[What Claude does when skill is invoked]
```

### Key Options

| Option | Effect |
|--------|--------|
| `description` | Tells Claude WHEN to auto-invoke (critical!) |
| `context: fork` | Runs isolated, returns summary to main |
| `agent: X` | Uses specific agent (explore, reviewer, etc.) |
| `allowed-tools` | Restricts which tools can be used |

## Adding Custom Skills

1. Create directory: `skills/my-skill/`
2. Create `SKILL.md` with frontmatter
3. Write intent-based description (what triggers it?)
4. Restart Claude Code to load

## Context Thresholds

| Context % | Warning | Action |
|-----------|---------|--------|
| 70-79% | Notice | Save checkpoint, consider handoff |
| 80-89% | Warning | Save checkpoint + commit work, create handoff soon |
| 90%+ | **Critical** | Save checkpoint, `handoff` auto-suggested |

> Checkpoints (`/checkpoint save`) are lightweight task snapshots. Handoffs (`/handoff`) are full session transfers. Use both at thresholds.

## Legacy

The old `skill-rules.json` and `commands/*.md` formats have been replaced by `*/SKILL.md` files. Skills are now the unified way to extend Claude's capabilities.

## Debugging

```bash
# Check which skills Claude sees
/skills

# Manually invoke a skill
/fix "the auth bug"

# Check auto-memory entries for this project
find ~/.claude/projects/*/memory -name "*.md" -not -name "MEMORY.md" 2>/dev/null
```
