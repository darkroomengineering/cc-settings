# Documentation index

> **Audience:** new users, installed users, evaluators, and maintainers
> **Purpose:** route each reader to the canonical page for their task
> **Status:** canonical navigation index

Start with [the repository README](../README.md) if you are deciding whether to install. Start with
[your first session](./first-session.md) if installation already finished.

## Use cc-settings

| Document | Audience | Status | Use it for |
|---|---|---|---|
| [Installation](./install.md) | New users and administrators | Canonical | Requirements, targets, tiers, flags, side effects, ownership, rollback, and uninstall |
| [Your first session](./first-session.md) | New users | Canonical | A harmless first task, expected behavior, setup inspection, and recovery |
| [Claude Code and Codex](./claude-vs-codex.md) | All users | Canonical | Invocation syntax, feature parity, host limits, and prerequisites |
| [Skill guide](./skills.md) | All users | Canonical | What every skill is worth, what it changes, what it returns, and when it asks |
| [Troubleshooting](./troubleshooting.md) | Installed users | Canonical | Health checks, hook trust, missing tools, host boundaries, rollback, and uninstall |
| [What is shaping Claude](./whats-on.md) | Claude Code users | Canonical | Read-only inspection of installed user-scope behavior |
| [Codex support](./codex.md) | Codex users | Supporting | Codex-native installation and lifecycle details |
| [GitHub workflow](./github-workflow.md) | Teams using GitHub | Supporting | Issues, Projects, branch links, handoffs, and progress updates |
| [Knowledge system](./knowledge-system.md) | Darkroom teammates | Canonical | Shared knowledge versus local memory and the `share-learning` prerequisite |
| [Profiles](./profiles.md) | Web, mobile, desktop, and 3D teams | Supporting | What profile files mean and how stack-aware workflows choose guidance |
| [Accessibility](./accessibility.md) | UI engineers and reviewers | Reference | Accessibility checks and implementation expectations |
| [SEO reference](./seo-reference.md) | Web engineers | Reference | Search and answer-engine implementation guidance |
| [TLDR cheatsheet](./tldr-cheatsheet.md) | Claude Code users and maintainers | Reference | Code-map operations and engine limits |

## Understand cc-settings

| Document | Audience | Status | Use it for |
|---|---|---|---|
| [System overview](./system-overview.md) | New users and evaluators | Canonical | How requests, skills, agents, tools, hooks, and proof gates fit together |
| [The flow](./the-flow.md) | Evaluators and maintainers | Canonical | Why advice becomes an enforced gate only after evidence |
| [Manual](../MANUAL.md) | Installed users | Canonical | Task-oriented chooser and deeper workflow explanations |
| [Agent models](./agent-models.md) | Claude Code users | Reference | Model selection, effort, advisor, and quota policy |
| [Cache strategy](./cache-strategy.md) | Power users and maintainers | Reference | Prompt-cache behavior and context cost |
| [Architecture reference](./architecture-reference.md) | Maintainers | Reference | Repository components and runtime boundaries |
| [Thread types](./thread-types.md) | Maintainers and orchestrators | Reference | Base, parallel, chained, fusion, and long-running task shapes |
| [Parallel batch detection](./parallel-batch-detection.md) | Orchestrators | Reference | How dependency levels determine parallel batches |
| [Functional DAG](./functional-dag.md) | Planners and reviewers | Canonical | The required dependency diagram for plans |
| [Enhanced TODOs](./enhanced-todos.md) | Maintainers | Reference | Durable task annotation conventions |

## Maintain cc-settings

| Document | Audience | Status | Use it for |
|---|---|---|---|
| [AGENTS.md](../AGENTS.md) | Contributors and compatible coding tools | Canonical | Portable coding standards and guardrails |
| [CLAUDE.md](../CLAUDE.md) | Claude Code contributors | Canonical | Claude-specific session behavior |
| [Security](../SECURITY.md) | Users and security reviewers | Canonical | Threat model, hook integrity, recovery, and reporting |
| [Settings reference](./settings-reference.md) | Maintainers | Canonical | Every managed Claude setting and merge rule |
| [Settings merge design](./settings-merge-three-way-design.md) | Maintainers | Design record | Three-way ownership and conflict behavior |
| [Hooks reference](./hooks-reference.md) | Maintainers | Canonical | Hook events, matchers, scripts, and debugging |
| [Security reference](./security-reference.md) | Security reviewers | Reference | Application-security checklist and examples |
| [Frontmatter reference](./frontmatter-reference.md) | Agent and skill authors | Canonical | Supported metadata fields |
| [Skill authoring](./skill-authoring.md) | Skill authors | Canonical | Creating, registering, validating, and documenting a skill |
| [Skills README](../skills/README.md) | Repository browsers | Pointer | Short platform-neutral link to the human and executable skill sources |
| [Rules README](../rules/README.md) | Rule authors | Reference | Rule structure and scope |
| [Hooks README](../hooks/README.md) | Hook authors | Pointer | Short route to the hook reference |
| [MCP configuration README](../mcp-configs/README.md) | MCP maintainers | Reference | Core and optional server configuration |
| [Feature agents guide](./feature-agents-guide.md) | Agent authors | Reference | Specialized agent composition |
| [Codex bridge](./codex-bridge.md) | Claude Code users and maintainers | Reference | Calling Codex from Claude without recursive standalone use |
| [Deslopper team mode](./deslopper-team-mode.md) | Deslopper maintainers | Internal reference | Read-only scanner fan-out and merge protocol |

## History and audits

These documents explain past decisions and findings. They are not current setup instructions.

| Document | Audience | Status | Contents |
|---|---|---|---|
| [Changelog](../CHANGELOG.md) | Everyone | Release history | Version-by-version changes |
| [Documentation audit, 2026-08-21](./audits/docs-audit-2026-08-21.md) | Maintainers | Audit record | First-time-reader and contract audit |
| [Codebase audit, 2026-07-08](./audits/codebase-audit-2026-07-08.md) | Maintainers | Audit record | Repository-wide findings |
| [Nuclear review, 2026-07-20](./audits/nuclear-review-2026-07-20.md) | Maintainers | Audit record | Review snapshot |
| [Nuclear review, 2026-07-29](./audits/nuclear-review-2026-07-29.md) | Maintainers | Audit record | Review snapshot |
| [Nuclear review, 2026-07-31](./audits/nuclear-review-2026-07-31.md) | Maintainers | Audit record | Review snapshot |
| [Consolidation audit, 2026-05](./consolidation-audits/2026-05.md) | Maintainers | Audit record | Skill and rule consolidation |
| [MCP auth-cache upstream bug](./upstream-bugs/mcp-needs-auth-cache-no-ttl.md) | Maintainers | Upstream record | Authentication cache behavior and evidence |

If a current guide and a history document disagree, follow the current guide and file a drift issue.
