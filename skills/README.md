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
| "What could go wrong?" | `premortem` | Risk analysis before implementing |
| "Done for today" | `create-handoff` | Saves session state |

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

### Creation (Direct Output)
These create files directly in main context:

| Skill | Triggers On |
|-------|-------------|
| `component` | create component, new component |
| `hook` | create hook, custom hook |
| `init` | new project, initialize, setup |

### Research (Forked Context)
These fork context for clean exploration:

| Skill | Triggers On |
|-------|-------------|
| `explore` | how does, where is, find, understand |
| `docs` | documentation, how to use, library API |
| `ask` | advice, guidance, what should I |
| `tldr` | who calls, dependencies, semantic search |
| `premortem` | risks, what could go wrong |
| `discovery` | requirements, scope, figure out |

### Tools
| Skill | Triggers On |
|-------|-------------|
| `debug` | screenshot, visual bug, inspect element |
| `qa` | visual check, accessibility, validate |
| `versions` | package version, before installing |
| `lenis` | smooth scroll, lenis setup |

### Session Management
| Skill | Triggers On |
|-------|-------------|
| `learn` | **AUTO**: after non-obvious fix, pattern, gotcha |
| `context` | context window, running out of context |
| `create-handoff` | done for today, save state |
| `resume-handoff` | resume, continue, last session |

## The `learn` Skill (Auto-Applied)

**Claude automatically stores learnings when it should remember something.**

Auto-triggers when:
- Fixing a non-obvious bug
- Discovering a useful pattern
- Encountering a gotcha or edge case
- Finding a tool/library feature
- Making an architecture decision

Learnings persist across sessions and are recalled on session start.

## Skill Structure

Each skill is a directory with `SKILL.md`:

```
skills/
├── fix/
│   └── SKILL.md
├── explore/
│   └── SKILL.md
├── learn/
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
| 70-79% | Notice | Consider handoff |
| 80-89% | Warning | Create handoff soon |
| 90%+ | **Critical** | `create-handoff` auto-suggested |

## Legacy Migration

These files are deprecated and will be removed:
- `skill-rules.json` → Replaced by `*/SKILL.md` files
- `commands/*.md` → Merged into skills

Skills are now the unified way to extend Claude's capabilities.

## Debugging

```bash
# Check which skills Claude sees
/skills

# Manually invoke a skill
/darkroom:fix "the auth bug"

# Check learnings
bash ~/.claude/scripts/recall-learnings.sh all
```
