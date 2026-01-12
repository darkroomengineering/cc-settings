# Darkroom Engineering - Claude Code Configuration

> Team-shareable AI coding standards for darkroom.engineering projects

## Orchestration Mode: Maestro

Maximize efficiency through delegation, parallelism, and relentless progress.

### Core Principles
- **Plan First**: Break every non-trivial task into parallelizable sub-tasks with dependencies
- **Delegate Aggressively**: Use subagents for isolated work (exploration, testing, research)
- **Parallel Thinking**: Explore 2-3 approaches before synthesizing the best
- **Aggressive Tooling**: Use all available tools—iterate rapidly with diffs and tests
- **Ultrawork Mode**: No idle time—push sub-tasks forward relentlessly

### Standard Workflow
1. Plan comprehensively (use `planner` agent for complex features)
2. Delegate via subagents for true parallelism
3. Implement with immediate testing
4. Review, optimize, commit
5. Update todos/plans as needed

---

## Tech Stack

### Primary
- **TypeScript** - Strict mode, no `any` types
- **Next.js 16+** - App Router only (no Pages Router)
- **React 19+** - Server Components by default, Client Components when needed
- **Tailwind CSS v4** - With CSS Modules for complex components
- **Bun** - Package manager and runtime

### Build & Quality
- **Turbopack** - Development bundler
- **Biome** - Linting and formatting (not ESLint/Prettier)
- **TypeScript** - `strict: true`, `noUncheckedIndexedAccess: true`

### Animation & Graphics
- **Lenis** - Smooth scroll (`@darkroom.engineering/lenis`)
- **GSAP** - Complex animations
- **React Three Fiber** - 3D graphics when needed
- **Tempus** - RAF management (`@darkroom.engineering/tempus`)
- **Hamo** - Performance React hooks (`@darkroom.engineering/hamo`)

### CMS Integrations
- Sanity (primary)
- Shopify (commerce)
- HubSpot (marketing)

---

## Coding Standards

### Architecture Patterns

```
app/                 # Next.js pages and routes only
components/          # UI components (atoms, molecules, organisms)
lib/
  ├── hooks/        # Custom React hooks
  ├── integrations/ # Third-party service clients
  ├── styles/       # Global CSS, Tailwind config
  ├── utils/        # Pure utility functions
  ├── webgl/        # 3D/WebGL code (optional)
  └── dev/          # Debug tools
```

### Component Conventions

```tsx
// CSS Module imports aliased as 's'
import s from './component.module.css'

// Required wrapper for Next.js Image
import { Image } from '@/components/image'

// Required wrapper for Next.js Link
import { Link } from '@/components/link'
```

### Class Design (for libraries)
- Instance-based with configuration objects
- Event-driven architecture with emitter patterns
- Semantic method names: `scrollTo()`, `start()`, `stop()`, `destroy()`
- Multi-framework adapters: Vanilla JS, React, Vue

### TypeScript Rules
- No `any` - use `unknown` and narrow
- Prefer `interface` over `type` for objects
- Export types alongside implementations
- Use discriminated unions for state

### React Patterns
- Server Components by default
- `'use client'` only when needed (interactivity, hooks, browser APIs)
- Prefer composition over props drilling
- Use `@darkroom.engineering/hamo` hooks for performance

### CSS/Styling
- Tailwind v4 for utility classes
- CSS Modules for complex component styles
- CSS custom properties for theming
- No inline styles except for dynamic values

---

## Darkroom Libraries Reference

When working on projects, leverage these internal libraries:

| Package | Purpose | Install |
|---------|---------|---------|
| `lenis` | Smooth scroll | `bun add lenis` |
| `@darkroom.engineering/hamo` | Performance hooks | `bun add @darkroom.engineering/hamo` |
| `@darkroom.engineering/tempus` | RAF management | `bun add @darkroom.engineering/tempus` |

### Lenis Quick Start
```tsx
import Lenis from 'lenis'

const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: 'vertical',
  smoothWheel: true,
})

function raf(time: number) {
  lenis.raf(time)
  requestAnimationFrame(raf)
}
requestAnimationFrame(raf)
```

### Hamo Hooks
```tsx
import { useWindowSize, useRect, useIntersectionObserver } from '@darkroom.engineering/hamo'
```

---

## Git & Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Small, atomic commits
- Never force push to `main` or `master`
- Always verify before destructive operations

---

## Commands Reference

Use these slash commands for common workflows:
- `/init` - Initialize project with Darkroom standards
- `/component <name>` - Scaffold a new component
- `/hook <name>` - Create a custom hook
- `/review` - Code review current changes
- `/explore [target]` - Navigate codebase
- `/docs <topic>` - Fetch documentation
- `/context` - Manage context window
- `/orchestrate <task>` - Multi-agent task coordination
- `/ask <question>` - Ask Oracle for guidance
- `/create-handoff` - Save session state
- `/resume-handoff` - Resume previous session
- `/tldr <action>` - TLDR code analysis
- `/learn <action>` - Persistent learnings across sessions
- `/lenis` - Setup smooth scroll

---

## Safety

- Always seek explicit approval for destructive changes (deletes, force pushes)
- Never commit secrets or `.env` files
- Use environment variables for all API keys
- Validate user input at system boundaries

---

## Satus Starter

For new projects, start with the Satus template:
```bash
bunx degit darkroomengineering/satus my-project
cd my-project
bun install
bun dev
```

Debug mode: `Cmd/Ctrl + O`

---

## Team Sync

This configuration should be version-controlled. For project-specific overrides, create a `CLAUDE.md` in the project root—it will merge with these global settings.
